import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AuditTarget } from "../forge";
import { publishAuditArtifact } from "../audit-artifacts";
import { getCliArgs, getDefaultRepoRoot, getRepositoryForge } from "../cli-context";
import { appendMediaEvidenceSection } from "../media-evidence";
import {
  formatIssueTokenUsageLedgerAuditSection,
  issueTokenUsageArtifactToLedgerRow,
  type IssueTokenUsageArtifact,
  type IssueTokenUsageLedgerRow,
} from "../run-artifacts";
import { loadMediaEvidenceForPublication } from "../cli-runtime";
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

function isIssueTokenUsageArtifact(value: unknown): value is IssueTokenUsageArtifact {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.version === 1 &&
    (value.status === "tracked" ||
      value.status === "partial" ||
      value.status === "unavailable") &&
    typeof value.issueNumber === "number" &&
    typeof value.capturedAt === "string" &&
    value.source === "codex-goal"
  );
}

function normalizeTokenUsageStatus(
  value: string | undefined
): IssueTokenUsageArtifact["status"] {
  if (value === "tracked" || value === "partial" || value === "unavailable") {
    return value;
  }

  return "partial";
}

function normalizePlannerTokenUsageRow(
  value: unknown
): IssueTokenUsageLedgerRow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const phase = readStringField(value, "phase");
  const role = readStringField(value, "role");
  const profile = isRecord(value.profile) ? value.profile : undefined;
  const usage = isRecord(value.usage) ? value.usage : undefined;
  const capture = isRecord(value.capture) ? value.capture : undefined;
  const capturedAt = capture ? readStringField(capture, "capturedAt") : undefined;

  if (!phase || !capturedAt) {
    return undefined;
  }

  const profileSource = profile ? readStringField(profile, "source") : undefined;
  const modelSource = profileSource?.toLowerCase().includes("fallback")
    ? "configured-fallback"
    : profileSource;
  const notes = [
    ...(isRecord(value.actualModel) && readStringField(value.actualModel, "notes")
      ? [readStringField(value.actualModel, "notes") as string]
      : []),
    ...(usage && readStringField(usage, "notes")
      ? [readStringField(usage, "notes") as string]
      : []),
  ];

  return {
    phase,
    ...(role ? { role } : {}),
    ...(profile && readStringField(profile, "model")
      ? { model: readStringField(profile, "model") }
      : {}),
    ...(modelSource ? { modelSource } : {}),
    ...(profile && readStringField(profile, "name")
      ? { configuredProfile: readStringField(profile, "name") }
      : {}),
    ...(role ? { configuredRole: role } : {}),
    ...(profile && readStringField(profile, "model")
      ? { configuredModel: readStringField(profile, "model") }
      : {}),
    ...(profile && readStringField(profile, "thinking")
      ? { configuredThinking: readStringField(profile, "thinking") }
      : {}),
    status: normalizeTokenUsageStatus(usage ? readStringField(usage, "status") : undefined),
    ...(usage && readNumberField(usage, "totalTokens") !== undefined
      ? { totalTokens: readNumberField(usage, "totalTokens") }
      : {}),
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

function renderAuditContentForPublication(input: {
  content: string;
  sectionName: string;
  target: AuditTarget;
}): string {
  if (
    input.target.type !== "issue" ||
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

  const row = isIssueTokenUsageArtifact(parsed)
    ? issueTokenUsageArtifactToLedgerRow(parsed)
    : normalizePlannerTokenUsageRow(parsed);
  if (!row) {
    return input.content;
  }

  return formatIssueTokenUsageLedgerAuditSection({
    issueNumber: input.target.number,
    rows: [row],
  });
}


