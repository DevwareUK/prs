import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatCommandForDisplay } from "../../config";
import type { PullRequestDetails } from "../../forge";
import { formatRunTimestamp, toRepoRelativePath } from "../../run-artifacts";
import { getReviewCommentDisplayLine } from "./selection";
import { formatPullRequestReviewCommentsSnapshot } from "./snapshot";
import type {
  PullRequestFixWorkspace,
  PullRequestLinkedIssueContext,
  PullRequestReviewTask,
} from "./types";

export function createPullRequestFixWorkspace(
  repoRoot: string,
  prNumber: number
): PullRequestFixWorkspace {
  const runDir = resolve(
    repoRoot,
    ".git-ai",
    "runs",
    `${formatRunTimestamp()}-pr-${prNumber}-fix-comments`
  );

  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    snapshotFilePath: resolve(runDir, "pr-review-comments.md"),
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
  };
}

function buildPullRequestFixCodexPrompt(
  repoRoot: string,
  workspace: PullRequestFixWorkspace,
  buildCommand: string[]
): string {
  const snapshotFile = toRepoRelativePath(repoRoot, workspace.snapshotFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);

  return [
    "You are working in the current repository.",
    "",
    `Read the pull request review fix snapshot at \`${snapshotFile}\` before making changes.`,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to Codex:",
    "- analyze the repository only as needed for the selected review tasks",
    "- keep code changes focused on addressing the selected review tasks",
    "- follow existing architecture patterns",
    "- verify each selected review thread or grouped task is fully addressed before finishing",
    `- run \`${formatCommandForDisplay(buildCommand)}\` before finishing if code changes are made`,
    "- do not modify `.git-ai/` unless needed for local workflow artifacts",
    "- do not commit `.git-ai/` files",
  ].join("\n");
}

export function writePullRequestFixWorkspaceFiles(
  repoRoot: string,
  pullRequest: PullRequestDetails,
  tasks: PullRequestReviewTask[],
  workspace: PullRequestFixWorkspace,
  buildCommand: string[],
  linkedIssues: PullRequestLinkedIssueContext[]
): void {
  const createdAt = new Date().toISOString();
  const prompt = buildPullRequestFixCodexPrompt(repoRoot, workspace, buildCommand);
  const selectedComments = tasks.flatMap((task) => task.comments);

  writeFileSync(
    workspace.snapshotFilePath,
    formatPullRequestReviewCommentsSnapshot(repoRoot, pullRequest, tasks, linkedIssues),
    "utf8"
  );
  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        prNumber: pullRequest.number,
        prTitle: pullRequest.title,
        prUrl: pullRequest.url,
        baseRefName: pullRequest.baseRefName,
        headRefName: pullRequest.headRefName,
        snapshotFile: toRepoRelativePath(repoRoot, workspace.snapshotFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        linkedIssues: linkedIssues.map((issue) => ({
          number: issue.number,
          title: issue.title,
          url: issue.url,
        })),
        selectedTasks: tasks.map((task) => ({
          id: task.taskId,
          kind: task.kind,
          path: task.path,
          startLine: task.startLine,
          endLine: task.endLine,
          summary: task.summary,
          threadIds: task.threads.map((thread) => thread.threadId),
          commentIds: task.comments.map((comment) => comment.id),
        })),
        selectedComments: selectedComments.map((comment) => ({
          id: comment.id,
          path: comment.path,
          line: getReviewCommentDisplayLine(comment),
          url: comment.url,
        })),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.outputLogPath,
    [
      "# git-ai pr fix-comments run log",
      "",
      `Created: ${createdAt}`,
      `Snapshot file: ${toRepoRelativePath(repoRoot, workspace.snapshotFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      "",
    ].join("\n"),
    "utf8"
  );
}
