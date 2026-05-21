import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatCommandForDisplay } from "../../config";
import type {
  PullRequestCheckSignal,
  PullRequestReviewComment,
  RepositoryComment,
} from "../../forge";
import { formatRunTimestamp, toRepoRelativePath } from "../../run-artifacts";
import type { PullRequestPrepareReviewBaseSyncState } from "../pr-prepare-review/types";
import type {
  PullRequestLocalReviewCaptured,
  PullRequestLocalReviewContextInput,
  PullRequestLocalReviewWorkspace,
} from "./types";

export function createPullRequestLocalReviewWorkspace(
  repoRoot: string,
  prNumber: number
): PullRequestLocalReviewWorkspace {
  const runDir = resolve(
    repoRoot,
    ".prs",
    "runs",
    `${formatRunTimestamp()}-pr-${prNumber}-review`
  );
  const contextFilePath = resolve(runDir, "pr-review-context.md");
  const reportFilePath = resolve(runDir, "codex-pr-review.md");
  const commentsFilePath = resolve(runDir, "codex-pr-review-comments.json");

  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    snapshotFilePath: contextFilePath,
    promptFilePath: resolve(runDir, "prompt.md"),
    conflictPromptFilePath: resolve(runDir, "base-sync-conflict-prompt.md"),
    interactivePromptFilePath: resolve(runDir, "interactive-prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    reviewBriefFilePath: reportFilePath,
    assistantLastMessageFilePath: resolve(runDir, "assistant-last-message.txt"),
    contextFilePath,
    reportFilePath,
    commentsFilePath,
  };
}

function renderCapturedList<T>(
  title: string,
  captured: PullRequestLocalReviewCaptured<T>,
  renderItem: (item: T) => string
): string[] {
  if (captured.status === "unavailable") {
    return [`## ${title}`, "", `Unavailable: ${captured.warning}`];
  }

  if (captured.items.length === 0) {
    return [`## ${title}`, "", "None found."];
  }

  return [`## ${title}`, "", ...captured.items.map(renderItem)];
}

function renderCheck(check: PullRequestCheckSignal): string {
  return [
    `- ${check.name}`,
    `  - Status: ${check.status}`,
    `  - Conclusion: ${check.conclusion ?? "none"}`,
    check.url ? `  - URL: ${check.url}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function renderIssueComment(comment: RepositoryComment): string {
  return [
    `- ${comment.author} at ${comment.updatedAt}`,
    `  - URL: ${comment.url}`,
    `  - Body: ${comment.body.replace(/\s+/g, " ").trim()}`,
  ].join("\n");
}

function renderReviewComment(comment: PullRequestReviewComment): string {
  const line =
    comment.line ?? comment.originalLine ?? comment.startLine ?? comment.originalStartLine;
  return [
    `- ${comment.path}${line ? `:${line}` : ""} by ${comment.author}`,
    `  - URL: ${comment.url}`,
    `  - Body: ${comment.body.replace(/\s+/g, " ").trim()}`,
  ].join("\n");
}

function formatBaseSyncStatus(baseSync: PullRequestPrepareReviewBaseSyncState): string {
  if (baseSync.status === "up-to-date") {
    return `Already contained ${baseSync.remoteRef} tip ${baseSync.baseTip}.`;
  }
  if (baseSync.status === "merged") {
    return `Merged ${baseSync.remoteRef} tip ${baseSync.baseTip}.`;
  }
  return `Blocked while syncing ${baseSync.remoteRef} tip ${baseSync.baseTip}.`;
}

export function formatPullRequestLocalReviewContext(
  input: PullRequestLocalReviewContextInput
): string {
  const lines = [
    "# Local Codex PR Review Context",
    "",
    "## Pull Request",
    "",
    `- PR number: ${input.pullRequest.number}`,
    `- Title: ${input.pullRequest.title}`,
    `- URL: ${input.pullRequest.url}`,
    `- Base branch: ${input.pullRequest.baseRefName}`,
    `- Head branch: ${input.pullRequest.headRefName}`,
    `- Configured verification command: ${input.buildCommandDisplay}`,
    "",
    "## Checkout And Base Sync",
    "",
    `- Checkout source: ${input.checkoutTarget.source}`,
    `- Checked out branch: ${input.checkoutTarget.branchName}`,
    `- Base sync: ${formatBaseSyncStatus(input.baseSync)}`,
    `- Base sync summary: ${input.baseSync.summary}`,
    `- Conflict resolution: ${input.baseSync.conflictResolution}`,
    "",
    "## Pull Request Body",
    "",
    input.pullRequest.body.trim() || "(No pull request body provided.)",
    "",
    "## Linked Issues",
    "",
  ];

  if (input.linkedIssues.length === 0) {
    lines.push("None found.");
  } else {
    for (const linkedIssue of input.linkedIssues) {
      lines.push(
        `### Issue #${linkedIssue.issue.number}: ${linkedIssue.issue.title}`,
        "",
        `- URL: ${linkedIssue.issue.url}`,
        linkedIssue.sessionState
          ? `- Saved local branch: ${linkedIssue.sessionState.branchName}`
          : "- Saved local issue state: None found",
        "",
        linkedIssue.issue.body.trim() || "(No issue body provided.)",
        ""
      );
    }
  }

  lines.push(
    "",
    ...renderCapturedList("Checks", input.checks, renderCheck),
    "",
    ...renderCapturedList("Issue Comments", input.issueComments, renderIssueComment),
    "",
    ...renderCapturedList("Review Comments", input.reviewComments, renderReviewComment),
    "",
    "## Changed Files",
    "",
    ...(input.changedFiles.length > 0
      ? input.changedFiles.map((file) => `- ${file}`)
      : ["No changed files were reported by git diff."]),
    "",
    "## Diff",
    "",
    "```diff",
    input.diff.trim() || "(No diff output was captured.)",
    "```"
  );

  if (input.warnings.length > 0) {
    lines.push("", "## Warnings", "", ...input.warnings.map((warning) => `- ${warning}`));
  }

  lines.push("");
  return lines.join("\n");
}

