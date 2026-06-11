import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  estimateIssueImplementationTokens,
  extractIssueImplementationPlanFiles,
  filterRepositoryPaths,
  type IssueEstimateFileContext,
  type IssueImplementationTokenEstimate,
} from "@prs/core";
import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import type { IssuePlanComment, RepositoryForge } from "./forge";

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

type EstimateIssueToolOptions = {
  issueNumber: number;
  repoRoot: string;
  forge: Pick<RepositoryForge, "fetchIssuePlanComment">;
  repositoryConfig: ResolvedRepositoryConfigType;
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
    ...config.prReadiness.commands.map((command) => command.command),
  ];
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

function formatRange(range: { low: number; high: number }): string {
  return `${range.low.toLocaleString()}-${range.high.toLocaleString()} tokens`;
}

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatCostRange(range: { low: number; high: number }): string {
  return `${formatCost(range.low)}-${formatCost(range.high)}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function renderIssueEstimate(result: IssueEstimateToolResult): string {
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
    "Model/profile estimates:",
    ...result.profiles.map(
      (profile) =>
        `- ${profile.name} (${profile.model}, ${profile.thinking} thinking): ${formatRange(
          profile.range
        )} (~${formatCostRange(profile.costRange)} at $${profile.costBasis.blendedRatePerMillionTokens.toFixed(
          2
        )}/1M blended) [${profile.confidence}]`
    ),
    "",
    `Cost basis: approximate ${result.cost.currency} planning cost uses an ${formatPercent(
      result.cost.inputTokenRatio
    )} input / ${formatPercent(result.cost.outputTokenRatio)} output token split.`,
    "Per-model blended rates come from PRS defaults unless overridden in `.prs/config.json`.",
    "Actual billing can vary with model pricing, input/output mix, cached tokens, retries, and future price changes.",
    "",
    "Recommendation:",
    result.recommendation,
    "",
    "Drivers:",
    ...result.drivers.map((driver) => `- ${driver}`),
    ...(result.warnings.length > 0
      ? ["", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`)]
      : []),
    "",
    `Scan budget: ${result.scanBudget.status} (${result.scanBudget.filesScanned}/${result.scanBudget.filesConsidered} files scanned, max ${result.scanBudget.maxFiles})`,
  ].join("\n");
}
