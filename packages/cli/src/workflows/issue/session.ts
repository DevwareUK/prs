import type { RepositoryAiWorkflowRole } from "@prs/contracts";
import {
type GitHubOutputMode
} from "@prs/contracts";
import {
buildPRAssistantSection,
generateIssueResolutionPlan,
mergePRAssistantSection
} from "@prs/core";
import { spawnSync } from "node:child_process";
import {
appendFileSync,
existsSync,
mkdirSync,
readFileSync,
writeFileSync
} from "node:fs";
import { dirname,resolve } from "node:path";
import {
createProvider,
getDefaultRepoRoot,
getRepositoryConfig,
getRepositoryForge,
} from "../../cli-context";
import { formatCommandForDisplay } from "../../config";
import { buildDoneStateInstructions } from "../../done-state";
import {
type IssueDetails,
type IssuePlanComment,
type RepositoryComment,
type RepositoryForge
} from "../../forge";
import {
validateCommitMessage,
type ReviewedGeneratedText
} from "../../generated-text-review";
import {
createIssuePlanWorkspace,
formatRunTimestamp,
getIssueSessionStateFilePath,
getIssueStateDir,
resolveExistingIssueSessionStateFilePath,
toRepoRelativePath,
type IssuePlanWorkspace
} from "../../run-artifacts";
import {
findTrackedRuntimeSessionById,
getInteractiveRuntimeByType,
isCodexSuperpowersAvailable,
launchUnattendedRuntime,
type InteractiveRuntimeType
} from "../../runtime";
import {
finalizeRuntimeChanges,
} from "../../runtime-change-review";
import {
parseSetupCommandArgs
} from "../../setup";
import {
branchContainsCommit,
ensureGuidedCheckoutReady,
ensureVerificationCommandAvailable,
preflightIssueBaseBranch,
preflightRemoteBranch,
} from "../../workflow-preflights";

export { parseAuditCommandArgs } from "../../commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "../../commands/backlog";
export { parseIssueCommandArgs } from "../../commands/issue";
export { parseReviewCommandArgs } from "../../commands/review";
export { parseSetupCommandArgs };

import { commitGeneratedChanges,ensureCleanWorkingTree,hasChanges,readIssueWorkflowDiff,verifyBuild } from "../../cli-git";

import { promptForLine } from "../../cli-prompts";


import { createSuperpowersIssuePlanComment,resolveIssuePlanComment } from "./publication";

import { getPrsLinkedSourceIssueNumber } from "./refinement";

export function getPrsLinkedSourceIssueNumber(issue: IssueDetails): number | undefined {
  const trimmedBody = issue.body.trimStart();
  if (!trimmedBody.startsWith(PRS_MANAGED_ISSUE_MARKER)) {
    return undefined;
  }

  const metadataBlock = trimmedBody.slice(0, 500);
  const match = metadataBlock.match(/^Refined from source issue #(\d+)\.$/m);
  if (!match) {
    return undefined;
  }

  const issueNumber = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(issueNumber) && issueNumber > 0
    ? issueNumber
    : undefined;
}

export function parseCreatedIssueUrl(issueUrl: string): { issueNumber: number; issueUrl: string } {
  const normalizedUrl = issueUrl.trim();
  const match = normalizedUrl.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)$/);
  if (!match) {
    throw new Error(`Created issue URL is not a canonical GitHub issue URL: ${normalizedUrl}`);
  }

  const issueNumber = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Created issue URL does not include a valid issue number: ${normalizedUrl}`);
  }

  return {
    issueNumber,
    issueUrl: normalizedUrl,
  };
}

export function loadIssueSessionState(
  repoRoot: string,
  issueNumber: number
): IssueSessionState | undefined {
  const stateFilePath = resolveExistingIssueSessionStateFilePath(repoRoot, issueNumber);
  if (!existsSync(stateFilePath)) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as Partial<IssueSessionState>;
  const runtimeType =
    parsed.runtimeType === undefined &&
    (typeof parsed.sessionId === "string" || parsed.executionMode === "unattended")
      ? "codex"
      : parsed.runtimeType;
  if (
    parsed.issueNumber !== issueNumber ||
    (runtimeType !== "codex" && runtimeType !== "claude-code") ||
    typeof parsed.branchName !== "string" ||
    (parsed.baseBranch !== undefined && typeof parsed.baseBranch !== "string") ||
    (parsed.configuredBaseBranch !== undefined &&
      typeof parsed.configuredBaseBranch !== "string") ||
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
      )} is malformed. Remove it and rerun \`prs issue ${issueNumber}\` to start a fresh session.`
    );
  }

  return {
    ...parsed,
    runtimeType,
  } as IssueSessionState;
}