function buildPullRequestLocalReviewPrompt(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  input: PullRequestLocalReviewContextInput
): string {
  const contextFile = toRepoRelativePath(repoRoot, workspace.contextFilePath);
  const reportFile = toRepoRelativePath(repoRoot, workspace.reportFilePath);
  const commentsFile = toRepoRelativePath(repoRoot, workspace.commentsFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);
  const publishCommand = formatCommandForDisplay([
    "prs",
    "tool",
    "pr",
    "publish-review",
    String(input.pullRequest.number),
    "--report",
    workspace.reportFilePath,
    "--comments",
    workspace.commentsFilePath,
    "--json",
  ]);
  const legacyAuditCommand = formatCommandForDisplay([
    "prs",
    "audit",
    "publish",
    "--pr",
    String(input.pullRequest.number),
    "--file",
    workspace.reportFilePath,
    "--section",
    "Codex PR review",
  ]);

  return [
    "You are working in the current repository as a senior pull request reviewer.",
    "Prepare a consolidated local Codex PR review report for a human reviewer.",
    "",
    `Read the review context at \`${contextFile}\` before writing the report.`,
    `Write the final Markdown report to \`${reportFile}\`.`,
    `Write line-linked review comments as JSON to \`${commentsFile}\`.`,
    `Use \`${runDir}\` only for local workflow artifacts created by this review.`,
    "",
    "Rules:",
    "- do not edit tracked repository files",
    "- do not commit, push, or resolve comments",
    "- do not post directly to GitHub except through the publish command below",
    "- ground every finding in the diff, files, metadata, comments, checks, or visible repository conventions",
    "- discard weak or speculative findings",
    "- reconcile duplicate concerns into one finding",
    "- include evidence and confidence for every blocking and non-blocking concern",
    "",
    "Review lanes to consider:",
    "- correctness and behavioral regressions",
    "- test coverage and manual QA gaps",
    "- security, permissions, and secret-handling risks",
    "- performance, cost, and scalability risks",
    "- rollout, migration, documentation, and forgotten companion changes",
    "",
    "The report must contain these sections:",
    "- Executive summary",
    "- Blocking concerns",
    "- Non-blocking concerns",
    "- Test and QA gaps",
    "- Rollout and documentation concerns",
    "- Evidence appendix",
    "",
    "The comments JSON must be an array. Use this object shape for each inline comment candidate:",
    "```json",
    JSON.stringify(
      [
        {
          path: "src/example.ts",
          line: 42,
          severity: "high",
          confidence: "high",
          category: "bug",
          affectedFile: "src/example.ts",
          body: "Explain the line-linked concern in reviewer-ready language.",
          whyThisMatters: "Explain the concrete risk.",
          suggestedFix: "Optional concrete fix guidance.",
        },
      ],
      null,
      2
    ),
    "```",
    "",
    "Only include comments that can be anchored to changed right-side diff lines. Prefer an empty array over weak or non-line-linked comments.",
    `After saving the report and comments JSON, publish them with \`${publishCommand}\`.`,
    `If the publish-review command is unavailable, publish only the audit report with \`${legacyAuditCommand}\` and report that inline comments were not posted.`,
    "When the report is saved and published, stop.",
  ].join("\n");
}

