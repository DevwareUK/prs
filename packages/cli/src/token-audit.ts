import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS,
  DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION,
  type IssueEstimateCostSettings,
} from "@prs/core";
import type { AuditTarget } from "./forge";

export type TokenUsageStatus = "tracked" | "partial" | "unavailable";

export type TokenUsageTarget = {
  type: "issue" | "pull-request";
  number: number;
};

export type TokenUsageArtifact = {
  version: 1;
  status: TokenUsageStatus;
  issueNumber?: number;
  target?: TokenUsageTarget;
  capturedAt: string;
  source: "codex-goal";
  runDir?: string;
  workflow?: {
    name:
      | "issue-create"
      | "issue-draft"
      | "issue-refine"
      | "issue-refine-questions"
      | "issue-refine-complete"
      | "issue-implementation"
      | "pr-ready"
      | "pr-review"
      | "pr-address-comments"
      | "pr-add-tests"
      | "pr-fix-tests"
      | "pr-resolve-conflicts"
      | string;
    role?: "planner" | "implementer" | "reviewer" | "tester" | string;
    runDir?: string;
    targetIssueNumber?: number;
    sourceIssueNumber?: number;
    targetPullRequestNumber?: number;
    sourcePullRequestNumber?: number;
  };
  goal?: {
    threadId?: string;
    objective?: string;
    status?: string;
  };
  model?: {
    profile?: string;
    role?: string;
    model?: string;
    id?: string;
    displayName?: string;
    thinking?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | string;
    source?:
      | "codex-session"
      | "configured-role"
      | "manual"
      | "operator-provided"
      | "unavailable";
    configuredProfile?: string;
    configuredRole?: string;
    configuredModel?: string;
    configuredThinking?: string;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    timeUsedSeconds?: number;
  };
  capturePhase?: "start" | "checkpoint" | "pre-audit-publish" | "post-audit-publish";
  auditPublication?: {
    status: "not-published" | "publishing" | "published" | "publish-failed";
    target?: "issue" | "pr";
    section?: string;
    publishedAt?: string;
    error?: string;
  };
  notes?: string[];
};

export type IssueTokenUsageArtifact = TokenUsageArtifact & {
  issueNumber: number;
};

export function getTokenUsageArtifactFilePath(runDir: string): string {
  return resolve(runDir, "codex-token-usage.json");
}

export function getIssueTokenUsageArtifactFilePath(runDir: string): string {
  return getTokenUsageArtifactFilePath(runDir);
}

function formatOptionalInteger(value: number | undefined): string | undefined {
  return value === undefined ? undefined : value.toLocaleString();
}

function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined) {
    return undefined;
  }

  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  const parts = [
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(minutes > 0 ? [`${minutes}m`] : []),
    `${remainingSeconds}s`,
  ];
  return parts.join(" ");
}

function formatWorkflowLines(
  workflow: TokenUsageArtifact["workflow"] | undefined
): string[] {
  if (!workflow) {
    return [];
  }

  return [
    `Workflow: ${workflow.name}`,
    ...(workflow.role ? [`Workflow role: ${workflow.role}`] : []),
    ...(workflow.sourceIssueNumber ? [`Source issue: #${workflow.sourceIssueNumber}`] : []),
    ...(workflow.targetIssueNumber ? [`Target issue: #${workflow.targetIssueNumber}`] : []),
    ...(workflow.sourcePullRequestNumber
      ? [`Source PR: #${workflow.sourcePullRequestNumber}`]
      : []),
    ...(workflow.targetPullRequestNumber
      ? [`Target PR: #${workflow.targetPullRequestNumber}`]
      : []),
    ...(workflow.runDir ? [`Run directory: ${workflow.runDir}`] : []),
  ];
}

function formatModelLines(model: TokenUsageArtifact["model"] | undefined): string[] {
  const modelName = model?.displayName ?? model?.model ?? model?.id;
  const profileName = model?.profile;
  const modelProfile =
    profileName && modelName && model?.thinking
      ? `Model/profile: ${profileName} (${modelName}, ${model.thinking} thinking)`
      : profileName && modelName
        ? `Model/profile: ${profileName} (${modelName})`
        : undefined;
  return [
    ...(modelProfile ? [modelProfile] : modelName ? [`Model: ${modelName}`] : []),
    ...(model?.role ? [`Workflow role: ${model.role}`] : []),
    ...(model?.source ? [`Model source: ${model.source}`] : []),
  ];
}

function formatCapturePhase(
  phase: TokenUsageArtifact["capturePhase"]
): string | undefined {
  return phase ? `Capture phase: ${phase}` : undefined;
}