export function writeIssueSessionState(
  repoRoot: string,
  state: IssueSessionState
): void {
  const stateDir = getIssueStateDir(repoRoot, state.issueNumber);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    getIssueSessionStateFilePath(repoRoot, state.issueNumber),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

export function buildIssueResumeRecoveryMessage(
  repoRoot: string,
  issueNumber: number,
  detail: string
): string {
  const stateFile = toRepoRelativePath(
    repoRoot,
    getIssueSessionStateFilePath(repoRoot, issueNumber)
  );

  return [
    detail,
    `Recovery: remove ${stateFile} and rerun \`prs issue ${issueNumber}\` to start a fresh session.`,
  ].join(" ");
}

export function createIssueWorkspace(
  repoRoot: string,
  issueNumber: number,
  issue: IssueDetails,
  issueDirOverride?: string
): IssueWorkspace {
  const slug = slugifyIssueTitle(issue.title) || `issue-${issueNumber}`;
  const issueDir =
    issueDirOverride ??
    resolve(repoRoot, ".prs", "issues", `${issueNumber}-${slug}`);
  const runDir = resolve(
    repoRoot,
    ".prs",
    "runs",
    `${formatRunTimestamp()}-issue-${issueNumber}`
  );

  mkdirSync(issueDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  return {
    issueDir,
    issueFilePath: resolve(issueDir, "issue.md"),
    runDir,
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
  };
}

export function formatIssueSnapshot(
  issueNumber: number,
  issue: IssueDetails,
  planComment?: IssuePlanComment
): string {
  const issueBody = issue.body.trim() || "(No issue body provided.)";
  const lines = [
    "# Issue Snapshot",
    "",
    `- Issue number: ${issueNumber}`,
    `- Title: ${issue.title}`,
    `- URL: ${issue.url}`,
    "",
    "## Body",
    "",
    issueBody,
  ];

  if (planComment) {
    lines.push(
      "",
      "## Resolution Plan",
      "",
      `Latest editable plan comment: ${planComment.url}`,
      "",
      stripIssuePlanCommentMarker(planComment.body)
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function writeGitHubOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT?.trim();
  if (!outputPath) {
    return;
  }

  const delimiter = `git_ai_${name}_${Date.now()}`;
  appendFileSync(
    outputPath,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
    "utf8"
  );
}

export function emitIssuePrepareOutputs(repoRoot: string, context: IssueRunContext): void {
  writeGitHubOutput("issue_number", String(context.issueNumber));
  writeGitHubOutput("issue_title", context.issue.title);
  writeGitHubOutput("issue_url", context.issue.url);
  writeGitHubOutput("branch_name", context.branchName);
  writeGitHubOutput("runtime_type", context.runtime.type);
  writeGitHubOutput("issue_file", toRepoRelativePath(repoRoot, context.workspace.issueFilePath));
  writeGitHubOutput(
    "prompt_file",
    toRepoRelativePath(repoRoot, context.workspace.promptFilePath)
  );
  writeGitHubOutput(
    "metadata_file",
    toRepoRelativePath(repoRoot, context.workspace.metadataFilePath)
  );
  writeGitHubOutput("output_log", toRepoRelativePath(repoRoot, context.workspace.outputLogPath));
  writeGitHubOutput("run_dir", toRepoRelativePath(repoRoot, context.workspace.runDir));
  writeGitHubOutput("mode", context.mode);
}

export function printManualPrInstructions(
  repoRoot: string,
  branchName: string,
  baseBranch: string,
  prTitleFilePath: string,
  prBodyFilePath: string
): void {
  const titleFile = toRepoRelativePath(repoRoot, prTitleFilePath);
  const bodyFile = toRepoRelativePath(repoRoot, prBodyFilePath);

  console.log("");
  console.log("GitHub CLI is unavailable or not authenticated.");
  console.log("To push and open a PR manually, run:");
  console.log(`  git push -u origin ${branchName}`);
  console.log(
    `  gh pr create --title "$(cat ${JSON.stringify(titleFile)})" --body-file ${JSON.stringify(bodyFile)} --base ${baseBranch}`
  );
  console.log(`Generated PR title: ${titleFile}`);
  console.log(`Generated PR body: ${bodyFile}`);
}

export function printIssueRunOutcomeSummary(outcome: IssueRunOutcomeSummary): void {
  console.log("");
  console.log(`Issue #${outcome.issueNumber} run summary:`);
  console.log(`  Branch: ${outcome.branchName}`);
  console.log(`  Base branch: ${outcome.baseBranch}`);
  console.log(`  Run artifacts: ${outcome.runDir}`);
  console.log(`  Commit created: ${outcome.committed ? "yes" : "no"}`);

  if (outcome.pullRequest.status === "created") {
    console.log(
      outcome.pullRequest.url
        ? `  Pull request: ${outcome.pullRequest.url}`
        : "  Pull request: created"
    );
    return;
  }

  if (outcome.pullRequest.status === "manual") {
    console.log("  Pull request: manual creation required");
    console.log(`  PR title file: ${outcome.pullRequest.titleFilePath}`);
    console.log(`  PR body file: ${outcome.pullRequest.bodyFilePath}`);
    return;
  }

  console.log(`  Pull request: skipped (${outcome.pullRequest.reason})`);
}

export function localBranchExists(repoRoot: string, branchName: string): boolean {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "rev-parse", "--verify", branchName],
    {
      stdio: "ignore",
    }
  );

  return !result.error && result.status === 0;
}

export function ensureGuidedCheckoutReadyForRuntime(repoRoot: string, baseBranch: string): void {
  if (process.env.PRS_DISABLE_AUTO_RUN === "1") {
    ensureCleanWorkingTree(repoRoot);
    return;
  }

  ensureGuidedCheckoutReady(repoRoot, baseBranch);
}

export function ensureBranchDoesNotExist(repoRoot: string, branchName: string): void {
  if (localBranchExists(repoRoot, branchName)) {
    throw new Error(`Branch "${branchName}" already exists.`);
  }
}

export function switchToExistingIssueBranch(repoRoot: string, branchName: string): void {
  console.log(`Switching to existing issue branch ${branchName}...`);
  runInteractiveCommand(
    "git",
    ["checkout", branchName],
    `Failed to switch to existing issue branch "${branchName}".`,
    repoRoot
  );
}

export function syncIssueBaseBranch(
  repoRoot: string,
  baseBranch: string,
  preflight: { remoteRef: string; remoteTip: string }
): void {
  const { remoteRef, remoteTip } = preflight;

  if (
    process.env.PRS_ISSUE_WORKTREE_BASE_READY === "1" &&
    branchContainsCommit(repoRoot, remoteTip, "HEAD")
  ) {
    console.log(
      `Using prepared worktree HEAD for ${baseBranch}; it already contains ${remoteRef} tip ${remoteTip}.`
    );
    return;
  }

  console.log(`Switching to base branch ${baseBranch}...`);
  runInteractiveCommand(
    "git",
    ["checkout", baseBranch],
    `Failed to switch to base branch "${baseBranch}".`,
    repoRoot
  );

  if (branchContainsCommit(repoRoot, remoteTip, "HEAD")) {
    console.log(`Base branch ${baseBranch} already contains ${remoteRef} tip ${remoteTip}.`);
    return;
  }

  console.log(`Fast-forwarding ${baseBranch} to ${remoteRef}...`);
  runInteractiveCommand(
    "git",
    ["merge", "--ff-only", remoteRef],
    `Failed to fast-forward base branch "${baseBranch}" to ${remoteRef}. Reconcile the local "${baseBranch}" branch with origin and rerun the issue workflow.`,
    repoRoot
  );
}

export function formatIssueOverlapSummary(
  overlappingPullRequests: IssueOverlappingPullRequest[]
): string {
  return overlappingPullRequests
    .map(
      (pullRequest) =>
        `#${pullRequest.number} ${pullRequest.title} (${pullRequest.matchingFiles.join(", ")})`
    )
    .join("; ");
}

export function formatIssueOverlapNotice(decision: IssueBranchBaseDecision): string {
  const lines = [
    "Open pull requests change files planned for this issue:",
    ...decision.overlappingPullRequests.map(
      (pullRequest) =>
        `- #${pullRequest.number} ${pullRequest.title} (${pullRequest.url}) overlaps ${pullRequest.matchingFiles.join(", ")}`
    ),
    `Recommended base: ${decision.branchName}`,
    `Reason: ${decision.reason}`,
  ];

  return lines.join("\n");
}

export function createConfiguredIssueBaseDecision(
  configuredBaseBranch: string,
  reason: string,
  overlappingPullRequests: IssueOverlappingPullRequest[] = []
): IssueBranchBaseDecision {
  return {
    branchName: configuredBaseBranch,
    pullRequestBaseBranch: configuredBaseBranch,
    source: "configured-base",
    reason,
    overlappingPullRequests,
  };
}

export async function promptForIssueBranchBaseDecision(input: {
  forge: RepositoryForge;
  configuredBaseBranch: string;
  plannedFiles: string[];
  recommendation: IssueBranchBaseDecision;
}): Promise<IssueBranchBaseDecision> {
  console.log(formatIssueOverlapNotice(input.recommendation));

  const reviewAnswer = (
    await promptForLine("Review or merge overlapping pull requests first? [Y/n]: ")
  )
    .trim()
    .toLowerCase();
  const shouldReviewFirst =
    reviewAnswer === "" || reviewAnswer === "y" || reviewAnswer === "yes";

  if (shouldReviewFirst) {
    const openPullRequests = await input.forge.listOpenPullRequestChanges();
    const remaining = findOverlappingPullRequests(input.plannedFiles, openPullRequests);
    if (remaining.length > 0) {
      throw new Error(
        `Open pull requests still change planned files: ${formatIssueOverlapSummary(
          remaining
        )}. Review or merge them, then rerun prs issue.`
      );
    }

    return createConfiguredIssueBaseDecision(
      input.configuredBaseBranch,
      "Overlapping pull requests were reviewed or merged before branch creation."
    );
  }

  const answer = (
    await promptForLine(
      `Continue from ${input.recommendation.branchName} (${
        input.recommendation.source === "pull-request-head"
          ? "recommended stacked PR"
          : "recommended base branch"
      })? [Y/n]: `
    )
  )
    .trim()
    .toLowerCase();
  const acceptsRecommendation = answer === "" || answer === "y" || answer === "yes";
  if (acceptsRecommendation) {
    return input.recommendation;
  }

  if (input.recommendation.source === "pull-request-head") {
    return createConfiguredIssueBaseDecision(
      input.configuredBaseBranch,
      "User overrode the recommended stacked PR base.",
      input.recommendation.overlappingPullRequests
    );
  }

  const firstEligible = input.recommendation.overlappingPullRequests.find(
    (pullRequest) => pullRequest.baseRefName === input.configuredBaseBranch
  );
  if (!firstEligible) {
    return input.recommendation;
  }

  return {
    branchName: firstEligible.headRefName,
    pullRequestBaseBranch: firstEligible.headRefName,
    source: "pull-request-head",
    reason: `User overrode the configured-base recommendation to branch from PR #${firstEligible.number}.`,
    overlappingPullRequests: input.recommendation.overlappingPullRequests,
  };
}

export async function chooseIssueBranchBase(input: {
  forge: RepositoryForge;
  mode: IssueWorkspaceMode;
  configuredBaseBranch: string;
  planComment?: IssuePlanComment;
}): Promise<IssueBranchBaseDecision> {
  const plannedFiles = extractIssuePlanLikelyFiles(input.planComment?.body);
  if (plannedFiles.length === 0) {
    console.log(
      "Skipping open pull request overlap check because the issue plan has no concrete likely files."
    );
    return createConfiguredIssueBaseDecision(
      input.configuredBaseBranch,
      "No concrete planned files were available for overlap detection."
    );
  }

  const openPullRequests = await input.forge.listOpenPullRequestChanges();
  const overlappingPullRequests = findOverlappingPullRequests(
    plannedFiles,
    openPullRequests
  );
  if (overlappingPullRequests.length === 0) {
    return createConfiguredIssueBaseDecision(
      input.configuredBaseBranch,
      "No open pull requests change the planned files."
    );
  }

  const recommendation = recommendIssueBranchBase({
    configuredBaseBranch: input.configuredBaseBranch,
    overlappingPullRequests,
    plannedFiles,
  });

  if (input.mode !== "local" || !process.stdin.isTTY) {
    console.log(formatIssueOverlapNotice(recommendation));
    console.log(`Continuing non-interactively from ${recommendation.branchName}.`);
    return recommendation;
  }

  return promptForIssueBranchBaseDecision({
    forge: input.forge,
    configuredBaseBranch: input.configuredBaseBranch,
    plannedFiles,
    recommendation,
  });
}

export function syncIssueSelectedBaseBranch(
  repoRoot: string,
  decision: IssueBranchBaseDecision,
  configuredBasePreflight: { remoteRef: string; remoteTip: string }
): void {
  if (decision.source === "configured-base") {
    syncIssueBaseBranch(repoRoot, decision.branchName, configuredBasePreflight);
    return;
  }

  const preflight = preflightRemoteBranch(
    repoRoot,
    "origin",
    decision.branchName,
    `Open pull request head branch "${decision.branchName}"`,
    "review or merge the overlapping pull request before rerunning the issue workflow"
  );

  if (!localBranchExists(repoRoot, decision.branchName)) {
    console.log(`Creating local base branch ${decision.branchName} from ${preflight.remoteRef}...`);
    runInteractiveCommand(
      "git",
      ["checkout", "-b", decision.branchName, preflight.remoteRef],
      `Failed to create local branch "${decision.branchName}" from ${preflight.remoteRef}.`,
      repoRoot
    );
    return;
  }

  syncIssueBaseBranch(repoRoot, decision.branchName, preflight);
}

export function updateIssueWorkspaceMetadata(
  workspace: IssueWorkspace,
  updater: (currentMetadata: Record<string, unknown>) => Record<string, unknown>
): void {
  const currentMetadata = JSON.parse(
    readFileSync(workspace.metadataFilePath, "utf8")
  ) as Record<string, unknown>;
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(updater(currentMetadata), null, 2)}\n`,
    "utf8"
  );
}

export function recordIssueRunOutcome(
  workspace: IssueWorkspace,
  outcome: IssueRunOutcomeSummary
): void {
  updateIssueWorkspaceMetadata(workspace, (currentMetadata) => ({
    ...currentMetadata,
    outcome: {
      issueNumber: outcome.issueNumber,
      branchName: outcome.branchName,
      baseBranch: outcome.baseBranch,
      runDir: outcome.runDir,
      committed: outcome.committed,
      pullRequest: outcome.pullRequest,
    },
  }));
}

export function createIssueSessionState(
  repoRoot: string,
  context: IssueRunContext,
  sessionId?: string
): IssueSessionState {
  const previousState = loadIssueSessionState(repoRoot, context.issueNumber);
  const createdAt = previousState?.createdAt ?? new Date().toISOString();

  return {
    issueNumber: context.issueNumber,
    runtimeType: context.runtime.type,
    branchName: context.branchName,
    baseBranch: context.baseBranch,
    configuredBaseBranch: context.configuredBaseBranch,
    overlapDecision: context.overlapDecision,
    issueDir: toRepoRelativePath(repoRoot, context.workspace.issueDir),
    runDir: toRepoRelativePath(repoRoot, context.workspace.runDir),
    promptFile: toRepoRelativePath(repoRoot, context.workspace.promptFilePath),
    outputLog: toRepoRelativePath(repoRoot, context.workspace.outputLogPath),
    sessionId,
    sandboxMode:
      getInteractiveRuntimeByType(context.runtime.type).metadata.sandboxMode,
    approvalPolicy:
      getInteractiveRuntimeByType(context.runtime.type).metadata.approvalPolicy,
    executionMode: context.mode === "unattended" ? "unattended" : "interactive",
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

export function persistIssueSessionState(
  repoRoot: string,
  context: IssueRunContext,
  sessionId?: string
): void {
  writeIssueSessionState(repoRoot, createIssueSessionState(repoRoot, context, sessionId));
}

export function buildRuntimePrompt(
  repoRoot: string,
  workspace: IssueWorkspace,
  mode: IssueWorkspaceMode,
  buildCommand: string[]
): string {
  const issueFile = toRepoRelativePath(repoRoot, workspace.issueFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);
  const modeSpecificInstructions =
    mode === "github-action"
      ? [
          "You are running inside a GitHub Actions workflow via the configured interactive coding runtime.",
          "Do not wait for interactive user input.",
        ]
      : mode === "unattended"
        ? [
            "You are running inside an unattended local prs issue workflow via Codex.",
            "Do not wait for interactive user input.",
          ]
      : [];
  const doneStateInstructions = buildDoneStateInstructions({
    mode: mode === "local" ? "interactive" : "non-interactive",
    readyLabel:
      mode === "local" ? "Ready to commit" : "Ready for the next automation step",
  });

  return [
    "You are working in the current repository.",
    ...modeSpecificInstructions,
    "",
    `Read the issue snapshot at \`${issueFile}\` before making changes.`,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to the coding agent:",
    "- analyze the repository only as needed for this issue",
    "- keep code changes focused on the issue snapshot",
    "- follow existing architecture patterns",
    "- if the issue snapshot includes a resolution plan, treat it as the latest plan of record",
    `- run \`${formatCommandForDisplay(buildCommand)}\` before finishing if code changes are made`,
    "- do not modify `.prs/` unless needed for local workflow artifacts",
    "- do not commit `.prs/` files",
    "",
    ...doneStateInstructions,
  ].join("\n");
}

