import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatCommandForDisplay } from "../../config";
import { formatRunTimestamp, toRepoRelativePath } from "../../run-artifacts";
import { formatPullRequestPrepareReviewSnapshot } from "./snapshot";
import type {
  PullRequestPrepareReviewBaseSyncState,
  PullRequestPrepareReviewRuntimePlan,
  PullRequestPrepareReviewSnapshotInput,
  PullRequestPrepareReviewWorkspace,
} from "./types";

export function createPullRequestPrepareReviewWorkspace(
  repoRoot: string,
  prNumber: number
): PullRequestPrepareReviewWorkspace {
  const runDir = resolve(
    repoRoot,
    ".git-ai",
    "runs",
    `${formatRunTimestamp()}-pr-${prNumber}-prepare-review`
  );

  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    snapshotFilePath: resolve(runDir, "pr-review-prepare.md"),
    promptFilePath: resolve(runDir, "prompt.md"),
    conflictPromptFilePath: resolve(runDir, "base-sync-conflict-prompt.md"),
    interactivePromptFilePath: resolve(runDir, "interactive-prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    reviewBriefFilePath: resolve(runDir, "review-brief.md"),
    assistantLastMessageFilePath: resolve(runDir, "assistant-last-message.txt"),
  };
}

function buildPullRequestPrepareReviewPrompt(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  buildCommand: string[]
): string {
  const snapshotFile = toRepoRelativePath(repoRoot, workspace.snapshotFilePath);
  const reviewBriefFile = toRepoRelativePath(repoRoot, workspace.reviewBriefFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);

  return [
    "You are working in the current repository.",
    "You are preparing a local pull request review brief for a human reviewer.",
    "",
    `Read the pull request review preparation snapshot at \`${snapshotFile}\` before writing anything.`,
    `Write the final Markdown review brief to \`${reviewBriefFile}\`.`,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to the coding agent:",
    "- inspect the repository only as needed to prepare the review brief",
    "- do not modify tracked repository files; only write the requested review brief and local workflow artifacts under `.git-ai/`",
    "- base the brief on the checked-out repository state, the PR context in the snapshot, and the current diff against the PR base branch",
    "- use the pull request body, linked issues, and managed PR assistant content only as supporting context when they are relevant",
    "- include the checked-out branch and the checkout source that was already chosen for this review workspace",
    "- include the final base-branch sync state so the reviewer can tell whether the branch already contained the latest base tip or was updated before the brief was generated",
    "- include whether the review brief generation reused an existing Codex session or started a fresh run",
    "- include concrete local commands the reviewer should run to install, build, start, or otherwise inspect the change locally",
    `- always include at least one concrete command; if no better reviewer-specific command is obvious, include \`${formatCommandForDisplay(
      buildCommand
    )}\` as the fallback verification command`,
    "- do not actually start long-running services or install dependencies; only recommend commands for the reviewer to run",
    "- call out the most important reviewer focus areas grounded in the diff and supporting context",
    "- if you cannot confidently determine how to view the change locally, include a short fallback note explaining that uncertainty",
    "- keep the brief concise and practical for a human reviewer",
    "",
    "The review brief should contain short sections covering:",
    "- PR details",
    "- Local checkout state",
    "- Reviewer commands",
    "- Reviewer focus areas",
    "- Any fallback notes or caveats",
    "",
    "When the brief is complete and saved, stop.",
  ].join("\n");
}

function buildPullRequestPrepareReviewInteractivePrompt(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace
): string {
  const snapshotFile = toRepoRelativePath(repoRoot, workspace.snapshotFilePath);
  const reviewBriefFile = toRepoRelativePath(repoRoot, workspace.reviewBriefFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);

  return [
    "You are working in the current repository.",
    "A pull request review brief has already been generated for this repository state.",
    "",
    `Read the pull request review preparation snapshot at \`${snapshotFile}\` for context if needed.`,
    `Read the generated review brief at \`${reviewBriefFile}\` before answering questions.`,
    `Use \`${runDir}\` for any additional local workflow artifacts created during this follow-up session.`,
    "",
    "Instructions to the coding agent:",
    "- stay in this interactive session so the user can ask follow-up review questions or request fixes",
    "- do not make code changes unless the user explicitly asks for them",
    "- when asked review questions, ground your answers in the checked-out branch state, the review brief, the recorded base-branch sync state in the snapshot, and the current diff against the PR base branch",
    "- if the user asks for fixes, keep changes focused on the requested review feedback and verify them appropriately before finishing",
    "- do not rewrite the review brief unless the user explicitly asks you to update it",
    "",
    "Remain available for follow-up questions and requested fixes until the user exits the session.",
  ].join("\n");
}

function buildPullRequestPrepareReviewConflictPrompt(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  input: {
    branchName: string;
    baseSync: PullRequestPrepareReviewBaseSyncState;
  }
): string {
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);
  const outputLogFile = toRepoRelativePath(repoRoot, workspace.outputLogPath);

  return [
    "You are working in the current repository.",
    "A merge conflict happened while preparing a local pull request review workspace.",
    "",
    `Resolve the merge conflicts created while merging \`${input.baseSync.remoteRef}\` into the checked-out branch \`${input.branchName}\`.`,
    `Use \`${runDir}\` for any local workflow artifacts created during this conflict-resolution session.`,
    `The tracked git command log is stored at \`${outputLogFile}\`.`,
    "",
    "Instructions to the coding agent:",
    "- focus on resolving the current merge conflicts cleanly in the checked-out repository state",
    "- do not generate or update the review brief during this session",
    "- inspect the current conflicted files and the merge context before editing",
    "- complete the merge so the repository no longer has unresolved conflicts or an in-progress conflicted merge",
    `- make sure the resulting branch includes the fetched base branch tip ${input.baseSync.baseTip}`,
    "- if you cannot resolve the conflicts cleanly, stop without pretending the reviewer workspace is ready",
    "",
    "When the merge conflict resolution work is complete, stop.",
  ].join("\n");
}

