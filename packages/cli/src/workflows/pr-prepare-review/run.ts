import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AIProvider } from "@git-ai/providers";
import { formatCommandForDisplay } from "../../config";
import type { PullRequestDetails, RepositoryForge } from "../../forge";
import {
  printGeneratedTextPreview,
  type ReviewedGeneratedText,
} from "../../generated-text-review";
import {
  finalizeRuntimeChanges,
  generateDiffBasedCommitProposal,
} from "../../runtime-change-review";
import {
  findTrackedRuntimeSessionById,
  getInteractiveRuntimeByType,
  launchUnattendedRuntime,
} from "../../runtime";
import {
  getIssueSessionStateFilePath,
  toRepoRelativePath,
} from "../../run-artifacts";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import type {
  PullRequestPrepareReviewBaseSyncState,
  PullRequestPrepareReviewCheckoutTarget,
  PullRequestPrepareReviewIssueSessionState,
  PullRequestPrepareReviewLinkedIssueState,
  PullRequestPrepareReviewRuntimePlan,
  PullRequestPrepareReviewWorkspace,
} from "./types";
import {
  appendPullRequestPrepareReviewWarning,
  createPullRequestPrepareReviewWorkspace,
  initializePullRequestPrepareReviewOutputLog,
  writePullRequestPrepareReviewConflictPrompt,
  writePullRequestPrepareReviewMetadata,
  writePullRequestPrepareReviewWorkspaceFiles,
} from "./workspace";

type RunPrPrepareReviewCommandOptions = {
  prNumber: number;
  repoRoot: string;
  buildCommand: string[];
  forge: RepositoryForge;
  ensureCleanWorkingTree(repoRoot: string): void;
  promptForLine(prompt: string): Promise<string>;
  hasChanges(repoRoot: string): boolean;
  verifyBuild(repoRoot: string, buildCommand: string[], outputLogPath: string): void;
  commitGeneratedChanges(repoRoot: string, commitMessage: ReviewedGeneratedText): void;
  readDiff(repoRoot: string): string;
  createProvider(repoRoot: string): Promise<{ provider: AIProvider }>;
};

type TrackedCommandOptions = {
  echoOutput?: boolean;
};

type TrackedCommandResult = {
  status: number | null;
  error?: Error;
  stdout: string;
  stderr: string;
};

class PullRequestPrepareReviewBaseSyncError extends Error {
  readonly baseSync: PullRequestPrepareReviewBaseSyncState;

  constructor(message: string, baseSync: PullRequestPrepareReviewBaseSyncState) {
    super(message);
    this.name = "PullRequestPrepareReviewBaseSyncError";
    this.baseSync = baseSync;
  }
}

function appendRunLog(
  outputLogPath: string,
  command: string,
  args: string[],
  stdout: string,
  stderr: string
): void {
  const renderedCommand = [command, ...args]
    .map((value) => (value.includes(" ") ? JSON.stringify(value) : value))
    .join(" ");

  appendFileSync(
    outputLogPath,
    [`$ ${renderedCommand}`, stdout, stderr, ""].join("\n"),
    "utf8"
  );
}

function runTrackedCommandAndCapture(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  command: string,
  args: string[],
  options: TrackedCommandOptions = {}
): TrackedCommandResult {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  appendRunLog(workspace.outputLogPath, command, args, stdout, stderr);

  if (options.echoOutput !== false && stdout) {
    process.stdout.write(stdout);
  }

  if (options.echoOutput !== false && stderr) {
    process.stderr.write(stderr);
  }

  return {
    status: result.status,
    error: result.error ?? undefined,
    stdout,
    stderr,
  };
}