export function writeIssueWorkspaceFiles(
  repoRoot: string,
  issueNumber: number,
  issue: IssueDetails,
  planComment: IssuePlanComment | undefined,
  branchName: string,
  workspace: IssueWorkspace,
  mode: IssueWorkspaceMode,
  buildCommand: string[],
  runtimeType: InteractiveRuntimeType,
  runtimeInvocation: "new" | "resume",
  sessionId?: string
): void {
  const createdAt = new Date().toISOString();
  const runtime = getInteractiveRuntimeByType(runtimeType);
  const prompt = buildRuntimePrompt(repoRoot, workspace, mode, buildCommand);

  writeFileSync(
    workspace.issueFilePath,
    formatIssueSnapshot(issueNumber, issue, planComment),
    "utf8"
  );
  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        mode,
        issueNumber,
        issueTitle: issue.title,
        issueUrl: issue.url,
        issuePlanCommentUrl: planComment?.url,
        branchName,
        issueDir: toRepoRelativePath(repoRoot, workspace.issueDir),
        issueFile: toRepoRelativePath(repoRoot, workspace.issueFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        runtime: {
          type: runtime.type,
          displayName: runtime.displayName,
          command: runtime.metadata.command,
          invocation: runtimeInvocation,
          sessionId,
          sandboxMode: runtime.metadata.sandboxMode,
          approvalPolicy: runtime.metadata.approvalPolicy,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.outputLogPath,
    [
      "# prs issue run log",
      "",
      `Created: ${createdAt}`,
      `Issue snapshot: ${toRepoRelativePath(repoRoot, workspace.issueFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      `Runtime: ${runtime.displayName}`,
      `Runtime invocation: ${runtimeInvocation}`,
      ...(sessionId ? [`Runtime session: ${sessionId}`] : []),
      "",
    ].join("\n"),
    "utf8"
  );
}

export function createStandaloneIssueFinalizeRunDir(repoRoot: string, issueNumber: number): string {
  const runDir = resolve(
    repoRoot,
    ".prs",
    "runs",
    `${formatRunTimestamp()}-issue-${issueNumber}-finalize`
  );

  mkdirSync(runDir, { recursive: true });
  return runDir;
}

export function createAutoAcceptedGeneratedText(
  filePath: string,
  content: string
): ReviewedGeneratedText {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  validateCommitMessage(content);

  return {
    content,
    filePath,
  };
}

export function formatFallbackCommitMessage(
  title: string,
  body?: string
): string {
  return body ? `${title}\n\n${body.trim()}\n` : `${title}\n`;
}

export async function resolveIssueCommitProposal(options: {
  repoRoot: string;
  issueNumber: number;
  issue?: IssueDetails;
  mode: "address" | "finalize";
}): Promise<{ diff: string; initialMessage: string }> {
  const diff = readIssueWorkflowDiff(options.repoRoot);
  const title =
    options.mode === "finalize"
      ? `feat: finalize issue #${options.issueNumber}`
      : `feat: address issue #${options.issueNumber}`;
  const body = options.issue?.title ? `Issue: ${options.issue.title}` : undefined;

  return {
    diff,
    initialMessage: formatFallbackCommitMessage(title, body),
  };
}

export async function finalizeIssueRunUnattended(
  repoRoot: string,
  issueNumber: number,
  runDir: string,
  issue?: IssueDetails
): Promise<Extract<FinalizeIssueRunResult, { committed: true }>> {
  const proposal = await resolveIssueCommitProposal({
    repoRoot,
    issueNumber,
    issue,
    mode: "address",
  });
  const commitMessage = createAutoAcceptedGeneratedText(
    resolve(runDir, "commit-message.txt"),
    proposal.initialMessage
  );

  console.log(
    `Committing generated changes for issue #${issueNumber} with the generated commit message...`
  );
  commitGeneratedChanges(repoRoot, commitMessage);

  return {
    committed: true,
    diff: proposal.diff,
    commitMessage,
  };
}

export function collectChangedFilesFromDiff(diff: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const line of diff.split("\n")) {
    if (!line.startsWith("diff --git ")) {
      continue;
    }

    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) {
      continue;
    }

    const [, fromPath, toPath] = match;
    const resolvedPath =
      toPath === "dev/null" ? fromPath : fromPath === "dev/null" ? toPath : toPath;
    if (!seen.has(resolvedPath)) {
      seen.add(resolvedPath);
      files.push(resolvedPath);
    }
  }

  return files;
}

export function ensureIssueClosingReferences(body: string, issueNumbers: number[]): string {
  const trimmedBody = body.trim();
  const uniqueIssueNumbers = [...new Set(issueNumbers)].filter(
    (issueNumber) => Number.isSafeInteger(issueNumber) && issueNumber > 0
  );
  const missingReferences = uniqueIssueNumbers.filter(
    (issueNumber) =>
      !new RegExp(`\\bcloses\\s+#${issueNumber}\\b`, "i").test(trimmedBody)
  );

  if (missingReferences.length === 0) {
    return trimmedBody;
  }

  return [
    trimmedBody,
    "",
    ...missingReferences.map((issueNumber) => `Closes #${issueNumber}`),
  ].join("\n");
}

export function writeIssuePullRequestFiles(
  runDir: string,
  title: string,
  body: string
): Pick<GeneratedIssuePullRequest, "titleFilePath" | "bodyFilePath"> {
  const titleFilePath = resolve(runDir, "pull-request-title.txt");
  const bodyFilePath = resolve(runDir, "pull-request-body.md");

  writeFileSync(titleFilePath, `${title.trim()}\n`, "utf8");
  writeFileSync(bodyFilePath, `${body.trim()}\n`, "utf8");

  return {
    titleFilePath,
    bodyFilePath,
  };
}

export function appendIssueOverlapDependencyNote(
  body: string,
  decision: IssueBranchBaseDecision | undefined
): string {
  if (!decision || decision.overlappingPullRequests.length === 0) {
    return body;
  }

  const lines = [
    body.trimEnd(),
    "",
    "## Open PR File Overlap",
    "",
    decision.source === "pull-request-head"
      ? `This branch was prepared from \`${decision.branchName}\` because an open PR changes planned files. Review that PR before merging this one.`
      : "Open PRs change planned files for this issue. Review them before merging if their changes are still open.",
    "",
    ...decision.overlappingPullRequests.map(
      (pullRequest) =>
        `- #${pullRequest.number} ${pullRequest.title} (${pullRequest.url}) overlaps ${pullRequest.matchingFiles.join(", ")}`
    ),
  ];

  return lines.join("\n");
}

export async function generateIssuePullRequest(
  options: {
    repoRoot: string;
    issueNumber: number;
    issue: IssueDetails;
    diff: string;
    commitMessage: ReviewedGeneratedText;
    overlapDecision?: IssueBranchBaseDecision;
    runDir?: string;
  }
): Promise<GeneratedIssuePullRequest> {
  const changedFiles = collectChangedFilesFromDiff(options.diff);
  const title = options.issue.title.trim() || `Issue #${options.issueNumber}`;
  const linkedSourceIssueNumber = getPrsLinkedSourceIssueNumber(options.issue);
  const closingIssueNumbers =
    linkedSourceIssueNumber === undefined ||
    linkedSourceIssueNumber === options.issueNumber
      ? [options.issueNumber]
      : [options.issueNumber, linkedSourceIssueNumber];
  const descriptionBody = [
    `Implements #${options.issueNumber}: ${title}.`,
  ].join("\n");
  const bodyWithOverlapNote = appendIssueOverlapDependencyNote(
    ensureIssueClosingReferences(descriptionBody, closingIssueNumbers),
    options.overlapDecision
  );
  const body = mergePRAssistantSection(
    bodyWithOverlapNote,
    buildPRAssistantSection({
      summary: `Implements issue #${options.issueNumber} without requiring provider-generated finalization text.`,
      riskAreas: [],
      filesChanged: changedFiles,
      testingNotes: [],
      rolloutConcerns: [],
      reviewerChecklist: [],
    })
  );
  const pullRequest: GeneratedIssuePullRequest = {
    title,
    body,
  };

  if (!options.runDir) {
    return pullRequest;
  }

  return {
    ...pullRequest,
    ...writeIssuePullRequestFiles(options.runDir, pullRequest.title, pullRequest.body),
  };
}

export type IssuePlanResolutionMode = "explicit-plan-command" | "execution-preflight";

export function buildIssuePlanRuntimePrompt(input: {
  repoRoot: string;
  workspace: IssuePlanWorkspace;
  issueNumber: number;
  issue: IssueDetails;
}): string {
  const runDir = toRepoRelativePath(input.repoRoot, input.workspace.runDir);
  const superpowersSpecFile = toRepoRelativePath(
    input.repoRoot,
    input.workspace.superpowersSpecFilePath
  );
  const superpowersPlanFile = toRepoRelativePath(
    input.repoRoot,
    input.workspace.superpowersPlanFilePath
  );

  return [
    "You are working in the current repository.",
    "",
    `Create an implementation plan for GitHub issue #${input.issueNumber}.`,
    "",
    "Current issue title:",
    input.issue.title,
    "",
    "Current issue URL:",
    input.issue.url,
    "",
    "Current issue body:",
    input.issue.body.trim() || "(No issue body provided.)",
    "",
    `Write the Superpowers spec artifact to \`${superpowersSpecFile}\`.`,
    `Write the Superpowers plan artifact to \`${superpowersPlanFile}\`.`,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to the coding agent:",
    "- inspect the repository only as needed to make an implementation-ready plan",
    "- use `superpowers:brainstorming` first for clarification and scope shaping",
    "- use `superpowers:writing-plans` discipline to create the implementation plan",
    "- override the normal Superpowers spec/plan continuation for this workflow",
    "- keep any intermediate Superpowers docs inside the provided `.prs/runs/...` directory",
    "- write any Superpowers brainstorming/spec artifact only to the provided spec path",
    "- write any Superpowers writing-plans artifact only to the provided plan path",
    "- do not create `docs/superpowers/specs/...` documents",
    "- do not create `docs/superpowers/plans/...` documents",
    "- write only the run-local Superpowers artifacts needed for this plan workflow",
    "- make the plan concrete enough for an implementation agent to execute task by task",
    "- include a step to update `.prs/config.json` `prReadiness.commands` when the issue introduces required local setup such as migrations, config import, generated assets, dependency updates, or cache rebuilds",
    "- do not create or update GitHub issues or comments directly",
    "- do not modify unrelated repository files",
    "- do not modify `.prs/` except for the provided local workflow artifacts",
    "",
    "When the plan artifact is complete and saved, stop.",
  ].join("\n");
}

export function writeIssuePlanWorkspaceFiles(
  repoRoot: string,
  workspace: IssuePlanWorkspace,
  runtimeType: InteractiveRuntimeType,
  issueNumber: number,
  issue: IssueDetails
): void {
  const createdAt = new Date().toISOString();
  const runtime = getInteractiveRuntimeByType(runtimeType);
  const prompt = buildIssuePlanRuntimePrompt({
    repoRoot,
    workspace,
    issueNumber,
    issue,
  });

  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        flow: "issue-plan",
        issueNumber,
        issueTitle: issue.title,
        issueUrl: issue.url,
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        superpowers: {
          enabled: true,
          specFile: toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath),
          planFile: toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath),
        },
        runtime: {
          type: runtime.type,
          displayName: runtime.displayName,
          command: runtime.metadata.command,
          sandboxMode: runtime.metadata.sandboxMode,
          approvalPolicy: runtime.metadata.approvalPolicy,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.outputLogPath,
    [
      "# prs issue plan run log",
      "",
      `Created: ${createdAt}`,
      `Issue number: ${issueNumber}`,
      `Issue URL: ${issue.url}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      `Superpowers spec file: ${toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath)}`,
      `Superpowers plan file: ${toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath)}`,
      `Runtime: ${runtime.displayName}`,
      "",
    ].join("\n"),
    "utf8"
  );
}

export function shouldUseSuperpowersIssuePlan(options: {
  repoRoot: string;
  runtimeType: InteractiveRuntimeType;
}): { useSuperpowers: true } | { useSuperpowers: false; reason: string } {
  const repositoryConfig = getRepositoryConfig(options.repoRoot);

  if (!repositoryConfig.ai.issue.useCodexSuperpowers) {
    return {
      useSuperpowers: false,
      reason:
        "Superpowers-backed issue plan generation is disabled; using structured provider issue plan generation.",
    };
  }

  if (options.runtimeType !== "codex") {
    const runtime = getInteractiveRuntimeByType(options.runtimeType);
    return {
      useSuperpowers: false,
      reason: `Superpowers-backed issue plan generation requires Codex, but the selected runtime is ${runtime.displayName}; using structured provider issue plan generation.`,
    };
  }

  if (!isCodexSuperpowersAvailable()) {
    return {
      useSuperpowers: false,
      reason:
        "Codex Superpowers is not available in the current Codex installation; using structured provider issue plan generation.",
    };
  }

  const runtimeAvailability = getInteractiveRuntimeByType("codex").checkAvailability();
  if (!runtimeAvailability.available) {
    return {
      useSuperpowers: false,
      reason: `Codex is unavailable because ${runtimeAvailability.reason}; using structured provider issue plan generation.`,
    };
  }

  return { useSuperpowers: true };
}

export async function createStructuredIssuePlanComment(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  issue: IssueDetails;
  existingPlanComment?: IssuePlanComment;
  mode: IssuePlanResolutionMode;
  workflowRole?: RepositoryAiWorkflowRole;
  comments?: RepositoryComment[];
  specAlreadyEnsured?: boolean;
  outputMode?: GitHubOutputMode;
}): Promise<IssuePlanComment> {
  const workflowRole =
    options.workflowRole ??
    (options.mode === "execution-preflight" ? "implementer" : "planner");

  if (
    options.mode === "execution-preflight" &&
    !options.existingPlanComment &&
    !options.specAlreadyEnsured
  ) {
    await ensureIssueSpecComment({
      repoRoot: options.repoRoot,
      forge: options.forge,
      issueNumber: options.issueNumber,
      issue: options.issue,
      comments: options.comments,
      outputMode: options.outputMode,
    });
  }

  const { provider } = await createProvider(options.repoRoot, workflowRole);
  const plan = await generateIssueResolutionPlan(provider, {
    issueNumber: options.issueNumber,
    issueTitle: options.issue.title,
    issueBody: options.issue.body,
    issueUrl: options.issue.url,
  });
  const renderedPlan = renderIssueResolutionPlanComment(
    options.issueNumber,
    plan,
    options.outputMode
  );

  if (options.existingPlanComment) {
    const comment = await options.forge.updateIssuePlanComment(
      options.existingPlanComment.id,
      renderedPlan
    );
    if (options.mode === "explicit-plan-command") {
      console.log(`Refreshed issue resolution plan comment: ${comment.url}`);
    }
    return comment;
  }

  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    renderedPlan
  );
  console.log(
    options.mode === "execution-preflight"
      ? `Created issue resolution plan comment before issue execution: ${comment.url}`
      : `Created issue resolution plan comment: ${comment.url}`
  );
  return comment;
}

export async function createSuperpowersIssuePlanComment(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  issue: IssueDetails;
  existingPlanComment?: IssuePlanComment;
  mode: IssuePlanResolutionMode;
  comments?: RepositoryComment[];
  outputMode?: GitHubOutputMode;
}): Promise<IssuePlanComment | undefined> {
  const workspace = createIssuePlanWorkspace(options.repoRoot, options.issueNumber);
  writeIssuePlanWorkspaceFiles(
    options.repoRoot,
    workspace,
    "codex",
    options.issueNumber,
    options.issue
  );

  console.log("Creating issue resolution plan with Codex Superpowers...");
  if (options.mode === "execution-preflight" && !options.existingPlanComment) {
    launchUnattendedRuntime("codex", options.repoRoot, workspace);
  } else {
    const runtime = getInteractiveRuntimeByType("codex");
    runtime.launch(options.repoRoot, workspace);
  }

  if (options.mode === "execution-preflight") {
    await ensureIssueSpecComment({
      repoRoot: options.repoRoot,
      forge: options.forge,
      issueNumber: options.issueNumber,
      issue: options.issue,
      specFilePath: workspace.superpowersSpecFilePath,
      outputLogPath: workspace.outputLogPath,
      comments: options.comments,
      outputMode: options.outputMode,
    });
  }

  const comment = await publishSuperpowersPlanArtifact({
    repoRoot: options.repoRoot,
    forge: options.forge,
    issueNumber: options.issueNumber,
    planFilePath: workspace.superpowersPlanFilePath,
    outputLogPath: workspace.outputLogPath,
    existingPlanComment: options.existingPlanComment ?? null,
    outputMode: options.outputMode,
  });

  if (!comment) {
    console.log(
      "Codex Superpowers did not produce a non-empty issue plan artifact; using structured provider issue plan generation."
    );
  }

  return comment;
}

export async function resolveIssuePlanComment(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  refresh: boolean;
  mode: IssuePlanResolutionMode;
  issue?: IssueDetails;
  runtimeType?: InteractiveRuntimeType;
  outputMode?: GitHubOutputMode;
}): Promise<IssuePlanComment> {
  const issueComments =
    options.mode === "execution-preflight"
      ? await options.forge.fetchIssueComments(options.issueNumber)
      : undefined;
  const existingPlanComment = issueComments
    ? findLatestIssuePlanComment(issueComments)
    : await options.forge.fetchIssuePlanComment(options.issueNumber);

  if (existingPlanComment && !options.refresh) {
    if (options.mode === "explicit-plan-command") {
      console.log(
        `Using existing issue resolution plan comment: ${existingPlanComment.url}`
      );
      console.log("Re-run with `--refresh` to regenerate the managed plan comment.");
    }
    return existingPlanComment;
  }

  if (!options.issue) {
    console.log(`Fetching issue #${options.issueNumber}...`);
  }
  const issue = options.issue ?? (await options.forge.fetchIssueDetails(options.issueNumber));
  const repositoryConfig = getRepositoryConfig(options.repoRoot);
  const runtimeType = options.runtimeType ?? repositoryConfig.ai.runtime.type;
  const superpowersDecision = shouldUseSuperpowersIssuePlan({
    repoRoot: options.repoRoot,
    runtimeType,
  });

  if (superpowersDecision.useSuperpowers) {
    const comment = await createSuperpowersIssuePlanComment({
      repoRoot: options.repoRoot,
      forge: options.forge,
      issueNumber: options.issueNumber,
      issue,
      existingPlanComment: existingPlanComment,
      mode: options.mode,
      comments: issueComments,
      outputMode: options.outputMode,
    });
    if (comment) {
      return comment;
    }
  } else {
    console.log(superpowersDecision.reason);
  }

  return createStructuredIssuePlanComment({
    repoRoot: options.repoRoot,
    forge: options.forge,
    issueNumber: options.issueNumber,
    issue,
    existingPlanComment,
    mode: options.mode,
    comments: issueComments,
    outputMode: options.outputMode,
    specAlreadyEnsured:
      options.mode === "execution-preflight" &&
      !existingPlanComment &&
      superpowersDecision.useSuperpowers,
  });
}