function buildPullRequestLocalReviewConflictPrompt(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  input: { branchName: string; baseSync: PullRequestPrepareReviewBaseSyncState }
): string {
  const outputLogFile = toRepoRelativePath(repoRoot, workspace.outputLogPath);

  return [
    "You are working in the current repository.",
    "A merge conflict happened while preparing a local Codex PR review workspace.",
    "",
    `Resolve the conflicts from merging \`${input.baseSync.remoteRef}\` into \`${input.branchName}\`.`,
    `The tracked git command log is stored at \`${outputLogFile}\`.`,
    "",
    "Do not write the PR review report until the base-sync conflict is resolved.",
  ].join("\n");
}

export function initializePullRequestLocalReviewOutputLog(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace
): void {
  writeFileSync(
    workspace.outputLogPath,
    [
      "# prs tool pr review run log",
      "",
      `Created: ${new Date().toISOString()}`,
      `Context file: ${toRepoRelativePath(repoRoot, workspace.contextFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      `Report file: ${toRepoRelativePath(repoRoot, workspace.reportFilePath)}`,
      "",
    ].join("\n"),
    "utf8"
  );
}

export function appendPullRequestLocalReviewWarning(
  workspace: PullRequestLocalReviewWorkspace,
  warning: string
): void {
  appendFileSync(workspace.outputLogPath, `Warning: ${warning}\n`, "utf8");
}

export function writePullRequestLocalReviewWorkspaceFiles(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  input: PullRequestLocalReviewContextInput,
  buildCommand: string[]
): void {
  writeFileSync(workspace.contextFilePath, formatPullRequestLocalReviewContext(input), "utf8");
  writeFileSync(
    workspace.promptFilePath,
    `${buildPullRequestLocalReviewPrompt(repoRoot, workspace, input)}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.interactivePromptFilePath,
    `Review context: ${toRepoRelativePath(repoRoot, workspace.contextFilePath)}\nReport: ${toRepoRelativePath(
      repoRoot,
      workspace.reportFilePath
    )}\nComments: ${toRepoRelativePath(
      repoRoot,
      workspace.commentsFilePath
    )}\nVerification fallback: ${formatCommandForDisplay(buildCommand)}\n`,
    "utf8"
  );
}

export function writePullRequestLocalReviewConflictPrompt(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  input: { branchName: string; baseSync: PullRequestPrepareReviewBaseSyncState }
): void {
  writeFileSync(
    workspace.conflictPromptFilePath,
    `${buildPullRequestLocalReviewConflictPrompt(repoRoot, workspace, input)}\n`,
    "utf8"
  );
}

export function writePullRequestLocalReviewMetadata(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  input: PullRequestLocalReviewContextInput
): void {
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        flow: input.flow,
        prNumber: input.pullRequest.number,
        prTitle: input.pullRequest.title,
        prUrl: input.pullRequest.url,
        baseRefName: input.pullRequest.baseRefName,
        headRefName: input.pullRequest.headRefName,
        contextFile: toRepoRelativePath(repoRoot, workspace.contextFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        conflictPromptFile: toRepoRelativePath(repoRoot, workspace.conflictPromptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        reportFile: toRepoRelativePath(repoRoot, workspace.reportFilePath),
        commentsFile: toRepoRelativePath(repoRoot, workspace.commentsFilePath),
        checkout: input.checkoutTarget,
        baseSync: input.baseSync,
        changedFiles: input.changedFiles,
        warnings: input.warnings,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
