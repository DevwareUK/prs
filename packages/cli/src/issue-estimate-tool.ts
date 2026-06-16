import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS,
  DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION,
  estimateIssueImplementationTokens,
  extractIssueImplementationPlanFiles,
  filterRepositoryPaths,
  type IssueEstimateFileContext,
  type IssueImplementationTokenEstimate,
} from "@prs/core";
import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import type { IssuePlanComment, RepositoryForge } from "./forge";
import type { TokenUsageLedgerRow } from "./token-audit";
import { publishTokenUsageLedger } from "./token-usage-comments";

export type IssueEstimateToolResult =
  | {
      status: "blocked";
      issueNumber: number;
      message: string;
      nextAction: "create-issue-plan";
    }
  | ({
      status: "estimated";
      issueNumber: number;
      planSource: {
        type: "managed-comment";
        url: string;
        updatedAt: string;
      };
    } & IssueImplementationTokenEstimate);

export type IssueEstimateContextResult =
  | {
      status: "blocked";
      issueNumber: number;
      message: string;
      nextAction: "create-issue-plan";
    }
  | {
      status: "ready";
      issueNumber: number;
      plan: {
        body: string;
      };
      planSource: {
        type: "managed-comment";
        url: string;
        updatedAt: string;
      };
      profiles: Array<{
        name: string;
        role?: string;
        model: string;
        thinking: string;
      }>;
      implementerProfileName: string;
      verificationCommands: string[][];
      estimateInstructions: string;
      outputSchema: {
        status: "estimated";
        issueNumber: number;
        planSource: {
          type: "managed-comment";
          url: string;
          updatedAt: string;
        };
        confidence: "high|medium|low";
        profiles: string;
        recommendation: string;
        drivers: string;
        warnings: string;
        assumptions: string;
      };
    };

export type IssueEstimateArtifact = {
  status: "estimated";
  issueNumber: number;
  planSource: {
    type: "managed-comment";
    url: string;
    updatedAt: string;
  };
  confidence: "high" | "medium" | "low";
  profiles: Array<{
    name: string;
    role?: string;
    model: string;
    thinking: string;
    range: {
      low: number;
      high: number;
    };
    confidence: "high" | "medium" | "low";
    notes: string[];
  }>;
  recommendation: string;
  drivers: string[];
  warnings: string[];
  assumptions?: string[];
  scanBudget?: IssueImplementationTokenEstimate["scanBudget"];
};

type EstimateIssueToolOptions = {
  issueNumber: number;
  repoRoot: string;
  forge: Pick<RepositoryForge, "fetchIssuePlanComment">;
  repositoryConfig: ResolvedRepositoryConfigType;
};

type EstimateIssueContextOptions = {
  issueNumber: number;
  forge: Pick<RepositoryForge, "fetchIssuePlanComment">;
  repositoryConfig: ResolvedRepositoryConfigType;
};

type IssueEstimateAuditForge = Pick<
  RepositoryForge,
  | "isAuthenticated"
  | "fetchIssueComments"
  | "fetchPullRequestIssueComments"
  | "createAuditComment"
  | "updateIssueComment"
>;

export type IssueEstimateAuditPublication =
  | {
      status: "created" | "updated";
      url: string;
    }
  | {
      status: "skipped";
      reason: string;
    };

const MAX_CONTEXT_FILES = 12;
const DEFAULT_ESTIMATE_PROFILES = {
  premium: {
    model: "gpt-5.5",
    thinking: "high" as const,
  },
  standard: {
    model: "gpt-5.4-mini",
    thinking: "medium" as const,
  },
};
const DEFAULT_ESTIMATE_ROLES = {
  planner: "premium",
  implementer: "standard",
  reviewer: "premium",
  tester: "standard",
};

