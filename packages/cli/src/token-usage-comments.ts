import type { AuditTarget, RepositoryComment, RepositoryForge } from "./forge";
import {
  auditTargetToTokenUsageTarget,
  formatTokenUsageLedgerAuditSection,
  type TokenUsageStatus,
  type TokenUsageLedgerRow,
  type TokenUsageTarget,
} from "./token-audit";

export const TOKEN_USAGE_COMMENT_MARKER = "<!-- prs:token-usage -->";
const TOKEN_USAGE_DATA_START = "<!-- prs:token-usage-data";
const TOKEN_USAGE_DATA_END = "-->";

export type TokenUsagePublishResult = {
  status: "created" | "updated";
  comment: RepositoryComment;
};

function tokenUsageTargetLabel(target: TokenUsageTarget): string {
  return target.type === "pull-request"
    ? `Pull request #${target.number}`
    : `Issue #${target.number}`;
}

export function renderTokenUsageCommentBody(input: {
  target: TokenUsageTarget;
  rows: TokenUsageLedgerRow[];
}): string {
  return [
    TOKEN_USAGE_COMMENT_MARKER,
    "",
    `# ${tokenUsageTargetLabel(input.target)} token usage`,
    "",
    formatTokenUsageLedgerAuditSection(input),
    "",
    TOKEN_USAGE_DATA_START,
    JSON.stringify({ version: 1, rows: input.rows }, null, 2),
    TOKEN_USAGE_DATA_END,
  ].join("\n");
}

function parseStructuredRowsFromCommentBody(body: string): TokenUsageLedgerRow[] {
  const startIndex = body.indexOf(TOKEN_USAGE_DATA_START);
  if (startIndex < 0) {
    return [];
  }

  const jsonStartIndex = body.indexOf("\n", startIndex);
  if (jsonStartIndex < 0) {
    return [];
  }

  const endIndex = body.indexOf(TOKEN_USAGE_DATA_END, jsonStartIndex);
  if (endIndex < 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(body.slice(jsonStartIndex, endIndex).trim()) as {
      rows?: unknown;
    };
    return Array.isArray(parsed.rows)
      ? parsed.rows.filter((row): row is TokenUsageLedgerRow => {
          return (
            typeof row === "object" &&
            row !== null &&
            "phase" in row &&
            "status" in row &&
            "capturedAt" in row
          );
        })
      : [];
  } catch {
    return [];
  }
}

function parseIntegerCell(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const normalized = value.replace(/,/g, "").trim();
  return /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : undefined;
}

function parseDurationCell(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const match = value.match(/^(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?$/);
  if (!match) {
    return undefined;
  }

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function parseTokenUsageStatus(value: string): TokenUsageStatus | undefined {
  return value === "tracked" || value === "partial" || value === "unavailable"
    ? value
    : undefined;
}

export function parseTokenUsageRowsFromCommentBody(
  body: string
): TokenUsageLedgerRow[] {
  if (!body.includes(TOKEN_USAGE_COMMENT_MARKER)) {
    return [];
  }

  const structuredRows = parseStructuredRowsFromCommentBody(body);
  if (structuredRows.length > 0) {
    return structuredRows;
  }

  return body
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"))
    .filter((line) => !line.includes("---"))
    .filter((line) => !line.includes("Phase | Role | Model"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .map((cells) => cells.slice(1, -1))
    .map((cells) => {
      const [
        phase,
        role,
        model,
        modelSource,
        status,
        totalTokens,
        ,
        elapsed,
        capturedAt,
      ] = cells;
      const parsedStatus = parseTokenUsageStatus(status ?? "");
      if (!phase || !parsedStatus || !capturedAt) {
        return undefined;
      }

      return {
        phase,
        ...(role ? { role } : {}),
        ...(model ? { model } : {}),
        ...(modelSource ? { modelSource } : {}),
        status: parsedStatus,
        ...(parseIntegerCell(totalTokens) !== undefined
          ? { totalTokens: parseIntegerCell(totalTokens) }
          : {}),
        ...(parseDurationCell(elapsed) !== undefined
          ? { elapsedSeconds: parseDurationCell(elapsed) }
          : {}),
        capturedAt,
      };
    })
    .filter((row): row is TokenUsageLedgerRow => row !== undefined);
}

function rowCompletenessScore(row: TokenUsageLedgerRow): number {
  return [
    row.phase,
    row.role,
    row.model,
    row.modelSource,
    row.status,
    row.totalTokens,
    row.inputTokens,
    row.outputTokens,
    row.elapsedSeconds,
    row.capturedAt,
    row.runDir,
  ].filter((value) => value !== undefined && value !== "").length;
}

function rowMergeKey(row: TokenUsageLedgerRow): string {
  if (row.id) {
    return `id:${row.id}`;
  }

  return [
    row.phase,
    row.role ?? "",
    row.model ?? "",
    row.modelSource ?? "",
    row.capturedAt,
    row.runDir ?? "",
    row.sessionId ?? "",
  ].join("\u0000");
}

function sortRows(left: TokenUsageLedgerRow, right: TokenUsageLedgerRow): number {
  const leftTime = Date.parse(left.capturedAt);
  const rightTime = Date.parse(right.capturedAt);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  if (Number.isFinite(leftTime) !== Number.isFinite(rightTime)) {
    return Number.isFinite(leftTime) ? -1 : 1;
  }

  return left.phase.localeCompare(right.phase);
}

function mergeTokenUsageRows(rows: TokenUsageLedgerRow[]): TokenUsageLedgerRow[] {
  const merged = new Map<string, TokenUsageLedgerRow>();

  for (const row of rows) {
    const key = rowMergeKey(row);
    const existing = merged.get(key);
    if (!existing || rowCompletenessScore(row) >= rowCompletenessScore(existing)) {
      merged.set(key, row);
    }
  }

  return [...merged.values()].sort(sortRows);
}

export async function fetchTokenUsageComment(
  forge: Pick<
    RepositoryForge,
    "fetchIssueComments" | "fetchPullRequestIssueComments"
  >,
  target: AuditTarget
): Promise<RepositoryComment | undefined> {
  const comments =
    target.type === "pull-request"
      ? await forge.fetchPullRequestIssueComments(target.number)
      : await forge.fetchIssueComments(target.number);

  return comments
    .filter((comment) => comment.body.includes(TOKEN_USAGE_COMMENT_MARKER))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

export async function publishTokenUsageLedger(
  forge: Pick<
    RepositoryForge,
    | "createAuditComment"
    | "fetchIssueComments"
    | "fetchPullRequestIssueComments"
    | "isAuthenticated"
    | "updateIssueComment"
  >,
  input: {
    target: AuditTarget;
    rows: TokenUsageLedgerRow[];
  }
): Promise<TokenUsagePublishResult> {
  if (!forge.isAuthenticated()) {
    throw new Error(
      "Publishing token usage comments requires GH_TOKEN or GITHUB_TOKEN in the repository environment, or an authenticated gh session."
    );
  }

  const tokenUsageTarget = auditTargetToTokenUsageTarget(input.target);
  const existing = await fetchTokenUsageComment(forge, input.target);
  const rows = mergeTokenUsageRows([
    ...(existing ? parseTokenUsageRowsFromCommentBody(existing.body) : []),
    ...input.rows,
  ]);
  const body = renderTokenUsageCommentBody({
    target: tokenUsageTarget,
    rows,
  });

  if (!existing) {
    return {
      status: "created",
      comment: await forge.createAuditComment(input.target, body),
    };
  }

  return {
    status: "updated",
    comment: await forge.updateIssueComment(existing.id, body),
  };
}
