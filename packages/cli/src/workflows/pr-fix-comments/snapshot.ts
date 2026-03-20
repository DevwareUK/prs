import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  PullRequestDetails,
  RepositoryForge,
} from "../../forge";
import {
  formatReviewCommentLineRange,
} from "./selection";
import type {
  PullRequestLinkedIssueContext,
  PullRequestReviewTask,
} from "./types";

function formatLocalFileExcerpt(
  repoRoot: string,
  filePath: string,
  startLine?: number,
  endLine?: number
): string | undefined {
  const excerptStartLine = startLine ?? endLine;
  const excerptEndLine = endLine ?? startLine;
  if (excerptStartLine === undefined || excerptEndLine === undefined) {
    return undefined;
  }

  try {
    const fileContents = readFileSync(resolve(repoRoot, filePath), "utf8");
    if (fileContents.includes("\u0000")) {
      return undefined;
    }

    const lines = fileContents.split(/\r?\n/);
    const firstLine = Math.max(1, excerptStartLine - 4);
    const lastLine = Math.min(lines.length, excerptEndLine + 4);
    const lineNumberWidth = String(lastLine).length;

    return lines
      .slice(firstLine - 1, lastLine)
      .map(
        (line, index) =>
          `${String(firstLine + index).padStart(lineNumberWidth, " ")} | ${line}`
      )
      .join("\n");
  } catch {
    return undefined;
  }
}

export async function fetchLinkedIssuesForPullRequest(
  forge: RepositoryForge,
  pullRequest: PullRequestDetails
): Promise<PullRequestLinkedIssueContext[]> {
  const linkedIssueNumbers = new Set<number>();
  for (const match of pullRequest.body.matchAll(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi
  )) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      linkedIssueNumbers.add(parsed);
    }
  }

  const linkedIssues: PullRequestLinkedIssueContext[] = [];
  for (const issueNumber of [...linkedIssueNumbers].sort((left, right) => left - right)) {
    try {
      const issue = await forge.fetchIssueDetails(issueNumber);
      linkedIssues.push({
        number: issueNumber,
        ...issue,
      });
    } catch {
      continue;
    }
  }

  return linkedIssues;
}

export function formatPullRequestReviewCommentsSnapshot(
  repoRoot: string,
  pullRequest: PullRequestDetails,
  tasks: PullRequestReviewTask[],
  linkedIssues: PullRequestLinkedIssueContext[]
): string {
  const pullRequestBody = pullRequest.body.trim() || "(No pull request body provided.)";
  const lines = [
    "# Pull Request Review Fix Snapshot",
    "",
    "## Pull Request",
    "",
    `- PR number: ${pullRequest.number}`,
    `- Title: ${pullRequest.title}`,
    `- URL: ${pullRequest.url}`,
    `- Base branch: ${pullRequest.baseRefName}`,
    `- Head branch: ${pullRequest.headRefName}`,
    "",
    "## Body",
    "",
    pullRequestBody,
  ];

  if (linkedIssues.length > 0) {
    lines.push("", "## Linked issues");

    for (const issue of linkedIssues) {
      lines.push(
        "",
        `### Issue #${issue.number}: ${issue.title}`,
        "",
        `- URL: ${issue.url}`,
        "",
        issue.body.trim() || "(No issue body provided.)"
      );
    }
  }

  lines.push("", "## Selected review tasks");

  for (const [index, task] of tasks.entries()) {
    lines.push(
      "",
      `### Task ${index + 1}`,
      "",
      `- Selection type: ${
        task.kind === "group" ? "Grouped review task" : "Review thread"
      }`,
      `- File: ${task.path}`,
      `- Lines: ${formatReviewCommentLineRange(task.startLine, task.endLine)}`,
      `- Threads: ${task.threads.length}`,
      `- Comments: ${task.comments.length}`,
      `- Summary: ${task.summary}`,
      "",
      "#### Success looks like",
      "",
      "- Address each actionable review point captured in this task.",
      "- Preserve any clarifications from follow-up review replies.",
      "- Leave the affected code in a state that passes the configured verification command."
    );

    for (const [threadIndex, thread] of task.threads.entries()) {
      lines.push(
        "",
        `#### Thread ${threadIndex + 1}`,
        "",
        `- Root comment ID: ${thread.rootComment.id}`,
        `- Reviewer: ${thread.rootComment.author}`,
        `- URL: ${thread.rootComment.url}`,
        `- Lines: ${formatReviewCommentLineRange(thread.startLine, thread.endLine)}`,
        `- Summary: ${thread.summary}`,
        "",
        "##### Thread conversation"
      );

      for (const comment of thread.comments) {
        lines.push(
          "",
          `${comment.author} (${comment.updatedAt})`,
          "",
          comment.body.trim()
        );
      }

      const diffHunks = [
        ...new Set(
          thread.comments
            .map((comment) => comment.diffHunk?.trim())
            .filter((diffHunk): diffHunk is string => Boolean(diffHunk))
        ),
      ];
      if (diffHunks.length > 0) {
        lines.push("", "##### Diff hunk", "", "```diff", diffHunks[0], "```");
      }

      const localExcerpt = formatLocalFileExcerpt(
        repoRoot,
        thread.path,
        thread.startLine,
        thread.endLine
      );
      if (localExcerpt) {
        lines.push("", "##### Local file excerpt", "", "```text", localExcerpt, "```");
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}