function rolesByProfileName(
  roles: ResolvedRepositoryConfigType["ai"]["roles"] | undefined
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [role, profileName] of Object.entries(roles ?? {})) {
    if (!profileName) {
      continue;
    }
    result.set(profileName, [...(result.get(profileName) ?? []), role]);
  }
  return result;
}

function createEstimateProfiles(config: ResolvedRepositoryConfigType) {
  const aiConfig = config.ai as ResolvedRepositoryConfigType["ai"] & {
    profiles?: typeof DEFAULT_ESTIMATE_PROFILES;
    roles?: typeof DEFAULT_ESTIMATE_ROLES;
  };
  const profiles =
    aiConfig.profiles && Object.keys(aiConfig.profiles).length > 0
      ? aiConfig.profiles
      : DEFAULT_ESTIMATE_PROFILES;
  const roleMap = rolesByProfileName(aiConfig.roles ?? DEFAULT_ESTIMATE_ROLES);
  return Object.entries(profiles).map(([name, profile]) => ({
    name,
    role: roleMap.get(name)?.join(", "),
    model: profile.model,
    thinking: profile.thinking,
  }));
}

function countLinesWithinBudget(filePath: string): number {
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    return 0;
  }
  const contents = readFileSync(filePath, "utf8");
  return contents.length === 0 ? 0 : contents.split(/\r?\n/).length;
}

function collectLikelyFileContext(
  repoRoot: string,
  planBody: string,
  excludePaths: readonly string[]
): {
  files: IssueEstimateFileContext[];
  scanBudget: {
    filesConsidered: number;
    filesScanned: number;
    maxFiles: number;
    exhausted: boolean;
  };
} {
  const likelyFiles = filterRepositoryPaths(
    extractIssueImplementationPlanFiles(planBody),
    excludePaths
  );
  const selectedFiles = likelyFiles.slice(0, MAX_CONTEXT_FILES);
  const files = selectedFiles.map((path) => {
    const absolutePath = resolve(repoRoot, path);
    const exists = existsSync(absolutePath);
    return {
      path,
      exists,
      lineCount: exists ? countLinesWithinBudget(absolutePath) : 0,
    };
  });

  return {
    files,
    scanBudget: {
      filesConsidered: likelyFiles.length,
      filesScanned: files.filter((file) => file.exists).length,
      maxFiles: MAX_CONTEXT_FILES,
      exhausted: likelyFiles.length > MAX_CONTEXT_FILES,
    },
  };
}

function createVerificationCommands(config: ResolvedRepositoryConfigType): string[][] {
  return [
    config.buildCommand,
    ...((config.prReadiness?.commands ?? []).map((command) => command.command)),
  ];
}

function getImplementerProfileName(config: ResolvedRepositoryConfigType): string {
  return (
    ((config.ai as { roles?: { implementer?: string } }).roles ?? DEFAULT_ESTIMATE_ROLES)
      .implementer ?? DEFAULT_ESTIMATE_ROLES.implementer
  );
}

function createBlockedResult(issueNumber: number): IssueEstimateToolResult {
  return {
    status: "blocked",
    issueNumber,
    message:
      "Issue implementation token estimates require an issue comment containing `<!-- prs:issue-plan -->`. For estimate-ready issues, keep the companion source-of-truth specification in `<!-- prs:issue-spec -->`; the estimator reads the managed plan marker. Publish the managed plan comment or run `prs issue plan <number>` first.",
    nextAction: "create-issue-plan",
  };
}

function createEstimateResult(
  issueNumber: number,
  planComment: IssuePlanComment,
  config: ResolvedRepositoryConfigType,
  repoRoot: string
): IssueEstimateToolResult {
  const context = collectLikelyFileContext(
    repoRoot,
    planComment.body,
    config.aiContext.excludePaths
  );
  const estimate = estimateIssueImplementationTokens({
    planBody: planComment.body,
    profiles: createEstimateProfiles(config),
    implementerProfileName:
      ((config.ai as { roles?: { implementer?: string } }).roles ??
        DEFAULT_ESTIMATE_ROLES).implementer,
    costEstimates: config.ai.costEstimates,
    context: {
      likelyFiles: context.files,
      verificationCommands: createVerificationCommands(config),
      scanBudget: context.scanBudget,
    },
  });

  return {
    ...estimate,
    status: "estimated",
    issueNumber,
    planSource: {
      type: "managed-comment",
      url: planComment.url,
      updatedAt: planComment.updatedAt,
    },
  };
}

