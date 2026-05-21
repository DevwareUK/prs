import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { formatCommandForDisplay } from "../../config";
import type { PullRequestDetails, RepositoryForge } from "../../forge";
import {
  resolveExistingIssueSessionStateFilePath,
  toRepoRelativePath,
} from "../../run-artifacts";
import {
  ensureVerificationCommandAvailable,
  preflightRemoteBranch,
} from "../../workflow-preflights";
import {
  branchContainsCommit,
  buildIncompleteBaseSyncRecoveryMessage,
  getBaseSyncTip,
  isMergeInProgress,
  listUnmergedPaths,
  resolveBaseSyncRemoteRef,
  runBaseSyncTrackedCommandAndCapture,
} from "../pr-base-sync";
import { fetchLinkedIssuesForPullRequest } from "../pr-prepare-review/snapshot";
import type {
  PullRequestPrepareReviewBaseSyncState,
  PullRequestPrepareReviewCheckoutTarget,
  PullRequestPrepareReviewIssueSessionState,
  PullRequestPrepareReviewLinkedIssueState,
} from "../pr-prepare-review/types";
import {
  appendPullRequestLocalReviewWarning,
  createPullRequestLocalReviewWorkspace,
  initializePullRequestLocalReviewOutputLog,
  writePullRequestLocalReviewConflictPrompt,
  writePullRequestLocalReviewMetadata,
  writePullRequestLocalReviewWorkspaceFiles,
} from "./workspace";
import type {
  PullRequestLocalReviewCaptured,
  PullRequestLocalReviewContextInput,
  PullRequestLocalReviewToolResult,
  PullRequestLocalReviewWorkspace,
} from "./types";

type RunPrLocalReviewToolOptions = {
  prNumber: number;
  repoRoot: string;
  buildCommand: string[];
  ensureVerificationCommandAvailable?(
    repoRoot: string,
    buildCommand: string[],
    workflowLabel: string
  ): void;
  preflightBaseBranch?(
    repoRoot: string,
    remoteName: string,
    branchName: string,
    branchLabel: string,
    recoveryHint: string
  ): { remoteRef: string; remoteTip: string };
  forge: RepositoryForge;
  ensureCleanWorkingTree(repoRoot: string): void;
};

class PullRequestLocalReviewBaseSyncError extends Error {
  readonly baseSync: PullRequestPrepareReviewBaseSyncState;

  constructor(message: string, baseSync: PullRequestPrepareReviewBaseSyncState) {
    super(message);
    this.name = "PullRequestLocalReviewBaseSyncError";
    this.baseSync = baseSync;
  }
}