function runTrackedCommand(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  command: string,
  args: string[],
  errorMessage: string,
  options: TrackedCommandOptions = {}
): string {
  const result = runTrackedCommandAndCapture(
    repoRoot,
    workspace,
    command,
    args,
    options
  );
  const stdout = result.stdout;

  if (result.error) {
    throw new Error(`${errorMessage} ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
  }

  return stdout;
}

function resolveBaseSyncRemoteRef(baseRefName: string): string {
  return `origin/${baseRefName}`;
}

function getBaseSyncTip(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  remoteRef: string
): string {
  const baseTip = runTrackedCommand(
    repoRoot,
    workspace,
    "git",
    ["rev-parse", remoteRef],
    `Failed to determine the fetched tip for "${remoteRef}".`,
    { echoOutput: false }
  ).trim();

  if (!baseTip) {
    throw new Error(`Failed to determine the fetched tip for "${remoteRef}".`);
  }

  return baseTip;
}

function branchContainsCommit(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  commitish: string,
  branchish: string
): boolean {
  const result = runTrackedCommandAndCapture(
    repoRoot,
    workspace,
    "git",
    ["merge-base", "--is-ancestor", commitish, branchish],
    { echoOutput: false }
  );

  if (result.error) {
    throw new Error(
      `Failed to determine whether ${branchish} already contains ${commitish}. ${result.error.message}`
    );
  }

  if (result.status === 0) {
    return true;
  }

  if (result.status === 1) {
    return false;
  }

  throw new Error(`Failed to determine whether ${branchish} already contains ${commitish}.`);
}

function isMergeInProgress(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace
): boolean {
  const result = runTrackedCommandAndCapture(
    repoRoot,
    workspace,
    "git",
    ["rev-parse", "-q", "--verify", "MERGE_HEAD"],
    { echoOutput: false }
  );

  if (result.error) {
    throw new Error(`Failed to inspect merge state. ${result.error.message}`);
  }

  if (result.status === 0) {
    return true;
  }

  if (result.status === 1) {
    return false;
  }

  throw new Error("Failed to inspect merge state.");
}

function listUnmergedPaths(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace
): string[] {
  const result = runTrackedCommandAndCapture(
    repoRoot,
    workspace,
    "git",
    ["diff", "--name-only", "--diff-filter=U"],
    { echoOutput: false }
  );

  if (result.error) {
    throw new Error(`Failed to inspect unresolved merge conflicts. ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error("Failed to inspect unresolved merge conflicts.");
  }

  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function synchronizePullRequestBaseBranch(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
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
  const mergeResult = runTrackedCommandAndCapture(
    repoRoot,
    workspace,
    "git",
    ["merge", "--no-edit", "--no-ff", remoteRef]
  );

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
      summary: `Merged ${remoteRef} tip ${baseTip} into "${branchName}" before generating the review brief.`,
      warnings: [],
    };
  }

  const mergeInProgress = isMergeInProgress(repoRoot, workspace);
  const unmergedPaths = listUnmergedPaths(repoRoot, workspace);
  if (!mergeInProgress && unmergedPaths.length === 0) {
    throw new Error(
      `Failed to merge latest base branch "${remoteRef}" into "${branchName}".`
    );
  }

  const conflictWarning =
    `Merging ${remoteRef} into "${branchName}" produced conflicts. Opening Codex to resolve them before generating the review brief.`;
  console.log(conflictWarning);
  appendPullRequestPrepareReviewWarning(workspace, conflictWarning);

  const baseSyncForConflictPrompt: PullRequestPrepareReviewBaseSyncState = {
    baseRefName: pullRequest.baseRefName,
    remoteRef,
    baseTip,
    status: "blocked",
    conflictResolution: "required",
    summary: `Syncing "${branchName}" with ${remoteRef} tip ${baseTip} requires merge conflict resolution before review brief generation can continue.`,
    warnings: [conflictWarning],
  };
  writePullRequestPrepareReviewConflictPrompt(repoRoot, workspace, {
    branchName,
    baseSync: baseSyncForConflictPrompt,
  });

  console.log(
    "Resolve the merge conflicts in the interactive Codex session, then exit Codex to continue."
  );
  getInteractiveRuntimeByType("codex").launch(repoRoot, {
    promptFilePath: workspace.conflictPromptFilePath,
    outputLogPath: workspace.outputLogPath,
  });

  const mergeStillInProgress = isMergeInProgress(repoRoot, workspace);
  const remainingUnmergedPaths = listUnmergedPaths(repoRoot, workspace);
  const nowContainsBaseTip = branchContainsCommit(repoRoot, workspace, baseTip, "HEAD");
  if (mergeStillInProgress || remainingUnmergedPaths.length > 0 || !nowContainsBaseTip) {
    const recoveryParts: string[] = [];
    if (remainingUnmergedPaths.length > 0) {
      recoveryParts.push(
        `Remaining conflicted files: ${remainingUnmergedPaths.join(", ")}.`
      );
    }
    if (mergeStillInProgress) {
      recoveryParts.push(`Finish the in-progress merge on "${branchName}".`);
    }
    if (!nowContainsBaseTip) {
      recoveryParts.push(
        `Make sure "${branchName}" contains ${remoteRef} tip ${baseTip}.`
      );
    }

    const recoveryMessage = [
      `Base-branch sync is still incomplete for "${branchName}".`,
      ...recoveryParts,
      `After fixing the branch state, rerun \`git-ai pr prepare-review ${pullRequest.number}\`.`,
    ].join(" ");

    appendPullRequestPrepareReviewWarning(workspace, recoveryMessage);
    throw new PullRequestPrepareReviewBaseSyncError(recoveryMessage, {
      baseRefName: pullRequest.baseRefName,
      remoteRef,
      baseTip,
      status: "blocked",
      conflictResolution: "unresolved",
      summary: `Base-branch sync with ${remoteRef} tip ${baseTip} is still incomplete on "${branchName}".`,
      warnings: [conflictWarning],
      recoveryMessage,
    });
  }

  const resolvedWarning =
    `Codex resolved the merge conflicts while merging ${remoteRef} into "${branchName}". Continuing review brief generation on the synced branch.`;
  console.log(resolvedWarning);
  appendPullRequestPrepareReviewWarning(workspace, resolvedWarning);

  return {
    baseRefName: pullRequest.baseRefName,
    remoteRef,
    baseTip,
    status: "merged",
    conflictResolution: "required",
    summary: `Merged ${remoteRef} tip ${baseTip} into "${branchName}" after Codex resolved the sync conflicts.`,
    warnings: [conflictWarning, resolvedWarning],
  };
}