export async function runIssuePlanCommand(
  issueNumber: number,
  options: { refresh: boolean }
): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const forge = getRepositoryForge(repoRoot);
  if (forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }
  const repositoryConfig = getRepositoryConfig(repoRoot);

  await resolveIssuePlanComment({
    repoRoot,
    forge,
    issueNumber,
    refresh: options.refresh,
    mode: "explicit-plan-command",
    runtimeType: repositoryConfig.ai.runtime.type,
  });
}

export async function prepareIssueRun(
  issueNumber: number,
  mode: IssueWorkspaceMode,
  options: {
    allowResume?: boolean;
    runtimeType?: InteractiveRuntimeType;
  } = {}
): Promise<IssueRunContext> {
  const repoRoot = getDefaultRepoRoot();
  const forge = getRepositoryForge(repoRoot);
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const runtime = getInteractiveRuntimeByType(
    options.runtimeType ?? repositoryConfig.ai.runtime.type
  );
  if (forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }
  ensureVerificationCommandAvailable(
    repoRoot,
    repositoryConfig.buildCommand,
    "prs issue workflows"
  );
  const baseBranchPreflight = preflightIssueBaseBranch(
    repoRoot,
    repositoryConfig.baseBranch
  );
  if (mode === "local") {
    ensureGuidedCheckoutReadyForRuntime(repoRoot, repositoryConfig.baseBranch);
  } else {
    ensureCleanWorkingTree(repoRoot);
  }
  console.log(`Fetching issue #${issueNumber}...`);
  const issue = await forge.fetchIssueDetails(issueNumber);
  const sessionStateFilePath = getIssueSessionStateFilePath(repoRoot, issueNumber);
  const outputMode: GitHubOutputMode = mode === "unattended" ? "unattended" : "manual";
  const resolvePlanCommentForRun = () =>
    resolveIssuePlanComment({
      repoRoot,
      forge,
      issueNumber,
      refresh: false,
      mode: "execution-preflight",
      issue,
      runtimeType: runtime.type,
      outputMode,
    });
  const existingSessionState =
    options.allowResume && mode !== "github-action"
      ? loadIssueSessionState(repoRoot, issueNumber)
      : undefined;

  if (existingSessionState) {
    let runtimeInvocation: "new" | "resume" = "new";
    let sessionId = existingSessionState.sessionId;
    if (
      existingSessionState.runtimeType === runtime.type &&
      sessionId &&
      getInteractiveRuntimeByType(runtime.type).metadata.supportsSessionTracking
    ) {
      const savedSession = findTrackedRuntimeSessionById(
        runtime.type,
        repoRoot,
        sessionId
      );
      if (!savedSession) {
        throw new Error(
          buildIssueResumeRecoveryMessage(
            repoRoot,
            issueNumber,
            `Saved ${runtime.displayName} session ${sessionId} for issue #${issueNumber} is no longer available.`
          )
        );
      }

      runtimeInvocation = "resume";
    } else if (existingSessionState.runtimeType !== runtime.type) {
      const previousRuntime = getInteractiveRuntimeByType(
        existingSessionState.runtimeType
      );
      console.log(
        `Configured runtime "${runtime.displayName}" differs from the saved issue runtime "${previousRuntime.displayName}". Continuing on the saved branch with a new ${runtime.displayName} session.`
      );
      sessionId = undefined;
    }

    if (!localBranchExists(repoRoot, existingSessionState.branchName)) {
      throw new Error(
        buildIssueResumeRecoveryMessage(
          repoRoot,
          issueNumber,
          `Saved issue branch "${existingSessionState.branchName}" for issue #${issueNumber} no longer exists locally.`
        )
      );
    }

    switchToExistingIssueBranch(repoRoot, existingSessionState.branchName);
    const planComment = await resolvePlanCommentForRun();
    const workspace = createIssueWorkspace(
      repoRoot,
      issueNumber,
      issue,
      resolve(repoRoot, existingSessionState.issueDir)
    );
    writeIssueWorkspaceFiles(
      repoRoot,
      issueNumber,
      issue,
      planComment,
      existingSessionState.branchName,
      workspace,
      mode,
      repositoryConfig.buildCommand,
      runtime.type,
      runtimeInvocation,
      sessionId
    );

    return {
      issueNumber,
      issue,
      planComment,
      branchName: existingSessionState.branchName,
      baseBranch: existingSessionState.baseBranch ?? repositoryConfig.baseBranch,
      configuredBaseBranch:
        existingSessionState.configuredBaseBranch ?? repositoryConfig.baseBranch,
      overlapDecision: existingSessionState.overlapDecision,
      workspace,
      mode,
      runtime: {
        type: runtime.type,
        invocation: runtimeInvocation,
        sessionId,
        sessionStateFilePath,
      },
    };
  }

  const branchName = createIssueBranchName(issueNumber, issue.title);
  ensureBranchDoesNotExist(repoRoot, branchName);
  const planComment = await resolvePlanCommentForRun();
  const overlapDecision = await chooseIssueBranchBase({
    forge,
    mode,
    configuredBaseBranch: repositoryConfig.baseBranch,
    planComment,
  });
  syncIssueSelectedBaseBranch(repoRoot, overlapDecision, baseBranchPreflight);
  const workspace = createIssueWorkspace(repoRoot, issueNumber, issue);
  writeIssueWorkspaceFiles(
    repoRoot,
    issueNumber,
    issue,
    planComment,
    branchName,
    workspace,
    mode,
    repositoryConfig.buildCommand,
    runtime.type,
    "new"
  );

  console.log(`Creating branch ${branchName}...`);
  runInteractiveCommand(
    "git",
    ["checkout", "-b", branchName],
    `Failed to create branch "${branchName}".`,
    repoRoot
  );

  return {
    issueNumber,
    issue,
    planComment,
    branchName,
    baseBranch: overlapDecision.pullRequestBaseBranch,
    configuredBaseBranch: repositoryConfig.baseBranch,
    overlapDecision,
    workspace,
    mode,
    runtime: {
      type: runtime.type,
      invocation: "new",
      sessionStateFilePath,
    },
  };
}

