import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS,
  DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION,
  type IssueEstimateCostSettings,
} from "@prs/core";
import type { AuditTarget } from "./forge";

export type TokenUsageStatus = "tracked" | "partial" | "unavailable";
export type TokenTelemetryStatus = TokenUsageStatus | "estimated";

export type TokenUsageTarget = {
  type: "issue" | "pull-request";
  number: number;
};

export type TokenUsageArtifact = {
  version: 1;
  id?: string;
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

export type TokenUsageLedgerArtifact = {
  version: 1;
  kind: "token-usage-ledger";
  target?: TokenUsageTarget;
  entries: TokenUsageArtifact[];
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
  id?: string;
  kind?: "actual" | "estimate";
  phase: string;
  role?: string;
  model?: string;
  modelSource?: "actual" | "configured-fallback" | "manual" | "unavailable" | string;
  configuredProfile?: string;
  configuredRole?: string;
  configuredModel?: string;
  configuredThinking?: string;
  status: TokenTelemetryStatus;
  totalTokens?: number;
  tokenRange?: {
    low: number;
    high: number;
  };
  costRange?: {
    low: number;
    high: number;
  };
  confidence?: "high" | "medium" | "low" | string;
  inputTokens?: number;
  outputTokens?: number;
  elapsedSeconds?: number;
  capturedAt: string;
  runDir?: string;
  sessionId?: string;
  recommendation?: string;
  drivers?: string[];
  warnings?: string[];
  assumptions?: string[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(
  record: Record<string, unknown>,
  field: string
): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function readNumberField(
  record: Record<string, unknown>,
  field: string
): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isTokenUsageArtifact(value: unknown): value is TokenUsageArtifact {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    (value.status === "tracked" ||
      value.status === "partial" ||
      value.status === "unavailable") &&
    typeof value.capturedAt === "string" &&
    value.source === "codex-goal" &&
    (typeof value.issueNumber === "number" ||
      (isRecord(value.target) &&
        (value.target.type === "issue" || value.target.type === "pull-request") &&
        typeof value.target.number === "number"))
  );
}

function normalizeTokenUsageStatus(
  value: string | undefined
): TokenUsageArtifact["status"] {
  if (value === "available" || value === "captured" || value === "complete") {
    return "tracked";
  }

  if (value === "tracked" || value === "partial" || value === "unavailable") {
    return value;
  }

  return "partial";
}

function normalizePlannerTokenUsageRow(
  value: unknown
): TokenUsageLedgerRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const phase = readStringField(value, "phase");
  const role = readStringField(value, "role");
  const profile = isRecord(value.profile) ? value.profile : undefined;
  const usage = isRecord(value.usage) ? value.usage : undefined;
  const capture = isRecord(value.capture) ? value.capture : undefined;
  const capturedAt =
    (capture ? readStringField(capture, "capturedAt") : undefined) ??
    readStringField(value, "capturedAt") ??
    readStringField(value, "recordedAt") ??
    readStringField(value, "createdAt") ??
    "unavailable";

  if (!phase) {
    return undefined;
  }

  const resolvedRole =
    role ?? (phase === "issue-draft" || phase === "issue-create" ? "planner" : undefined);
  const profileSource = profile ? readStringField(profile, "source") : undefined;
  const modelSource = profileSource?.toLowerCase().includes("fallback")
    ? "configured-fallback"
    : profileSource;
  const totalTokens = usage
    ? readNumberField(usage, "totalTokens") ?? readNumberField(usage, "tokensUsed")
    : readNumberField(value, "totalTokens") ?? readNumberField(value, "tokensUsed");
  const inputTokens = usage
    ? readNumberField(usage, "inputTokens")
    : readNumberField(value, "inputTokens");
  const outputTokens = usage
    ? readNumberField(usage, "outputTokens")
    : readNumberField(value, "outputTokens");
  const elapsedSeconds = usage
    ? readNumberField(usage, "timeUsedSeconds") ??
      readNumberField(usage, "elapsedSeconds")
    : readNumberField(value, "timeUsedSeconds") ??
      readNumberField(value, "elapsedSeconds");
  const notes = [
    ...(isRecord(value.actualModel) && readStringField(value.actualModel, "notes")
      ? [readStringField(value.actualModel, "notes") as string]
      : []),
    ...(usage && readStringField(usage, "notes")
      ? [readStringField(usage, "notes") as string]
      : []),
    ...(readStringField(value, "notes") ? [readStringField(value, "notes") as string] : []),
  ];

  return {
    ...(readStringField(value, "id") ? { id: readStringField(value, "id") } : {}),
    phase,
    ...(resolvedRole ? { role: resolvedRole } : {}),
    ...(profile && readStringField(profile, "model")
      ? { model: readStringField(profile, "model") }
      : {}),
    modelSource: modelSource ?? "unavailable",
    ...(profile && readStringField(profile, "name")
      ? { configuredProfile: readStringField(profile, "name") }
      : {}),
    ...(resolvedRole ? { configuredRole: resolvedRole } : {}),
    ...(profile && readStringField(profile, "model")
      ? { configuredModel: readStringField(profile, "model") }
      : {}),
    ...(profile && readStringField(profile, "thinking")
      ? { configuredThinking: readStringField(profile, "thinking") }
      : {}),
    status: normalizeTokenUsageStatus(
      (usage ? readStringField(usage, "status") : undefined) ??
        readStringField(value, "status")
    ),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(elapsedSeconds !== undefined ? { elapsedSeconds } : {}),
    capturedAt,
    ...(capture && readStringField(capture, "runDir")
      ? { runDir: readStringField(capture, "runDir") }
      : {}),
    ...(readStringField(value, "sessionId")
      ? { sessionId: readStringField(value, "sessionId") }
      : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function normalizeLegacyPlannerTokenUsageRow(
  value: unknown
): TokenUsageLedgerRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const capturedAt = readStringField(value, "createdAt");
  const configuredPlannerProfile = isRecord(value.configuredPlannerProfile)
    ? value.configuredPlannerProfile
    : undefined;

  if (!capturedAt || !configuredPlannerProfile) {
    return undefined;
  }

  const actualSessionModel = readStringField(value, "actualSessionModel");
  const configuredModel = readStringField(configuredPlannerProfile, "model");
  const role = readStringField(configuredPlannerProfile, "role") ?? "planner";
  const model = actualSessionModel ?? configuredModel;
  const notes = [
    ...(readStringField(value, "notes") ? [readStringField(value, "notes") as string] : []),
    ...(readStringField(value, "objective")
      ? [`Objective: ${readStringField(value, "objective") as string}`]
      : []),
  ];

  return {
    ...(readStringField(value, "id") ? { id: readStringField(value, "id") } : {}),
    phase: "issue-create",
    role,
    ...(model ? { model } : {}),
    modelSource: actualSessionModel ? "actual" : "configured-fallback",
    ...(readStringField(configuredPlannerProfile, "profile")
      ? { configuredProfile: readStringField(configuredPlannerProfile, "profile") }
      : {}),
    configuredRole: role,
    ...(configuredModel ? { configuredModel } : {}),
    ...(readStringField(configuredPlannerProfile, "thinking")
      ? { configuredThinking: readStringField(configuredPlannerProfile, "thinking") }
      : {}),
    status: normalizeTokenUsageStatus(readStringField(value, "status")),
    ...(readNumberField(value, "tokensUsed") !== undefined
      ? { totalTokens: readNumberField(value, "tokensUsed") }
      : {}),
    ...(readNumberField(value, "timeUsedSeconds") !== undefined
      ? { elapsedSeconds: readNumberField(value, "timeUsedSeconds") }
      : {}),
    capturedAt,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function normalizeCodexAppGoalTrackerTokenUsageRow(
  value: unknown
): TokenUsageLedgerRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (readStringField(value, "source") !== "Codex app goal tracker") {
    return undefined;
  }

  const totalTokens = readNumberField(value, "tokensUsed");
  const capturedAt = readStringField(value, "capturedAt") ?? "unavailable";
  const model = isRecord(value.model) ? value.model : undefined;
  const actualModel = model ? readStringField(model, "actual") : undefined;
  const notes = [
    ...(model && readStringField(model, "notes")
      ? [readStringField(model, "notes") as string]
      : []),
    ...(readStringField(value, "goal")
      ? [`Goal: ${readStringField(value, "goal") as string}`]
      : []),
  ];

  return {
    ...(readStringField(value, "id") ? { id: readStringField(value, "id") } : {}),
    phase: "issue-create",
    role: "planner",
    ...(actualModel ? { model: actualModel } : {}),
    modelSource: actualModel ? "actual" : "unavailable",
    status: normalizeTokenUsageStatus(readStringField(value, "status")),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(readNumberField(value, "timeUsedSeconds") !== undefined
      ? { elapsedSeconds: readNumberField(value, "timeUsedSeconds") }
      : {}),
    capturedAt,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function normalizePlannerContinuationTokenUsageRow(
  value: unknown
): TokenUsageLedgerRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const capturedAt = readStringField(value, "capturedAt");
  const objective = readStringField(value, "objective");
  const note = readStringField(value, "note");
  const reportedTokens = note?.match(/reported\s+([\d,]+)\s+tokens?\s+used/i)?.[1];
  const reportedSeconds = note?.match(/([\d,]+)\s+seconds?\s+elapsed/i)?.[1];

  if (!capturedAt || (!objective && !note)) {
    return undefined;
  }

  return {
    ...(readStringField(value, "id") ? { id: readStringField(value, "id") } : {}),
    phase: "issue-create",
    role: "planner",
    modelSource: "unavailable",
    status: normalizeTokenUsageStatus(readStringField(value, "status")),
    ...(reportedTokens
      ? { totalTokens: Number.parseInt(reportedTokens.replace(/,/g, ""), 10) }
      : {}),
    ...(reportedSeconds
      ? { elapsedSeconds: Number.parseInt(reportedSeconds.replace(/,/g, ""), 10) }
      : {}),
    capturedAt,
    notes: [
      ...(note ? [note] : []),
      ...(objective ? [`Objective: ${objective}`] : []),
    ],
  };
}

function parseConfiguredProfileLabel(value: string | undefined): {
  profile?: string;
  model?: string;
  thinking?: string;
} {
  if (!value) {
    return {};
  }

  const match = value.match(/^([^()]+?)\s*\(([^,()]+)(?:,\s*([^()]+?))?\)$/);
  if (!match) {
    return { profile: value };
  }

  const thinking = match[3]?.replace(/\s+thinking$/i, "").trim();
  return {
    profile: match[1]?.trim(),
    model: match[2]?.trim(),
    ...(thinking ? { thinking } : {}),
  };
}

function normalizeCompletedGoalTokenUsageRow(
  value: unknown
): TokenUsageLedgerRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const totalTokens = readNumberField(value, "tokensUsed");
  if (totalTokens === undefined) {
    return undefined;
  }

  const role = readStringField(value, "workflowRole");
  const phase =
    readStringField(value, "phase") ??
    (role === "implementer" ? "issue-implementation" : undefined);
  if (!phase) {
    return undefined;
  }

  const configuredProfile = parseConfiguredProfileLabel(
    readStringField(value, "configuredProfile")
  );
  const actualSessionModel = readStringField(value, "actualSessionModel");
  const capturedAt =
    readStringField(value, "updatedAt") ??
    readStringField(value, "createdAt") ??
    "unavailable";
  const notes = [
    ...(readStringField(value, "notes") ? [readStringField(value, "notes") as string] : []),
    ...(readStringField(value, "objective")
      ? [`Objective: ${readStringField(value, "objective") as string}`]
      : []),
    ...(readStringField(value, "pullRequest")
      ? [`Pull request: ${readStringField(value, "pullRequest") as string}`]
      : []),
  ];

  return {
    ...(readStringField(value, "id") ? { id: readStringField(value, "id") } : {}),
    phase,
    ...(role ? { role } : {}),
    ...(actualSessionModel ?? configuredProfile.model
      ? { model: actualSessionModel ?? configuredProfile.model }
      : {}),
    modelSource: actualSessionModel ? "actual" : "configured-fallback",
    ...(configuredProfile.profile ? { configuredProfile: configuredProfile.profile } : {}),
    ...(role ? { configuredRole: role } : {}),
    ...(configuredProfile.model ? { configuredModel: configuredProfile.model } : {}),
    ...(configuredProfile.thinking ? { configuredThinking: configuredProfile.thinking } : {}),
    status: normalizeTokenUsageStatus(readStringField(value, "status")),
    totalTokens,
    ...(readNumberField(value, "timeUsedSeconds") !== undefined
      ? { elapsedSeconds: readNumberField(value, "timeUsedSeconds") }
      : {}),
    capturedAt,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

export function parseTokenUsageLedgerRowFromJsonValue(
  value: unknown
): TokenUsageLedgerRow | undefined {
  return isTokenUsageArtifact(value)
    ? tokenUsageArtifactToLedgerRow(value)
    : normalizePlannerTokenUsageRow(value) ??
        normalizeLegacyPlannerTokenUsageRow(value) ??
        normalizeCodexAppGoalTrackerTokenUsageRow(value) ??
        normalizePlannerContinuationTokenUsageRow(value) ??
        normalizeCompletedGoalTokenUsageRow(value);
}

export function parseTokenUsageLedgerRowsFromJsonValue(
  value: unknown
): TokenUsageLedgerRow[] {
  if (isRecord(value) && Array.isArray(value.entries)) {
    return value.entries
      .map((entry) => parseTokenUsageLedgerRowFromJsonValue(entry))
      .filter((row): row is TokenUsageLedgerRow => row !== undefined);
  }

  if (isRecord(value) && Array.isArray(value.auditLogs)) {
    return value.auditLogs
      .map((entry) => parseTokenUsageLedgerRowFromJsonValue(entry))
      .filter((row): row is TokenUsageLedgerRow => row !== undefined);
  }

  const row = parseTokenUsageLedgerRowFromJsonValue(value);
  return row ? [row] : [];
}

export function parseTokenUsageLedgerRowFromContent(
  content: string
): TokenUsageLedgerRow | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }

  return parseTokenUsageLedgerRowFromJsonValue(parsed);
}

export function parseTokenUsageLedgerRowsFromContent(
  content: string
): TokenUsageLedgerRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  return parseTokenUsageLedgerRowsFromJsonValue(parsed);
}

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

function formatLedgerRange(range: { low: number; high: number } | undefined): string {
  if (!range) {
    return "";
  }

  return `${range.low.toLocaleString()}-${range.high.toLocaleString()}`;
}

function formatLedgerCost(value: number | undefined): string {
  return value === undefined ? "" : `$${value.toFixed(2)}`;
}

function formatLedgerCostRange(
  range: { low: number; high: number } | undefined
): string {
  if (!range) {
    return "";
  }

  return `${formatLedgerCost(range.low)}-${formatLedgerCost(range.high)}`;
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

function formatLedgerStatus(row: TokenUsageLedgerRow): string {
  return row.kind === "estimate" && row.confidence
    ? `${row.status} (${row.confidence})`
    : row.status;
}

function formatLedgerTokenCell(row: TokenUsageLedgerRow): string {
  return row.tokenRange
    ? formatLedgerRange(row.tokenRange)
    : formatLedgerInteger(row.totalTokens);
}

function formatLedgerCostCell(
  row: TokenUsageLedgerRow,
  costSettings: IssueEstimateCostSettings
): string {
  if (row.costRange) {
    return formatLedgerCostRange(row.costRange);
  }

  return formatLedgerCost(estimateLedgerRowCost(row, costSettings));
}

function estimateRowLabel(row: TokenUsageLedgerRow): string {
  if (row.configuredProfile) {
    return row.configuredProfile;
  }

  const idSuffix = row.id?.split(":").filter(Boolean).at(-1);
  return idSuffix ?? row.model ?? row.phase;
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
    ...(artifact.id ? { id: artifact.id } : {}),
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
    ...(artifact.goal?.threadId ? { sessionId: artifact.goal.threadId } : {}),
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
    `Codex token telemetry ledger for ${targetLabel}.`,
    "",
    "| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |",
  ];

  for (const row of ledger.rows) {
    lines.push(
      [
        "",
        formatLedgerCell(row.phase),
        formatLedgerCell(row.role),
        formatLedgerCell(row.model),
        formatLedgerCell(row.modelSource),
        formatLedgerCell(formatLedgerStatus(row)),
        formatLedgerTokenCell(row),
        formatLedgerCostCell(row, costSettings),
        formatDuration(row.elapsedSeconds) ?? "",
        formatLedgerCell(row.capturedAt),
        "",
      ].join(" | ")
    );
  }

  const estimateRows = ledger.rows.filter(
    (row) =>
      row.kind === "estimate" &&
      (row.recommendation ||
        row.drivers?.length ||
        row.warnings?.length ||
        row.assumptions?.length ||
        row.notes?.length)
  );
  if (estimateRows.length > 0) {
    lines.push("", "Estimate recommendations:");
    for (const row of estimateRows) {
      if (row.recommendation) {
        lines.push(`- ${estimateRowLabel(row)}: ${row.recommendation}`);
      }
    }

    const detailGroups = [
      ["Estimate drivers", "drivers"],
      ["Estimate warnings", "warnings"],
      ["Estimate assumptions", "assumptions"],
      ["Estimate notes", "notes"],
    ] as const;
    for (const [heading, field] of detailGroups) {
      const values = estimateRows.flatMap((row) => row[field] ?? []);
      if (values.length > 0) {
        lines.push("", `${heading}:`, ...values.map((value) => `- ${value}`));
      }
    }
  }

  lines.push(
    "",
    "This ledger reports available Codex run telemetry and planning forecasts, not exact billing."
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