function localBranchExists(repoRoot: string, branchName: string): boolean {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", branchName], {
    stdio: "ignore",
  });

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

function loadIssueSessionState(
  repoRoot: string,
  issueNumber: number
): PullRequestPrepareReviewIssueSessionState | undefined {
  const stateFilePath = getIssueSessionStateFilePath(repoRoot, issueNumber);
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
    (parsed.approvalPolicy !== undefined &&
      typeof parsed.approvalPolicy !== "string") ||
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

function resolvePullRequestRuntimePlan(
  repoRoot: string,
  checkoutTarget: PullRequestPrepareReviewCheckoutTarget,
  linkedIssues: PullRequestPrepareReviewLinkedIssueState[]
): PullRequestPrepareReviewRuntimePlan {
  if (checkoutTarget.source !== "issue-branch") {
    return {
      invocation: "new",
      warnings: [],
    };
  }

  const linkedIssue = linkedIssues.find(
    (candidate) => candidate.issue.number === checkoutTarget.linkedIssueNumber
  );
  const sessionState = linkedIssue?.sessionState;
  if (!sessionState || sessionState.runtimeType !== "codex" || !sessionState.sessionId) {
    return {
      invocation: "new",
      warnings: [],
    };
  }

  const trackedSession = findTrackedRuntimeSessionById(
    "codex",
    repoRoot,
    sessionState.sessionId
  );
  if (!trackedSession) {
    return {
      invocation: "new",
      linkedIssueNumber: checkoutTarget.linkedIssueNumber,
      warnings: [
        `Saved Codex session ${sessionState.sessionId} for linked issue #${checkoutTarget.linkedIssueNumber} is no longer available. Falling back to a fresh review brief generation run.`,
      ],
    };
  }

  return {
    invocation: "resume",
    sessionId: sessionState.sessionId,
    linkedIssueNumber: checkoutTarget.linkedIssueNumber,
    warnings: [],
  };
}

function checkoutPullRequestReviewBranch(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  checkoutTarget: PullRequestPrepareReviewCheckoutTarget,
  prNumber: number
): void {
  if (checkoutTarget.source === "fetched-review") {
    console.log(`Fetching PR #${prNumber} into ${checkoutTarget.branchName}...`);
    runTrackedCommand(
      repoRoot,
      workspace,
      "git",
      [
        "fetch",
        "origin",
        `pull/${prNumber}/head:${checkoutTarget.branchName}`,
      ],
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

function ensureCodexAvailable(): void {
  const runtime = getInteractiveRuntimeByType("codex");
  const availability = runtime.checkAvailability();
  if (!availability.available) {
    throw new Error(
      `\`git-ai pr prepare-review\` requires Codex because it generates the review brief in an unattended runtime. Configured Codex is unavailable because ${availability.reason}.`
    );
  }
}

export async function runPrPrepareReviewCommand(
  options: RunPrPrepareReviewCommandOptions
): Promise<void> {
  if (options.forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  ensureCodexAvailable();
  options.ensureCleanWorkingTree(options.repoRoot);

  console.log(`Fetching pull request #${options.prNumber}...`);
  const pullRequest = await options.forge.fetchPullRequestDetails(options.prNumber);
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
  const runtimePlan = resolvePullRequestRuntimePlan(
    options.repoRoot,
    checkoutTarget,
    linkedIssues
  );
  const workspace = createPullRequestPrepareReviewWorkspace(
    options.repoRoot,
    pullRequest.number
  );

  initializePullRequestPrepareReviewOutputLog(options.repoRoot, workspace);
  for (const warning of runtimePlan.warnings) {
    console.log(`Warning: ${warning}`);
    appendPullRequestPrepareReviewWarning(workspace, warning);
  }

  checkoutPullRequestReviewBranch(
    options.repoRoot,
    workspace,
    checkoutTarget,
    pullRequest.number
  );

  let baseSync: PullRequestPrepareReviewBaseSyncState;
  try {
    baseSync = synchronizePullRequestBaseBranch(
      options.repoRoot,
      workspace,
      pullRequest,
      checkoutTarget.branchName
    );
  } catch (error) {
    if (error instanceof PullRequestPrepareReviewBaseSyncError) {
      const blockedSnapshotInput = {
        pullRequest,
        linkedIssues,
        checkoutTarget,
        baseSync: error.baseSync,
        runtimePlan,
        buildCommandDisplay: formatCommandForDisplay(options.buildCommand),
      };

      writePullRequestPrepareReviewWorkspaceFiles(
        options.repoRoot,
        workspace,
        blockedSnapshotInput,
        options.buildCommand
      );
      writePullRequestPrepareReviewMetadata(
        options.repoRoot,
        workspace,
        blockedSnapshotInput,
        runtimePlan
      );
    }

    throw error;
  }

  const snapshotInput = {
    pullRequest,
    linkedIssues,
    checkoutTarget,
    baseSync,
    runtimePlan,
    buildCommandDisplay: formatCommandForDisplay(options.buildCommand),
  };

  writePullRequestPrepareReviewWorkspaceFiles(
    options.repoRoot,
    workspace,
    snapshotInput,
    options.buildCommand
  );
  writePullRequestPrepareReviewMetadata(
    options.repoRoot,
    workspace,
    snapshotInput,
    runtimePlan
  );

  console.log(
    runtimePlan.invocation === "resume"
      ? `Resuming Codex session ${runtimePlan.sessionId} to generate the review brief...`
      : "Starting a fresh unattended Codex run to generate the review brief..."
  );
  const runtimeLaunch = launchUnattendedRuntime("codex", options.repoRoot, workspace, {
    resumeSessionId: runtimePlan.sessionId,
    outputLastMessageFilePath: workspace.assistantLastMessageFilePath,
  });
  const finalizedRuntimePlan: PullRequestPrepareReviewRuntimePlan = {
    ...runtimePlan,
    invocation: runtimeLaunch.invocation,
    sessionId: runtimeLaunch.sessionId,
  };
  writePullRequestPrepareReviewMetadata(
    options.repoRoot,
    workspace,
    {
      ...snapshotInput,
      runtimePlan: finalizedRuntimePlan,
    },
    finalizedRuntimePlan
  );

  if (!existsSync(workspace.reviewBriefFilePath)) {
    throw new Error(
      `Codex did not write the review brief to ${toRepoRelativePath(
        options.repoRoot,
        workspace.reviewBriefFilePath
      )}.`
    );
  }

  const reviewBrief = readFileSync(workspace.reviewBriefFilePath, "utf8").trim();
  if (!reviewBrief) {
    throw new Error(
      `Codex wrote an empty review brief at ${toRepoRelativePath(
        options.repoRoot,
        workspace.reviewBriefFilePath
      )}.`
    );
  }

  process.stdout.write(
    `Review brief written to ${toRepoRelativePath(
      options.repoRoot,
      workspace.reviewBriefFilePath
    )}\n`
  );
  printGeneratedTextPreview("Generated review brief", reviewBrief);

  const interactiveRuntime = getInteractiveRuntimeByType("codex");
  const interactiveWorkspace = {
    promptFilePath: workspace.interactivePromptFilePath,
    outputLogPath: workspace.outputLogPath,
  };
  const interactiveResumeSessionId = runtimeLaunch.sessionId;

  if (interactiveResumeSessionId) {
    console.log(
      `Opening an interactive Codex session in this terminal by resuming ${interactiveResumeSessionId}...`
    );
    console.log(
      "You can now ask follow-up review questions or request fixes before exiting Codex."
    );
    interactiveRuntime.launch(options.repoRoot, interactiveWorkspace, {
      resumeSessionId: interactiveResumeSessionId,
    });
  } else {
    console.log(
      "Opening a fresh interactive Codex session in this terminal because the generated session id could not be recovered..."
    );
    console.log(
      "You can now ask follow-up review questions or request fixes before exiting Codex."
    );
    interactiveRuntime.launch(options.repoRoot, interactiveWorkspace);
  }

  if (!options.hasChanges(options.repoRoot)) {
    console.log("Codex exited without producing any file changes to review or commit.");
    return;
  }

  await finalizeRuntimeChanges({
    repoRoot: options.repoRoot,
    runDir: workspace.runDir,
    commitPrompt: "Commit generated changes with this message? [Y/n/m]: ",
    promptForLine: options.promptForLine,
    hasChanges: options.hasChanges,
    commitGeneratedChanges: options.commitGeneratedChanges,
    resolveInitialCommitMessage: async () => {
      const { provider } = await options.createProvider(options.repoRoot);
      const proposal = await generateDiffBasedCommitProposal(
        options.repoRoot,
        provider,
        options.readDiff
      );
      return proposal.initialMessage;
    },
    noChangesMessage: "Codex exited without producing any file changes to review or commit.",
    noChangesAction: "return",
    verifyBuild: {
      buildCommand: options.buildCommand,
      outputLogPath: workspace.outputLogPath,
      run: options.verifyBuild,
    },
    checkForChangesBeforeBuild: true,
  });
}