export async function finalizeIssueRun(
  repoRoot: string,
  issueNumber: number,
  issue?: IssueDetails,
  runDir?: string
): Promise<FinalizeIssueRunResult> {
  const proposal = await resolveIssueCommitProposal({
    repoRoot,
    issueNumber,
    issue,
    mode: issue ? "address" : "finalize",
  });
  const reviewRunDir = runDir ?? createStandaloneIssueFinalizeRunDir(repoRoot, issueNumber);
  const finalized = await finalizeRuntimeChanges({
    repoRoot,
    runDir: reviewRunDir,
    commitPrompt: "Commit generated changes with this message? [Y/n/m]: ",
    promptForLine,
    hasChanges,
    commitGeneratedChanges,
    resolveInitialCommitMessage: async () => proposal.initialMessage,
    noChangesMessage: ISSUE_RUN_NO_CHANGES_MESSAGE,
  });
  if (!finalized.committed) {
    return {
      committed: false,
    };
  }

  return {
    committed: true,
    diff: proposal.diff,
    commitMessage: finalized.commitMessage,
  };
}

export function requireCodexForUnattendedIssueRuns(
  repositoryConfig: ReturnType<typeof getRepositoryConfig>
): void {
  if (repositoryConfig.ai.runtime.type !== "codex") {
    throw new Error(
      'Unattended issue runs currently require `ai.runtime.type` to be "codex" in .prs/config.json.'
    );
  }

  const runtime = getInteractiveRuntimeByType("codex");
  const availability = runtime.checkAvailability();
  if (!availability.available) {
    throw new Error(
      `Configured runtime "${runtime.displayName}" is unavailable because ${availability.reason}. Install the missing dependency before running unattended issue workflows.`
    );
  }
}