export async function estimateIssueTool(
  options: EstimateIssueToolOptions
): Promise<IssueEstimateToolResult> {
  const planComment = await options.forge.fetchIssuePlanComment(options.issueNumber);
  if (!planComment) {
    return createBlockedResult(options.issueNumber);
  }

  return createEstimateResult(
    options.issueNumber,
    planComment,
    options.repositoryConfig,
    options.repoRoot
  );
}

export async function createIssueEstimateContext(
  options: EstimateIssueContextOptions
): Promise<IssueEstimateContextResult> {
  const planComment = await options.forge.fetchIssuePlanComment(options.issueNumber);
  if (!planComment) {
    return createBlockedResult(options.issueNumber);
  }

  return {
    status: "ready",
    issueNumber: options.issueNumber,
    plan: {
      body: planComment.body,
    },
    planSource: {
      type: "managed-comment",
      url: planComment.url,
      updatedAt: planComment.updatedAt,
    },
    profiles: createEstimateProfiles(options.repositoryConfig),
    implementerProfileName: getImplementerProfileName(options.repositoryConfig),
    verificationCommands: createVerificationCommands(options.repositoryConfig),
    estimateInstructions: [
      "Use the managed issue plan as the source of truth for the implementation estimate.",
      "Do not scan the repository or require local file existence to determine confidence.",
      "Estimate implementation-session token usage for each configured profile.",
      "Base confidence on plan clarity, scope, verification breadth, unresolved questions, and explicit risk signals.",
      "Return only JSON matching the requested estimate artifact shape.",
    ].join(" "),
    outputSchema: {
      status: "estimated",
      issueNumber: options.issueNumber,
      planSource: {
        type: "managed-comment",
        url: planComment.url,
        updatedAt: planComment.updatedAt,
      },
      confidence: "high|medium|low",
      profiles:
        "Array of { name, role?, model, thinking, range: { low, high }, confidence, notes[] }.",
      recommendation: "Short recommendation for which configured profile to use.",
      drivers: "Array of concise estimate drivers.",
      warnings: "Array of caveats or plan-quality warnings.",
      assumptions: "Array of assumptions made by Codex while estimating.",
    },
  };
}