function runTrackedCommand(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  command: string,
  args: string[],
  errorMessage: string
): string {
  const result = runBaseSyncTrackedCommandAndCapture(repoRoot, workspace, command, args);
  if (result.error) {
    throw new Error(`${errorMessage} ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
  return result.stdout;
}

function localBranchExists(repoRoot: string, branchName: string): boolean {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "rev-parse", "--verify", `refs/heads/${branchName}`],
    { stdio: "ignore" }
  );

  return !result.error && result.status === 0;
}

function slugifyPullRequestTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
}

function resolveFetchedReviewBranchName(
  repoRoot: string,
  prNumber: number,
  title: string
): string {
  const baseName = `review/pr-${prNumber}-${slugifyPullRequestTitle(title) || `pr-${prNumber}`}`;
  let candidate = baseName;
  let suffix = 2;

  while (localBranchExists(repoRoot, candidate)) {
    candidate = `${baseName}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function resolvePullRequestCheckoutTarget(
  repoRoot: string,
  prNumber: number,
  pullRequestTitle: string,
  pullRequestHeadRefName: string,
  linkedIssues: PullRequestPrepareReviewLinkedIssueState[]
): PullRequestPrepareReviewCheckoutTarget {
  const reusableIssueBranches = linkedIssues.filter(
    (linkedIssue) =>
      linkedIssue.sessionState !== undefined &&
      localBranchExists(repoRoot, linkedIssue.sessionState.branchName)
  );

  if (reusableIssueBranches.length === 1) {
    return {
      source: "issue-branch",
      branchName: reusableIssueBranches[0].sessionState?.branchName as string,
      linkedIssueNumber: reusableIssueBranches[0].issue.number,
    };
  }

  if (localBranchExists(repoRoot, pullRequestHeadRefName)) {
    return {
      source: "local-head",
      branchName: pullRequestHeadRefName,
    };
  }

  return {
    source: "fetched-review",
    branchName: resolveFetchedReviewBranchName(repoRoot, prNumber, pullRequestTitle),
    headRefName: pullRequestHeadRefName,
  };
}

function loadIssueSessionState(
  repoRoot: string,
  issueNumber: number
): PullRequestPrepareReviewIssueSessionState | undefined {
  const stateFilePath = resolveExistingIssueSessionStateFilePath(repoRoot, issueNumber);
  if (!existsSync(stateFilePath)) {
    return undefined;
  }

  const parsed = JSON.parse(
    readFileSync(stateFilePath, "utf8")
  ) as Partial<PullRequestPrepareReviewIssueSessionState>;
  const runtimeType =
    parsed.runtimeType === undefined &&
    (typeof parsed.sessionId === "string" || parsed.executionMode === "unattended")
      ? "codex"
      : parsed.runtimeType;

  if (
    parsed.issueNumber !== issueNumber ||
    (runtimeType !== "codex" && runtimeType !== "claude-code") ||
    typeof parsed.branchName !== "string" ||
    typeof parsed.issueDir !== "string" ||
    typeof parsed.runDir !== "string" ||
    typeof parsed.promptFile !== "string" ||
    typeof parsed.outputLog !== "string" ||
    (parsed.sessionId !== undefined && typeof parsed.sessionId !== "string") ||
    (parsed.sandboxMode !== undefined && typeof parsed.sandboxMode !== "string") ||
    (parsed.approvalPolicy !== undefined && typeof parsed.approvalPolicy !== "string") ||
    (parsed.executionMode !== undefined &&
      parsed.executionMode !== "interactive" &&
      parsed.executionMode !== "unattended") ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string"
  ) {
    throw new Error(
      `Issue session state at ${toRepoRelativePath(
        repoRoot,
        stateFilePath
      )} is malformed. Remove it and rerun the linked issue workflow to recreate the local issue state.`
    );
  }

  return {
    ...parsed,
    runtimeType,
  } as PullRequestPrepareReviewIssueSessionState;
}

function checkoutPullRequestReviewBranch(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  checkoutTarget: PullRequestPrepareReviewCheckoutTarget,
  prNumber: number
): void {
  if (checkoutTarget.source === "fetched-review") {
    console.log(`Fetching PR #${prNumber} into ${checkoutTarget.branchName}...`);
    runTrackedCommand(
      repoRoot,
      workspace,
      "git",
      ["fetch", "origin", `pull/${prNumber}/head:${checkoutTarget.branchName}`],
      `Failed to fetch PR #${prNumber} into local branch "${checkoutTarget.branchName}".`
    );
  }

  console.log(`Checking out ${checkoutTarget.branchName}...`);
  runTrackedCommand(
    repoRoot,
    workspace,
    "git",
    ["checkout", checkoutTarget.branchName],
    `Failed to check out branch "${checkoutTarget.branchName}".`
  );
}

function synchronizePullRequestBaseBranch(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  pullRequest: PullRequestDetails,
  branchName: string
): PullRequestPrepareReviewBaseSyncState {
  const remoteRef = resolveBaseSyncRemoteRef(pullRequest.baseRefName);

  console.log(`Fetching latest ${remoteRef}...`);
  runTrackedCommand(
    repoRoot,
    workspace,
    "git",
    ["fetch", "origin", pullRequest.baseRefName],
    `Failed to fetch the latest base branch "${pullRequest.baseRefName}" from origin.`
  );

  const baseTip = getBaseSyncTip(repoRoot, workspace, remoteRef);
  if (branchContainsCommit(repoRoot, workspace, baseTip, "HEAD")) {
    return {
      baseRefName: pullRequest.baseRefName,
      remoteRef,
      baseTip,
      status: "up-to-date",
      conflictResolution: "not-needed",
      summary: `Checked-out branch "${branchName}" already contained ${remoteRef} tip ${baseTip}.`,
      warnings: [],
    };
  }

  console.log(`Merging latest ${remoteRef} into ${branchName}...`);
  const mergeResult = runBaseSyncTrackedCommandAndCapture(repoRoot, workspace, "git", [
    "merge",
    "--no-edit",
    "--no-ff",
    remoteRef,
  ]);

  if (mergeResult.error) {
    throw new Error(
      `Failed to merge latest base branch "${remoteRef}" into "${branchName}". ${mergeResult.error.message}`
    );
  }

  if (mergeResult.status === 0) {
    return {
      baseRefName: pullRequest.baseRefName,
      remoteRef,
      baseTip,
      status: "merged",
      conflictResolution: "not-needed",
      summary: `Merged ${remoteRef} tip ${baseTip} into "${branchName}" before local Codex PR review.`,
      warnings: [],
    };
  }

  const conflictWarning = `Merging ${remoteRef} into "${branchName}" produced conflicts. Resolve them in the current Codex session before continuing local review.`;
  appendPullRequestLocalReviewWarning(workspace, conflictWarning);
  const baseSync: PullRequestPrepareReviewBaseSyncState = {
    baseRefName: pullRequest.baseRefName,
    remoteRef,
    baseTip,
    status: "blocked",
    conflictResolution: "required",
    summary: `Syncing "${branchName}" with ${remoteRef} tip ${baseTip} requires merge conflict resolution before local review can continue.`,
    warnings: [conflictWarning],
    recoveryMessage: buildIncompleteBaseSyncRecoveryMessage({
      branchName,
      pullRequest,
      remoteRef,
      baseTip,
      mergeStillInProgress: isMergeInProgress(repoRoot, workspace),
      remainingUnmergedPaths: listUnmergedPaths(repoRoot, workspace),
      nowContainsBaseTip: false,
      rerunCommand: `prs tool pr review ${pullRequest.number} --json`,
    }),
  };

  writePullRequestLocalReviewConflictPrompt(repoRoot, workspace, {
    branchName,
    baseSync,
  });
  throw new PullRequestLocalReviewBaseSyncError(conflictWarning, baseSync);
}

async function captureForgeList<T>(
  label: string,
  warnings: string[],
  fetcher: () => Promise<T[]>
): Promise<PullRequestLocalReviewCaptured<T>> {
  try {
    return { status: "available", items: await fetcher() };
  } catch (error) {
    const warning = `${label} unavailable: ${
      error instanceof Error ? error.message : String(error)
    }`;
    warnings.push(warning);
    return { status: "unavailable", warning };
  }
}

function captureGitOutput(
  repoRoot: string,
  workspace: PullRequestLocalReviewWorkspace,
  args: string[],
  warnings: string[]
): string {
  const result = runBaseSyncTrackedCommandAndCapture(repoRoot, workspace, "git", args);
  if (result.error || result.status !== 0) {
    warnings.push(`git ${args.join(" ")} failed while capturing review context.`);
    return "";
  }

  return result.stdout;
}

export async function preparePullRequestLocalReviewTool(
  options: RunPrLocalReviewToolOptions
): Promise<PullRequestLocalReviewToolResult> {
  if (options.forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  options.ensureCleanWorkingTree(options.repoRoot);
  (options.ensureVerificationCommandAvailable ?? ensureVerificationCommandAvailable)(
    options.repoRoot,
    options.buildCommand,
    "prs tool pr review"
  );

  console.log(`Fetching pull request #${options.prNumber}...`);
  const pullRequest = await options.forge.fetchPullRequestDetails(options.prNumber);
  (options.preflightBaseBranch ?? preflightRemoteBranch)(
    options.repoRoot,
    "origin",
    pullRequest.baseRefName,
    `PR base branch "${pullRequest.baseRefName}"`,
    "confirm the pull request base branch still exists on origin"
  );
  const linkedIssues = (
    await fetchLinkedIssuesForPullRequest(options.forge, pullRequest)
  ).map((issue) => ({
    issue,
    sessionState: loadIssueSessionState(options.repoRoot, issue.number),
  }));
  const checkoutTarget = resolvePullRequestCheckoutTarget(
    options.repoRoot,
    pullRequest.number,
    pullRequest.title,
    pullRequest.headRefName,
    linkedIssues
  );
  const workspace = createPullRequestLocalReviewWorkspace(
    options.repoRoot,
    pullRequest.number
  );
  initializePullRequestLocalReviewOutputLog(options.repoRoot, workspace);
  checkoutPullRequestReviewBranch(
    options.repoRoot,
    workspace,
    checkoutTarget,
    pullRequest.number
  );

  try {
    const baseSync = synchronizePullRequestBaseBranch(
      options.repoRoot,
      workspace,
      pullRequest,
      checkoutTarget.branchName
    );
    const warnings: string[] = [];
    const [checks, issueComments, reviewComments] = await Promise.all([
      captureForgeList("PR checks", warnings, () =>
        options.forge.fetchPullRequestChecks(pullRequest.number)
      ),
      captureForgeList("PR issue comments", warnings, () =>
        options.forge.fetchPullRequestIssueComments(pullRequest.number)
      ),
      captureForgeList("PR review comments", warnings, () =>
        options.forge.fetchPullRequestReviewComments(pullRequest.number)
      ),
    ]);
    const diffRef = `${baseSync.remoteRef}...HEAD`;
    const changedFiles = captureGitOutput(
      options.repoRoot,
      workspace,
      ["diff", "--name-only", diffRef],
      warnings
    )
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const diff = captureGitOutput(
      options.repoRoot,
      workspace,
      ["diff", "--unified=80", diffRef],
      warnings
    );
    const contextInput: PullRequestLocalReviewContextInput = {
      flow: "pr-review",
      pullRequest,
      linkedIssues,
      checkoutTarget,
      baseSync,
      buildCommandDisplay: formatCommandForDisplay(options.buildCommand),
      checks,
      issueComments,
      reviewComments,
      changedFiles,
      diff,
      warnings,
      reportFilePath: workspace.reportFilePath,
    };

    writePullRequestLocalReviewWorkspaceFiles(
      options.repoRoot,
      workspace,
      contextInput,
      options.buildCommand
    );
    writePullRequestLocalReviewMetadata(options.repoRoot, workspace, contextInput);

    return {
      status: "ready",
      prNumber: pullRequest.number,
      runDir: workspace.runDir,
      contextFilePath: workspace.contextFilePath,
      promptFilePath: workspace.promptFilePath,
      metadataFilePath: workspace.metadataFilePath,
      outputLogPath: workspace.outputLogPath,
      reportFilePath: workspace.reportFilePath,
      checkout: checkoutTarget,
      baseSync,
      changedFiles,
      nextAction: "write-codex-pr-review-report",
    };
  } catch (error) {
    if (!(error instanceof PullRequestLocalReviewBaseSyncError)) {
      throw error;
    }

    const contextInput: PullRequestLocalReviewContextInput = {
      flow: "pr-review",
      pullRequest,
      linkedIssues,
      checkoutTarget,
      baseSync: error.baseSync,
      buildCommandDisplay: formatCommandForDisplay(options.buildCommand),
      checks: { status: "unavailable", warning: "Skipped because base sync is blocked." },
      issueComments: {
        status: "unavailable",
        warning: "Skipped because base sync is blocked.",
      },
      reviewComments: {
        status: "unavailable",
        warning: "Skipped because base sync is blocked.",
      },
      changedFiles: [],
      diff: "",
      warnings: error.baseSync.warnings,
      reportFilePath: workspace.reportFilePath,
    };
    writePullRequestLocalReviewWorkspaceFiles(
      options.repoRoot,
      workspace,
      contextInput,
      options.buildCommand
    );
    writePullRequestLocalReviewMetadata(options.repoRoot, workspace, contextInput);

    return {
      status: "blocked",
      reason: "merge-conflicts",
      prNumber: pullRequest.number,
      runDir: workspace.runDir,
      contextFilePath: workspace.contextFilePath,
      conflictPromptFilePath: workspace.conflictPromptFilePath,
      metadataFilePath: workspace.metadataFilePath,
      outputLogPath: workspace.outputLogPath,
      reportFilePath: workspace.reportFilePath,
      checkout: checkoutTarget,
      baseSync: error.baseSync,
      nextAction: "resolve-conflicts-in-current-codex-session",
    };
  }
}
