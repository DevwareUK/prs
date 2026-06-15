import type { AuditTarget, RepositoryComment, RepositoryForge } from "./forge";
import {
  auditTargetToTokenUsageTarget,
  formatTokenUsageLedgerAuditSection,
  type TokenUsageLedgerRow,
  type TokenUsageTarget,
} from "./token-audit";

export const TOKEN_USAGE_COMMENT_MARKER = "<!-- prs:token-usage -->";

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
  ].join("\n");
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
  const body = renderTokenUsageCommentBody({
    target: tokenUsageTarget,
    rows: input.rows,
  });
  const existing = await fetchTokenUsageComment(forge, input.target);

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