function formatRange(range: { low: number; high: number }): string {
  return `${range.low.toLocaleString()}-${range.high.toLocaleString()}`;
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatCostRange(range: { low: number; high: number }): string {
  return `${formatCost(range.low)}-${formatCost(range.high)}`;
}

function estimateCostRangeForProfile(profile: IssueEstimateArtifact["profiles"][number]): {
  low: number;
  high: number;
} {
  const normalizedModel = profile.model.toLowerCase();
  const rates =
    DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS.modelRates[profile.model] ??
    DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS.modelRates[normalizedModel] ??
    DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION;

  const blendedRate =
    rates.inputPerMillionTokens *
      DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS.inputTokenRatio +
    rates.outputPerMillionTokens *
      DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS.outputTokenRatio;

  return {
    low: Number(((profile.range.low / 1_000_000) * blendedRate).toFixed(2)),
    high: Number(((profile.range.high / 1_000_000) * blendedRate).toFixed(2)),
  };
}

function formatEstimateTableCell(value: string | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

type IssueEstimateDisplayProfile =
  | IssueEstimateArtifact["profiles"][number]
  | IssueImplementationTokenEstimate["profiles"][number];

function hasCostEstimateFields(
  profile: IssueEstimateDisplayProfile
): profile is IssueImplementationTokenEstimate["profiles"][number] {
  return "costRange" in profile && "costBasis" in profile;
}

function estimateResultToTelemetryRows(
  result: IssueEstimateToolResult | IssueEstimateArtifact
): TokenUsageLedgerRow[] {
  if (result.status === "blocked") {
    return [];
  }

  return result.profiles.map((profile) => ({
    id: `issue-estimate:${result.issueNumber}:${profile.name}`,
    kind: "estimate" as const,
    phase: "issue-estimate",
    ...(profile.role ? { role: profile.role } : {}),
    model: profile.model,
    modelSource: "configured",
    configuredProfile: profile.name,
    ...(profile.role ? { configuredRole: profile.role } : {}),
    configuredModel: profile.model,
    configuredThinking: profile.thinking,
    status: "estimated" as const,
    tokenRange: profile.range,
    costRange: hasCostEstimateFields(profile)
      ? profile.costRange
      : estimateCostRangeForProfile(profile),
    confidence: profile.confidence,
    capturedAt: result.planSource.updatedAt,
    recommendation: result.recommendation,
    drivers: result.drivers,
    warnings: result.warnings,
    assumptions: result.assumptions ?? [],
    notes: [
      `Plan source: ${result.planSource.url}`,
      ...profile.notes,
      "Costs are rough planning estimates, not exact billing.",
    ],
  }));
}

function formatProfileEstimateRow(profile: IssueEstimateDisplayProfile): string {
  return [
    "",
    formatEstimateTableCell(profile.name),
    formatEstimateTableCell(profile.role),
    formatEstimateTableCell(profile.model),
    "configured",
    formatEstimateTableCell(profile.confidence),
    formatRange(profile.range),
    hasCostEstimateFields(profile) ? formatCostRange(profile.costRange) : "",
    "",
    "",
    "",
  ].join(" | ");
}

export function renderIssueEstimate(
  result: IssueEstimateToolResult | IssueEstimateArtifact
): string {
  if (result.status === "blocked") {
    return [
      `Issue #${result.issueNumber} implementation estimate is blocked.`,
      "",
      result.message,
    ].join("\n");
  }

  return [
    `Implementation token estimate for issue #${result.issueNumber}`,
    "",
    `Plan source: ${result.planSource.url}`,
    `Confidence: ${result.confidence}`,
    "",
    "| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |",
    ...result.profiles.map(formatProfileEstimateRow),
    "",
    "Costs are rough planning estimates, not exact billing.",
    "",
    "Recommendation:",
    result.recommendation,
    "",
    "Drivers:",
    ...result.drivers.map((driver) => `- ${driver}`),
    ...(result.warnings.length > 0
      ? ["", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`)]
      : []),
    ...(result.assumptions && result.assumptions.length > 0
      ? ["", "Assumptions:", ...result.assumptions.map((assumption) => `- ${assumption}`)]
      : []),
  ].join("\n");
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid estimate artifact: ${field} must be a non-empty string.`);
  }
  return value;
}

function assertConfidence(value: unknown, field: string): "high" | "medium" | "low" {
  if (value !== "high" && value !== "medium" && value !== "low") {
    throw new Error(`Invalid estimate artifact: ${field} must be high, medium, or low.`);
  }
  return value;
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid estimate artifact: ${field} must be a string array.`);
  }
  return value;
}

export function parseIssueEstimateArtifact(value: unknown): IssueEstimateArtifact {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid estimate artifact: expected an object.");
  }
  const artifact = value as Record<string, unknown>;
  if (artifact.status !== "estimated") {
    throw new Error('Invalid estimate artifact: status must be "estimated".');
  }
  const planSource = artifact.planSource as Record<string, unknown> | undefined;
  if (typeof planSource !== "object" || planSource === null) {
    throw new Error("Invalid estimate artifact: planSource must be an object.");
  }
  const profiles = artifact.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error("Invalid estimate artifact: profiles must be a non-empty array.");
  }

  return {
    status: "estimated",
    issueNumber: Number(artifact.issueNumber),
    planSource: {
      type: "managed-comment",
      url: assertString(planSource.url, "planSource.url"),
      updatedAt: assertString(planSource.updatedAt, "planSource.updatedAt"),
    },
    confidence: assertConfidence(artifact.confidence, "confidence"),
    profiles: profiles.map((profileValue, index) => {
      if (typeof profileValue !== "object" || profileValue === null) {
        throw new Error(`Invalid estimate artifact: profiles[${index}] must be an object.`);
      }
      const profile = profileValue as Record<string, unknown>;
      const range = profile.range as Record<string, unknown> | undefined;
      if (typeof range !== "object" || range === null) {
        throw new Error(`Invalid estimate artifact: profiles[${index}].range must be an object.`);
      }
      return {
        name: assertString(profile.name, `profiles[${index}].name`),
        ...(typeof profile.role === "string" && profile.role.trim()
          ? { role: profile.role }
          : {}),
        model: assertString(profile.model, `profiles[${index}].model`),
        thinking: assertString(profile.thinking, `profiles[${index}].thinking`),
        range: {
          low: Number(range.low),
          high: Number(range.high),
        },
        confidence: assertConfidence(profile.confidence, `profiles[${index}].confidence`),
        notes: assertStringArray(profile.notes, `profiles[${index}].notes`),
      };
    }),
    recommendation: assertString(artifact.recommendation, "recommendation"),
    drivers: assertStringArray(artifact.drivers, "drivers"),
    warnings: assertStringArray(artifact.warnings, "warnings"),
    ...(artifact.assumptions === undefined
      ? {}
      : { assumptions: assertStringArray(artifact.assumptions, "assumptions") }),
  };
}

export async function publishIssueEstimateAudit(
  forge: IssueEstimateAuditForge,
  result: IssueEstimateToolResult | IssueEstimateArtifact
): Promise<IssueEstimateAuditPublication> {
  if (result.status === "blocked") {
    return {
      status: "skipped",
      reason: result.message,
    };
  }

  if (!forge.isAuthenticated()) {
    return {
      status: "skipped",
      reason:
        "GitHub authentication is required to publish prs audit artifacts.",
    };
  }

  const publication = await publishTokenUsageLedger(forge, {
    target: {
      type: "issue",
      number: result.issueNumber,
    },
    rows: estimateResultToTelemetryRows(result),
  });

  return {
    status: publication.status,
    url: publication.comment.url,
  };
}

export async function publishAutomaticIssueEstimate(input: {
  issueNumber: number;
  repoRoot: string;
  forge: IssueEstimateAuditForge & Pick<RepositoryForge, "fetchIssuePlanComment">;
  repositoryConfig: ResolvedRepositoryConfigType;
}): Promise<IssueEstimateAuditPublication> {
  try {
    const estimate = await estimateIssueTool(input);
    if (estimate.status === "blocked") {
      return {
        status: "skipped",
        reason: estimate.message,
      };
    }

    return await publishIssueEstimateAudit(input.forge, estimate);
  } catch (error) {
    return {
      status: "skipped",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function publishIssueEstimateFile(input: {
  issueNumber: number;
  estimateFilePath: string;
  forge: IssueEstimateAuditForge;
}): Promise<IssueEstimateAuditPublication> {
  const estimate = parseIssueEstimateArtifact(
    JSON.parse(readFileSync(input.estimateFilePath, "utf8"))
  );
  if (estimate.issueNumber !== input.issueNumber) {
    throw new Error(
      `Estimate artifact issueNumber ${estimate.issueNumber} does not match issue #${input.issueNumber}.`
    );
  }

  return publishIssueEstimateAudit(input.forge, estimate);
}