export async function runUnattendedIssueCommand(
  issueNumber: number,
  options: {
    onPrepared?(details: { branchName: string; runDir: string }): void;
  } = {}
): Promise<UnattendedIssueRunResult> {
  const repoRoot = getDefaultRepoRoot();
  const repositoryConfig = getRepositoryConfig(repoRoot);
  requireCodexForUnattendedIssueRuns(repositoryConfig);

  const forge = getRepositoryForge(repoRoot);
  if (!forge.isAuthenticated()) {
    throw new Error(
      "Unattended issue runs require authenticated GitHub access so prs can open the pull request automatically."
    );
  }

  const context = await prepareIssueRun(issueNumber, "unattended", {
    allowResume: true,
    runtimeType: "codex",
  });
  const runtime = getInteractiveRuntimeByType("codex");
  const runDir = toRepoRelativePath(repoRoot, context.workspace.runDir);
  options.onPrepared?.({
    branchName: context.branchName,
    runDir,
  });

  persistIssueSessionState(repoRoot, context, context.runtime.sessionId);
  console.log(
    context.runtime.invocation === "resume"
      ? `Resuming unattended Codex issue execution for #${issueNumber}...`
      : `Starting unattended Codex issue execution for #${issueNumber}...`
  );

  const runtimeLaunch = launchUnattendedRuntime("codex", repoRoot, context.workspace, {
    resumeSessionId: context.runtime.sessionId,
    outputLastMessageFilePath: resolve(
      context.workspace.runDir,
      "assistant-last-message.txt"
    ),
  });
  persistIssueSessionState(repoRoot, context, runtimeLaunch.sessionId);
  updateIssueWorkspaceMetadata(context.workspace, (currentMetadata) => ({
    ...currentMetadata,
    runtime: {
      ...((currentMetadata.runtime as Record<string, unknown> | undefined) ?? {}),
      type: runtime.type,
      displayName: runtime.displayName,
      command: runtime.metadata.command,
      invocation: runtimeLaunch.invocation,
      sessionId: runtimeLaunch.sessionId,
      sandboxMode: runtime.metadata.sandboxMode,
      approvalPolicy: runtime.metadata.approvalPolicy,
    },
  }));

  console.log("Verifying build...");
  verifyBuild(repoRoot, repositoryConfig.buildCommand, context.workspace.outputLogPath);

  let finalized: Awaited<ReturnType<typeof finalizeIssueRunUnattended>>;
  try {
    finalized = await finalizeIssueRunUnattended(
      repoRoot,
      context.issueNumber,
      context.workspace.runDir,
      context.issue
    );
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.message !== ISSUE_RUN_NO_CHANGES_MESSAGE) {
      throw error;
    }

    const outcome = createIssueNoChangesOutcome(context, runDir);
    recordIssueRunOutcome(context.workspace, outcome);
    console.log(ISSUE_RUN_NO_CHANGES_MESSAGE);
    printIssueRunOutcomeSummary(outcome);

    return {
      branchName: context.branchName,
      runDir,
      committed: false,
      pullRequest: outcome.pullRequest,
    };
  }
  const pullRequest = await generateIssuePullRequest({
    repoRoot,
    issueNumber: context.issueNumber,
    issue: context.issue,
    diff: finalized.diff,
    commitMessage: finalized.commitMessage,
    overlapDecision: context.overlapDecision,
    runDir: context.workspace.runDir,
  });

  console.log("Pushing branch and opening a pull request...");
  const createdPullRequest = await forge.createPullRequest({
    branchName: context.branchName,
    baseBranch: context.baseBranch,
    title: pullRequest.title,
    body: pullRequest.body,
    bodyFilePath: pullRequest.bodyFilePath,
    outputLogPath: context.workspace.outputLogPath,
  });
  updateIssueWorkspaceMetadata(context.workspace, (currentMetadata) => ({
    ...currentMetadata,
    pullRequest: {
      title: pullRequest.title,
      url: createdPullRequest.url,
    },
  }));
  const outcome: IssueRunOutcomeSummary = {
    issueNumber: context.issueNumber,
    branchName: context.branchName,
    baseBranch: context.baseBranch,
    runDir,
    committed: true,
    pullRequest: {
      status: "created",
      title: pullRequest.title,
      url: createdPullRequest.url,
    },
  };
  recordIssueRunOutcome(context.workspace, outcome);
  printIssueRunOutcomeSummary(outcome);

  return {
    branchName: context.branchName,
    runDir,
    committed: true,
    pullRequest: outcome.pullRequest,
  };
}