function formatAuditPublication(
  publication: TokenUsageArtifact["auditPublication"] | undefined
): string[] {
  if (!publication) {
    return [];
  }

  const target = publication.target ? ` ${publication.target}` : "";
  const section = publication.section ? ` ${publication.section}` : "";
  return [
    `Audit publication: ${publication.status}${target}${section}`,
    ...(publication.publishedAt ? [`Audit published at: ${publication.publishedAt}`] : []),
    ...(publication.error ? [`Audit publication error: ${publication.error}`] : []),
  ];
}

export type TokenUsageLedgerRow = {
  phase: string;
  role?: string;
  model?: string;
  modelSource?: "actual" | "configured-fallback" | "manual" | "unavailable" | string;
  configuredProfile?: string;
  configuredRole?: string;
  configuredModel?: string;
  configuredThinking?: string;
  status: TokenUsageStatus;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  elapsedSeconds?: number;
  capturedAt: string;
  runDir?: string;
  notes?: string[];
};

export type IssueTokenUsageLedgerRow = TokenUsageLedgerRow;

export type IssueTokenUsageLedger = {
  issueNumber: number;
  rows: IssueTokenUsageLedgerRow[];
};

export type TokenUsageLedger = {
  target: TokenUsageTarget;
  rows: TokenUsageLedgerRow[];
};

export type PullRequestTokenUsageMetadata = {
  artifactFile: string;
  mode: "pr-token-usage-ledger";
  workflow: {
    name: string;
    role: string;
    targetPullRequestNumber: number;
    runDir: string;
  };
  auditPublication: {
    target: "pr";
    prNumber: number;
    section: "token-usage";
    publishWhen: string[];
  };
};

export function buildPullRequestTokenUsageMetadata(input: {
  artifactFile: string;
  workflowName: string;
  role: string;
  prNumber: number;
  runDir: string;
  publishWhen: string[];
}): PullRequestTokenUsageMetadata {
  return {
    artifactFile: input.artifactFile,
    mode: "pr-token-usage-ledger",
    workflow: {
      name: input.workflowName,
      role: input.role,
      targetPullRequestNumber: input.prNumber,
      runDir: input.runDir,
    },
    auditPublication: {
      target: "pr",
      prNumber: input.prNumber,
      section: "token-usage",
      publishWhen: input.publishWhen,
    },
  };
}