export function initializePullRequestPrepareReviewOutputLog(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace
): void {
  writeFileSync(
    workspace.outputLogPath,
    [
      "# git-ai pr prepare-review run log",
      "",
      `Created: ${new Date().toISOString()}`,
      `Snapshot file: ${toRepoRelativePath(repoRoot, workspace.snapshotFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      `Conflict prompt file: ${toRepoRelativePath(repoRoot, workspace.conflictPromptFilePath)}`,
      `Interactive prompt file: ${toRepoRelativePath(
        repoRoot,
        workspace.interactivePromptFilePath
      )}`,
      `Review brief: ${toRepoRelativePath(repoRoot, workspace.reviewBriefFilePath)}`,
      "",
    ].join("\n"),
    "utf8"
  );
}

export function appendPullRequestPrepareReviewWarning(
  workspace: PullRequestPrepareReviewWorkspace,
  warning: string
): void {
  appendFileSync(workspace.outputLogPath, `Warning: ${warning}\n`, "utf8");
}

export function writePullRequestPrepareReviewWorkspaceFiles(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  snapshotInput: PullRequestPrepareReviewSnapshotInput,
  buildCommand: string[]
): void {
  writeFileSync(
    workspace.snapshotFilePath,
    formatPullRequestPrepareReviewSnapshot(snapshotInput),
    "utf8"
  );
  writeFileSync(
    workspace.promptFilePath,
    `${buildPullRequestPrepareReviewPrompt(repoRoot, workspace, buildCommand)}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.interactivePromptFilePath,
    `${buildPullRequestPrepareReviewInteractivePrompt(repoRoot, workspace)}\n`,
    "utf8"
  );
}

export function writePullRequestPrepareReviewConflictPrompt(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  input: {
    branchName: string;
    baseSync: PullRequestPrepareReviewBaseSyncState;
  }
): void {
  writeFileSync(
    workspace.conflictPromptFilePath,
    `${buildPullRequestPrepareReviewConflictPrompt(repoRoot, workspace, input)}\n`,
    "utf8"
  );
}

export function writePullRequestPrepareReviewMetadata(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  snapshotInput: PullRequestPrepareReviewSnapshotInput,
  runtimePlan: PullRequestPrepareReviewRuntimePlan
): void {
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        flow: "pr-prepare-review",
        prNumber: snapshotInput.pullRequest.number,
        prTitle: snapshotInput.pullRequest.title,
        prUrl: snapshotInput.pullRequest.url,
        baseRefName: snapshotInput.pullRequest.baseRefName,
        headRefName: snapshotInput.pullRequest.headRefName,
        snapshotFile: toRepoRelativePath(repoRoot, workspace.snapshotFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        conflictPromptFile: toRepoRelativePath(
          repoRoot,
          workspace.conflictPromptFilePath
        ),
        interactivePromptFile: toRepoRelativePath(
          repoRoot,
          workspace.interactivePromptFilePath
        ),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        reviewBriefFile: toRepoRelativePath(repoRoot, workspace.reviewBriefFilePath),
        checkout: {
          source: snapshotInput.checkoutTarget.source,
          branchName: snapshotInput.checkoutTarget.branchName,
          linkedIssueNumber:
            snapshotInput.checkoutTarget.source === "issue-branch"
              ? snapshotInput.checkoutTarget.linkedIssueNumber
              : undefined,
          headRefName:
            snapshotInput.checkoutTarget.source === "fetched-review"
              ? snapshotInput.checkoutTarget.headRefName
              : undefined,
        },
        baseSync: {
          baseRefName: snapshotInput.baseSync.baseRefName,
          remoteRef: snapshotInput.baseSync.remoteRef,
          baseTip: snapshotInput.baseSync.baseTip,
          status: snapshotInput.baseSync.status,
          conflictResolution: snapshotInput.baseSync.conflictResolution,
          summary: snapshotInput.baseSync.summary,
          warnings: snapshotInput.baseSync.warnings,
          recoveryMessage: snapshotInput.baseSync.recoveryMessage,
        },
        runtime: {
          type: "codex",
          invocation: runtimePlan.invocation,
          sessionId: runtimePlan.sessionId,
          linkedIssueNumber: runtimePlan.linkedIssueNumber,
          warnings: runtimePlan.warnings,
        },
        linkedIssues: snapshotInput.linkedIssues.map((linkedIssue) => ({
          number: linkedIssue.issue.number,
          title: linkedIssue.issue.title,
          url: linkedIssue.issue.url,
          savedBranch: linkedIssue.sessionState?.branchName,
          savedRuntimeType: linkedIssue.sessionState?.runtimeType,
          savedSessionId: linkedIssue.sessionState?.sessionId,
        })),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}
