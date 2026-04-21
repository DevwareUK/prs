import type {
  PRReviewCommentType,
  PRReviewFindingType,
  PRReviewOutputType,
} from "@git-ai/contracts";

type ReviewIssueContext = {
  number?: number;
  title?: string;
  url?: string;
};

type GitHubInlineReviewComment = {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
};

function isPRReviewCommentLike(value: unknown): value is PRReviewCommentType {
  if (!value || typeof value !== "object") {
    return false;
  }

  const comment = value as Record<string, unknown>;
  return (
    typeof comment.path === "string" &&
    comment.path.length > 0 &&
    typeof comment.line === "number" &&
    Number.isInteger(comment.line) &&
    comment.line > 0 &&
    (comment.severity === "high" || comment.severity === "medium" || comment.severity === "low") &&
    (comment.confidence === "high" ||
      comment.confidence === "medium" ||
      comment.confidence === "low") &&
    typeof comment.category === "string" &&
    comment.category.length > 0 &&
    typeof comment.affectedFile === "string" &&
    comment.affectedFile.length > 0 &&
    typeof comment.body === "string" &&
    comment.body.length > 0 &&
    typeof comment.whyThisMatters === "string" &&
    comment.whyThisMatters.length > 0 &&
    (comment.suggestedFix === undefined || typeof comment.suggestedFix === "string")
  );
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatSignalHeading(
  severity: string,
  confidence: string,
  category: string
): string {
  return `${toTitleCase(severity)} severity, ${toTitleCase(confidence)} confidence ${toTitleCase(category)}`;
}

function appendCommonSignalLines(
  lines: string[],
  signal: PRReviewCommentType | PRReviewFindingType
): void {
  lines.push(`  Severity: ${toTitleCase(signal.severity)}`);
  lines.push(`  Confidence: ${toTitleCase(signal.confidence)}`);
  lines.push(`  Affected file: \`${signal.affectedFile}\``);
  lines.push(`  Concern: ${signal.body}`);
  lines.push(`  Why this matters: ${signal.whyThisMatters}`);
  if (signal.suggestedFix) {
    lines.push(`  Suggested fix: ${signal.suggestedFix}`);
  }
}

function collectChangedLines(diff: string): Map<string, Set<number>> {
  const changedLinesByPath = new Map<string, Set<number>>();
  let currentPath: string | undefined;
  let newLine = 0;

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("+++ b/")) {
      currentPath = rawLine.slice(6);
      if (!changedLinesByPath.has(currentPath)) {
        changedLinesByPath.set(currentPath, new Set());
      }
      continue;
    }

    const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = Number.parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!currentPath) {
      continue;
    }

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      changedLinesByPath.get(currentPath)?.add(newLine);
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      continue;
    }

    if (rawLine.startsWith(" ")) {
      newLine += 1;
    }
  }

  return changedLinesByPath;
}

export function formatPRReviewMarkdown(
  review: PRReviewOutputType,
  issue?: ReviewIssueContext
): string {
  const lines: string[] = [
    "# AI PR Pre-Review Signal",
    "",
    "_This is pre-review signal for a human reviewer, not a replacement for engineer review._",
    "",
    "## Summary",
    review.summary,
  ];

  if (issue?.title && issue.url) {
    lines.push(
      "",
      "## Linked issue",
      `- ${issue.number !== undefined ? `#${issue.number}: ` : ""}[${issue.title}](${issue.url})`
    );
  }

  if (review.findings.length > 0) {
    lines.push("", "## Higher-level signals");

    for (const finding of review.findings) {
      lines.push(
        `- ${finding.title} (${formatSignalHeading(
          finding.severity,
          finding.confidence,
          finding.category
        )})`
      );
      appendCommonSignalLines(lines, finding);
    }
  }

  lines.push("", "## Line-level signals");

  if (review.comments.length === 0) {
    lines.push("No actionable line-level pre-review signals identified.");
  } else {
    for (const comment of review.comments) {
      lines.push(
        `- \`${comment.path}:${comment.line}\` (${formatSignalHeading(
          comment.severity,
          comment.confidence,
          comment.category
        )})`
      );
      appendCommonSignalLines(lines, comment);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function formatPRReviewInlineCommentBody(
  comment: PRReviewCommentType
): string {
  const lines = [
    `**${toTitleCase(comment.severity)} severity, ${toTitleCase(comment.confidence)} confidence ${toTitleCase(comment.category)}**`,
    "",
    comment.body,
    "",
    `Why this matters: ${comment.whyThisMatters}`,
  ];

  if (comment.suggestedFix) {
    lines.push("", `Suggested fix: ${comment.suggestedFix}`);
  }

  return lines.join("\n");
}

export function buildGitHubPRReviewComments(
  comments: unknown[],
  diff: string
): GitHubInlineReviewComment[] {
  const changedLinesByPath = collectChangedLines(diff);
  const dedupe = new Set<string>();
  const result: GitHubInlineReviewComment[] = [];

  for (const rawComment of comments) {
    if (!isPRReviewCommentLike(rawComment)) {
      continue;
    }

    const comment = rawComment;
    if (comment.confidence !== "high") {
      continue;
    }

    const changedLines = changedLinesByPath.get(comment.path);
    if (!changedLines?.has(comment.line)) {
      continue;
    }

    const body = formatPRReviewInlineCommentBody(comment);
    const key = `${comment.path}:${comment.line}:${body}`;
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    result.push({
      path: comment.path,
      line: comment.line,
      side: "RIGHT",
      body,
    });
  }

  return result;
}