function formatLedgerCell(value: string | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatLedgerInteger(value: number | undefined): string {
  return formatOptionalInteger(value) ?? "";
}

function formatLedgerCost(value: number | undefined): string {
  return value === undefined ? "" : `$${value.toFixed(2)}`;
}

function estimateLedgerRowCost(
  row: TokenUsageLedgerRow,
  costSettings: IssueEstimateCostSettings
): number | undefined {
  if (row.totalTokens === undefined || !row.model) {
    return undefined;
  }

  const normalizedModel = row.model.toLowerCase();
  const rates =
    costSettings.modelRates[row.model] ??
    costSettings.modelRates[normalizedModel] ??
    DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION;
  const blendedRate =
    rates.inputPerMillionTokens * costSettings.inputTokenRatio +
    rates.outputPerMillionTokens * costSettings.outputTokenRatio;

  return Number(((row.totalTokens / 1_000_000) * blendedRate).toFixed(2));
}

function resolveLedgerModelSource(
  model: TokenUsageArtifact["model"] | undefined
): TokenUsageLedgerRow["modelSource"] {
  if (!model) {
    return "unavailable";
  }

  if (model.source === "codex-session" || model.source === "operator-provided") {
    return "actual";
  }

  if (model.source === "configured-role") {
    return "configured-fallback";
  }

  return model.source ?? "unavailable";
}

export function tokenUsageArtifactToLedgerRow(
  artifact: TokenUsageArtifact
): TokenUsageLedgerRow {
  const modelName =
    artifact.model?.displayName ?? artifact.model?.model ?? artifact.model?.id;
  return {
    phase: artifact.workflow?.name ?? "issue-implementation",
    role: artifact.workflow?.role ?? artifact.model?.role,
    ...(modelName ? { model: modelName } : {}),
    modelSource: resolveLedgerModelSource(artifact.model),
    ...(artifact.model?.configuredProfile
      ? { configuredProfile: artifact.model.configuredProfile }
      : {}),
    ...(artifact.model?.configuredRole
      ? { configuredRole: artifact.model.configuredRole }
      : {}),
    ...(artifact.model?.configuredModel
      ? { configuredModel: artifact.model.configuredModel }
      : {}),
    ...(artifact.model?.configuredThinking
      ? { configuredThinking: artifact.model.configuredThinking }
      : {}),
    status: artifact.status,
    ...(artifact.usage?.totalTokens === undefined
      ? {}
      : { totalTokens: artifact.usage.totalTokens }),
    ...(artifact.usage?.inputTokens === undefined
      ? {}
      : { inputTokens: artifact.usage.inputTokens }),
    ...(artifact.usage?.outputTokens === undefined
      ? {}
      : { outputTokens: artifact.usage.outputTokens }),
    ...(artifact.usage?.timeUsedSeconds === undefined
      ? {}
      : { elapsedSeconds: artifact.usage.timeUsedSeconds }),
    capturedAt: artifact.capturedAt,
    ...(artifact.workflow?.runDir ?? artifact.runDir
      ? { runDir: artifact.workflow?.runDir ?? artifact.runDir }
      : {}),
    notes: [
      ...formatAuditPublication(artifact.auditPublication),
      ...(artifact.notes ?? []),
    ],
  };
}

export function issueTokenUsageArtifactToLedgerRow(
  artifact: IssueTokenUsageArtifact
): IssueTokenUsageLedgerRow {
  return tokenUsageArtifactToLedgerRow(artifact);
}

export function formatTokenUsageLedgerAuditSection(
  ledger: TokenUsageLedger,
  costSettings: IssueEstimateCostSettings = DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS
): string {
  const targetLabel =
    ledger.target.type === "issue"
      ? `issue #${ledger.target.number}`
      : `PR #${ledger.target.number}`;
  const lines = [
    `Codex token usage ledger for ${targetLabel}.`,
    "",
    "| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |",
  ];

  for (const row of ledger.rows) {
    const estimatedCost = estimateLedgerRowCost(row, costSettings);
    lines.push(
      [
        "",
        formatLedgerCell(row.phase),
        formatLedgerCell(row.role),
        formatLedgerCell(row.model),
        formatLedgerCell(row.modelSource),
        formatLedgerCell(row.status),
        formatLedgerInteger(row.totalTokens),
        formatLedgerCost(estimatedCost),
        formatDuration(row.elapsedSeconds) ?? "",
        formatLedgerCell(row.capturedAt),
        "",
      ].join(" | ")
    );
  }

  lines.push(
    "",
    "This ledger reports available Codex run telemetry, not exact billing."
  );

  return lines.join("\n");
}

export function formatIssueTokenUsageLedgerAuditSection(
  ledger: IssueTokenUsageLedger,
  costSettings: IssueEstimateCostSettings = DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS
): string {
  return formatTokenUsageLedgerAuditSection(
    {
      target: {
        type: "issue",
        number: ledger.issueNumber,
      },
      rows: ledger.rows,
    },
    costSettings
  );
}

export function writeIssueTokenUsageArtifact(
  filePath: string,
  artifact: IssueTokenUsageArtifact
): void {
  writeFileSync(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

export function formatIssueTokenUsageAuditSection(
  artifact: IssueTokenUsageArtifact
): string {
  if (artifact.status === "unavailable") {
    return [
      `Token usage was unavailable for issue #${artifact.issueNumber}.`,
      "",
      `Captured at: ${artifact.capturedAt}`,
      ...formatWorkflowLines(artifact.workflow),
      ...formatModelLines(artifact.model),
      ...(formatCapturePhase(artifact.capturePhase)
        ? [formatCapturePhase(artifact.capturePhase) as string]
        : []),
      ...formatAuditPublication(artifact.auditPublication),
      ...(artifact.notes?.length
        ? ["", "Notes:", ...artifact.notes.map((note) => `- ${note}`)]
        : []),
    ].join("\n");
  }

  const lines = [
    `Codex token usage for issue #${artifact.issueNumber}.`,
    "",
    `Status: ${artifact.status}`,
    `Captured at: ${artifact.capturedAt}`,
  ];
  const totalTokens = formatOptionalInteger(artifact.usage?.totalTokens);
  const inputTokens = formatOptionalInteger(artifact.usage?.inputTokens);
  const outputTokens = formatOptionalInteger(artifact.usage?.outputTokens);
  const elapsed = formatDuration(artifact.usage?.timeUsedSeconds);

  lines.push(...formatWorkflowLines(artifact.workflow));
  lines.push(...formatModelLines(artifact.model));
  const capturePhase = formatCapturePhase(artifact.capturePhase);
  if (capturePhase) {
    lines.push(capturePhase);
  }
  lines.push(...formatAuditPublication(artifact.auditPublication));
  if (totalTokens) {
    lines.push(`Total tokens: ${totalTokens}`);
  }
  if (inputTokens) {
    lines.push(`Input tokens: ${inputTokens}`);
  }
  if (outputTokens) {
    lines.push(`Output tokens: ${outputTokens}`);
  }
  if (elapsed) {
    lines.push(`Elapsed time: ${elapsed}`);
  }
  if (artifact.goal?.objective) {
    lines.push(`Goal: ${artifact.goal.objective}`);
  }
  if (artifact.notes?.length) {
    lines.push("", "Notes:", ...artifact.notes.map((note) => `- ${note}`));
  }

  return lines.join("\n");
}

export function auditTargetToTokenUsageTarget(target: AuditTarget): TokenUsageTarget {
  return target.type === "issue"
    ? { type: "issue", number: target.number }
    : { type: "pull-request", number: target.number };
}
