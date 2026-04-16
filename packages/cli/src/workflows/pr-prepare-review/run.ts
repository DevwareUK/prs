import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatCommandForDisplay } from "../../config";
import type { RepositoryForge } from "../../forge";
import { printGeneratedTextPreview } from "../../generated-text-review";
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
  writePullRequestPrepareReviewMetadata,
  writePullRequestPrepareReviewWorkspaceFiles,
} from "./workspace";

type RunPrPrepareReviewCommandOptions = {
  prNumber: number;
  repoRoot: string;
  buildCommand: string[];
  forge: RepositoryForge;
  ensureCleanWorkingTree(repoRoot: string): void;
};

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

function runTrackedCommand(
  repoRoot: string,
  workspace: PullRequestPrepareReviewWorkspace,
  command: string,
  args: string[],
  errorMessage: string
): string {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  appendRunLog(workspace.outputLogPath, command, args, stdout, stderr);

  if (stdout) {
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
  }

  if (result.error) {
    throw new Error(`${errorMessage} ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
  }

  return stdout;
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

  writePullRequestPrepareReviewWorkspaceFiles(
    options.repoRoot,
    workspace,
    {
      pullRequest,
      linkedIssues,
      checkoutTarget,
      runtimePlan,
      buildCommandDisplay: formatCommandForDisplay(options.buildCommand),
    },
    options.buildCommand
  );
  writePullRequestPrepareReviewMetadata(options.repoRoot, workspace, {
    pullRequest,
    linkedIssues,
    checkoutTarget,
    runtimePlan,
    buildCommandDisplay: formatCommandForDisplay(options.buildCommand),
  }, runtimePlan);

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
  writePullRequestPrepareReviewMetadata(options.repoRoot, workspace, {
    pullRequest,
    linkedIssues,
    checkoutTarget,
    runtimePlan: finalizedRuntimePlan,
    buildCommandDisplay: formatCommandForDisplay(options.buildCommand),
  }, finalizedRuntimePlan);

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
    return;
  }

  console.log(
    "Opening a fresh interactive Codex session in this terminal because the generated session id could not be recovered..."
  );
  console.log(
    "You can now ask follow-up review questions or request fixes before exiting Codex."
  );
  interactiveRuntime.launch(options.repoRoot, interactiveWorkspace);
}
