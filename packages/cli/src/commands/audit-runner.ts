import { existsSync,readFileSync } from "node:fs";
import { isAbsolute,resolve } from "node:path";
import { publishAuditArtifact } from "../audit-artifacts";
import { getCliArgs,getDefaultRepoRoot,getRepositoryForge } from "../cli-context";
import { loadMediaEvidenceForPublication } from "../cli-git";
import type { AuditTarget } from "../forge";
import { appendMediaEvidenceSection } from "../media-evidence";
import {
  auditTargetToTokenUsageTarget,
  formatTokenUsageLedgerAuditSection,
  tokenUsageArtifactToLedgerRow,
  type TokenUsageArtifact,
  type TokenUsageLedgerRow,
} from "../token-audit";
import { parseAuditCommandArgs } from "./audit";

export async function runAuditCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const command = parseAuditCommandArgs(getCliArgs());
  const artifactPath = isAbsolute(command.filePath)
    ? command.filePath
    : resolve(repoRoot, command.filePath);

  if (!existsSync(artifactPath)) {
    throw new Error(`Audit artifact file does not exist: ${command.filePath}`);
  }

  const forge = getRepositoryForge(repoRoot);
  const content = readFileSync(artifactPath, "utf8").trim();
  if (!content) {
    throw new Error(`Audit artifact file is empty: ${command.filePath}`);
  }
  const auditContent = renderAuditContentForPublication({
    content,
    sectionName: command.sectionName,
    target: command.target,
  });
  const mediaEvidence = loadMediaEvidenceForPublication(repoRoot, command.mediaManifestFilePath);
  const contentWithMedia = appendMediaEvidenceSection(auditContent, mediaEvidence, {
    heading: "Visual Evidence",
  });

  const result = await publishAuditArtifact(forge, {
    target: command.target,
    sectionName: command.sectionName,
    content: contentWithMedia,
    localRun: command.localRun,
  });

  console.log(`Audit artifact ${result.status}: ${result.comment.url}`);
}

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
    : undefined;
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
    ...(usage && readNumberField(usage, "inputTokens") !== undefined
      ? { inputTokens: readNumberField(usage, "inputTokens") }
      : {}),
    ...(usage && readNumberField(usage, "outputTokens") !== undefined
      ? { outputTokens: readNumberField(usage, "outputTokens") }
      : {}),
    ...(usage && readNumberField(usage, "timeUsedSeconds") !== undefined
      ? { elapsedSeconds: readNumberField(usage, "timeUsedSeconds") }
      : {}),
    capturedAt,
    ...(capture && readStringField(capture, "runDir")
      ? { runDir: readStringField(capture, "runDir") }
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

  if (!capturedAt || (!objective && !note)) {
    return undefined;
  }

  return {
    phase: "issue-create",
    role: "planner",
    modelSource: "unavailable",
    status: normalizeTokenUsageStatus(readStringField(value, "status")),
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

function renderAuditContentForPublication(input: {
  content: string;
  sectionName: string;
  target: AuditTarget;
}): string {
  if (
    (input.target.type !== "issue" && input.target.type !== "pull-request") ||
    input.sectionName.trim().toLowerCase() !== "token-usage"
  ) {
    return input.content;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.content);
  } catch {
    return input.content;
  }

  const row = isTokenUsageArtifact(parsed)
    ? tokenUsageArtifactToLedgerRow(parsed)
    : normalizePlannerTokenUsageRow(parsed) ??
      normalizeLegacyPlannerTokenUsageRow(parsed) ??
      normalizeCodexAppGoalTrackerTokenUsageRow(parsed) ??
      normalizePlannerContinuationTokenUsageRow(parsed) ??
      normalizeCompletedGoalTokenUsageRow(parsed);
  if (!row) {
    return input.content;
  }

  return formatTokenUsageLedgerAuditSection({
    target: auditTargetToTokenUsageTarget(input.target),
    rows: [row],
  });
}
