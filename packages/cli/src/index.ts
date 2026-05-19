#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  analyzeFeatureBacklog,
  analyzeTestBacklog,
  buildPRAssistantSection,
  filterRepositoryPaths,
  formatPRReviewMarkdown as formatCorePRReviewMarkdown,
  generateCommitMessage,
  generateDiffSummary,
  generatePRReview,
  generateIssueResolutionPlan,
  generatePRAssistant,
  generatePRDescription,
  mergePRAssistantSection,
  StructuredGenerationError,
} from "@prs/core";
import {
  createProviderFromConfig,
  type AIProvider,
  readProviderEnvironment,
} from "@prs/providers";
import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import {
  GIT_AI_ALIAS_DEPRECATION_MESSAGE,
  ISSUE_PLAN_COMMENT_MARKER,
  IssueDraftSet,
  LEGACY_PRODUCT_SHORT_NAME,
  PRODUCT_SHORT_NAME,
} from "@prs/contracts";
import dotenv from "dotenv";
import {
  formatCommandForDisplay,
  loadResolvedRepositoryConfig,
} from "./config";
import { publishAuditArtifact } from "./audit-artifacts";
import { inspectManagedCodexSkills } from "./codex-skills";
import { buildDoneStateInstructions } from "./done-state";
import { listIssuesTool } from "./issue-list-tool";
import { readyIssueTool } from "./issue-ready-tool";
import {
  formatLaunchStageNotice,
  type LaunchStageNoticeId,
} from "./launch-stage";
import {
  parseCodexCommandArgs,
  type CodexCommandOptions,
} from "./commands/codex";
import {
  parsePrCommandArgs as parsePrCommandArgsImpl,
  type PrCommandOptions,
} from "./commands/pr";
import { parseAuditCommandArgs } from "./commands/audit";
import {
  parseFeatureBacklogCommandArgs,
  parseTestBacklogCommandArgs,
  type FeatureBacklogCommandOptions,
  type TestBacklogCommandOptions,
} from "./commands/backlog";
import {
  parseIssueCommandArgs,
  parseIssueNumber,
  type IssueCommandOptions,
  type IssueDraftCommandOptions,
} from "./commands/issue";
import {
  parseReviewCommandArgs,
  REVIEW_USAGE,
  type ReviewCommandOptions,
} from "./commands/review";
import { listPullRequestsTool } from "./pr-list-tool";
import { readyPullRequestTool } from "./pr-ready-tool";
import { parsePrsToolCommandArgs } from "./prs-tool-command";
import {
  createRepositoryForge,
  type CreatedIssueRecord,
  type IssueDetails,
  type IssuePlanComment,
  type OpenPullRequestChange,
  type RepositoryComment,
  type RepositoryForge,
} from "./forge";
import {
  printGeneratedTextPreview,
  openFileInEditor,
  reviewGeneratedText,
  type ReviewedGeneratedText,
  validateCommitMessage,
} from "./generated-text-review";
import {
  finalizeRuntimeChanges,
  generateDiffBasedCommitProposal,
} from "./runtime-change-review";
import { resolveRuntimeRepoRoot } from "./repo-root";
import {
  findTrackedRuntimeSessionById,
  getInteractiveRuntimeByType,
  isCodexSuperpowersAvailable,
  launchUnattendedRuntime,
  selectInteractiveRuntime,
  type InteractiveRuntimeType,
} from "./runtime";
import {
  createIssuePlanWorkspace,
  createIssueRefineWorkspace,
  formatRunTimestamp,
  getIssueBatchRunDir,
  getIssueBatchStateDir,
  getIssueBatchStateFilePath,
  type IssuePlanWorkspace,
  type IssueRefineSessionState,
  type IssueRefineWorkspace,
  getIssueSessionStateFilePath,
  getIssueStateDir,
  loadIssueRefineSessionState,
  resolveExistingIssueBatchStateFilePath,
  resolveExistingIssueSessionStateFilePath,
  toRepoRelativePath,
  writeIssueRefineSessionState,
} from "./run-artifacts";
import {
  logManagedCodexSkillsRefreshResult,
  parseSetupCommandArgs,
  refreshManagedCodexSkills,
  resolveCurrentCliFallbackCommand,
  runSetupCommand,
} from "./setup";
import {
  branchContainsCommit,
  ensureVerificationCommandAvailable,
  preflightIssueBaseBranch,
  preflightRemoteBranch,
} from "./workflow-preflights";
import { runPrFixCommentsCommand } from "./workflows/pr-fix-comments/run";
import { runPrFixFailingTestsCommand } from "./workflows/pr-fix-failing-tests/run";
import type { VerificationFailure } from "./workflows/pr-fix-failing-tests/types";
import {
  preparePullRequestReviewTool,
  runPrPrepareReviewCommand,
} from "./workflows/pr-prepare-review/run";
import { runPrResolveConflictsCommand } from "./workflows/pr-resolve-conflicts/run";
import { runPrFixTestsCommand } from "./workflows/pr-fix-tests/run";
import { pushReviewedPullRequestUpdates } from "./workflows/pull-request-reviewed-updates";

export { parseSetupCommandArgs };
export { parseAuditCommandArgs } from "./commands/audit";
export {
  parseFeatureBacklogCommandArgs,
  parseTestBacklogCommandArgs,
} from "./commands/backlog";
export { parseIssueCommandArgs } from "./commands/issue";
export { parseReviewCommandArgs } from "./commands/review";

type IssueWorkspace = {
  issueDir: string;
  issueFilePath: string;
  runDir: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
};

type IssueWorkspaceMode = "local" | "github-action" | "unattended";
type IssueDraftWorkspace = {
  runDir: string;
  draftFilePath: string;
  issueSetFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
  superpowersSpecFilePath: string;
  superpowersPlanFilePath: string;
};

type GeneratedIssueResolutionPlan = Awaited<
  ReturnType<typeof generateIssueResolutionPlan>
>;

type IssueRunContext = {
  issueNumber: number;
  issue: IssueDetails;
  planComment?: IssuePlanComment;
  branchName: string;
  baseBranch: string;
  configuredBaseBranch: string;
  overlapDecision?: IssueBranchBaseDecision;
  workspace: IssueWorkspace;
  mode: IssueWorkspaceMode;
  runtime: {
    type: InteractiveRuntimeType;
    invocation: "new" | "resume";
    sessionId?: string;
    sessionStateFilePath: string;
  };
};

type IssueBranchBaseDecision = {
  branchName: string;
  pullRequestBaseBranch: string;
  source: "configured-base" | "pull-request-head";
  reason: string;
  overlappingPullRequests: IssueOverlappingPullRequest[];
};

type IssueOverlappingPullRequest = {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  matchingFiles: string[];
};

type IssueSessionState = {
  issueNumber: number;
  runtimeType: InteractiveRuntimeType;
  branchName: string;
  baseBranch?: string;
  configuredBaseBranch?: string;
  overlapDecision?: IssueBranchBaseDecision;
  issueDir: string;
  runDir: string;
  promptFile: string;
  outputLog: string;
  sessionId?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  executionMode?: "interactive" | "unattended";
  createdAt: string;
  updatedAt: string;
};

type FinalizeIssueRunResult =
  | {
      committed: false;
    }
  | {
      committed: true;
      diff: string;
      commitMessage: ReviewedGeneratedText;
    };

type GeneratedIssuePullRequest = {
  title: string;
  body: string;
  titleFilePath?: string;
  bodyFilePath?: string;
};

type IssuePullRequestOutcome =
  | {
      status: "created";
      title: string;
      url?: string;
    }
  | {
      status: "manual";
      titleFilePath: string;
      bodyFilePath: string;
    }
  | {
      status: "skipped";
      reason: "commit-declined" | "no-changes" | "forge-disabled";
    };

type IssueRunOutcomeSummary = {
  issueNumber: number;
  branchName: string;
  baseBranch: string;
  runDir: string;
  committed: boolean;
  pullRequest: IssuePullRequestOutcome;
};

const PRS_MANAGED_ISSUE_MARKER = "<!-- prs:managed-issue -->";
const ISSUE_RUN_NO_CHANGES_MESSAGE =
  "The interactive runtime completed without producing any file changes to commit.";

type IssueBatchStatus = "pending" | "running" | "completed" | "failed";

type IssueBatchAttempt = {
  startedAt: string;
  updatedAt: string;
  status: IssueBatchStatus;
  worktreePath?: string;
  runDir?: string;
  branchName?: string;
  prUrl?: string;
  pullRequest?: IssuePullRequestOutcome;
  error?: string;
};

type IssueBatchIssueState = {
  issueNumber: number;
  status: IssueBatchStatus;
  worktreePath?: string;
  runDir?: string;
  branchName?: string;
  prUrl?: string;
  pullRequest?: IssuePullRequestOutcome;
  error?: string;
  attempts: IssueBatchAttempt[];
};

type IssueBatchState = {
  key: string;
  issueNumbers: number[];
  createdAt: string;
  updatedAt: string;
  latestRunDir: string;
  stoppedIssueNumber?: number;
  issues: IssueBatchIssueState[];
};

type IssueBatchWorkspace = {
  runDir: string;
  summaryFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
};

type UnattendedIssueRunResult = {
  branchName: string;
  runDir: string;
  committed: boolean;
  pullRequest: IssuePullRequestOutcome;
};

const TOP_LEVEL_HELP = [
  "prs",
  "",
  "GitHub-first AI workflows for pull request review, follow-up fixes, and backlog discovery.",
  "",
  "Start here:",
  "  prs review",
  "  prs tool pr fix-comments <pr-number> --json",
  "  prs tool pr fix-failing-tests <pr-number> --json",
  "  prs tool pr fix-tests <pr-number> --json",
  "  prs review tests [--top <count>]",
  "",
  "Advanced:",
  "  prs issue draft --draft-file <path>",
  "  prs issue refine <number>",
  "  prs issue plan <number> [--refresh]",
  "  prs issue <number> [--mode <interactive|unattended>]",
  "  prs issue <number> <number> [...number] [--mode unattended]",
  "  prs issue prepare <number> [--mode <local|github-action>]",
  "  prs issue finalize <number>",
  "",
  "Beta:",
  "  prs issue batch <number> <number> [...number] [--mode unattended]",
  "  prs pr resolve-conflicts <pr-number>",
  "  prs review features [repo-path]",
  "",
  "Legacy interactive launchers:",
  "  prs codex issue <number>",
  "  prs codex issue batch <number> <number> [...number] [--mode unattended]",
  "  prs codex pr prepare-review <pr-number>",
  "  prs codex pr resolve-conflicts <pr-number>",
  "  prs pr fix-comments <pr-number>",
  "  prs pr fix-failing-tests <pr-number>",
  "  prs pr fix-tests <pr-number>",
  "",
  "Supporting commands:",
  "  prs setup",
  "  prs setup --update-skills",
  "  prs update skills",
  "  prs tool issue list [--actionable] --json",
  "  prs tool issue ready <issue-number> [--all] --json",
  "  prs tool issue create (--draft-file <path>|--issue-set <path>) --json",
  "  prs tool pr list [--actionable] --json",
  "  prs tool pr ready <pr-number> [--all] --json",
  "  prs tool pr prepare-review <pr-number> --json",
  "  prs tool pr push-reviewed <pr-number> --json",
  "  prs tool pr fix-comments <pr-number> [--selection <value>] --json",
  "  prs tool pr fix-failing-tests <pr-number> --json",
  "  prs tool pr fix-tests <pr-number> [--selection <value>] --json",
  "  prs test-backlog [--top <count>]",
  "  prs feature-backlog [repo-path]",
  "  prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name> [--local-run <path>]",
  "  prs commit",
  "  prs diff",
  "",
  "GitHub-only by design: forge-backed issue and pull request workflows currently target GitHub repositories.",
].join("\n");

const UPDATE_USAGE = ["Usage:", "  prs update skills"].join("\n");

function getCliArgs(): string[] {
  return process.argv.slice(2).filter((arg) => arg !== "--");
}

function getInvokedCommandName(): string {
  const argvPath = process.argv[1];
  return argvPath ? basename(argvPath) : PRODUCT_SHORT_NAME;
}

function getDefaultRepoRoot(): string {
  return resolveRuntimeRepoRoot();
}

function warnIfManagedCodexSkillsAreStale(command: string): void {
  if (command === "setup" || command === "update") {
    return;
  }

  try {
    const staleSkills = inspectManagedCodexSkills(undefined, undefined, {
      cliFallbackCommand: resolveCurrentCliFallbackCommand(),
    }).filter((status) => status.status === "stale");

    if (staleSkills.length === 0) {
      return;
    }

    const names = staleSkills
      .slice(0, 3)
      .map((status) => status.skillName)
      .join(", ");
    const suffix = staleSkills.length > 3 ? `, and ${staleSkills.length - 3} more` : "";
    console.error(
      `prs Codex skills look stale (${names}${suffix}). Run \`prs update skills\` to refresh them.`
    );
  } catch {
    // Skill freshness should never block the requested command.
  }
}

function loadRepoEnv(repoRoot: string): void {
  dotenv.config({ path: resolve(repoRoot, ".env"), quiet: true });
}

function getRepositoryConfig(repoRoot = getDefaultRepoRoot()) {
  return loadResolvedRepositoryConfig(repoRoot);
}

function getRepositoryForge(repoRoot = getDefaultRepoRoot()): RepositoryForge {
  return createRepositoryForge(repoRoot, getRepositoryConfig(repoRoot));
}

function executeGitDiff(
  repoRoot: string,
  args: string[],
  commandDescription: string,
  missingRevisionMessage?: string
): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : undefined;
    const combinedMessage = [error instanceof Error ? error.message : "", stderr]
      .filter(Boolean)
      .join(" ");

    if (
      missingRevisionMessage &&
      (combinedMessage.includes("ambiguous argument 'HEAD'") ||
        combinedMessage.includes("bad revision 'HEAD'"))
    ) {
      throw new Error(missingRevisionMessage);
    }

    const detail = stderr ? ` ${stderr}` : "";
    throw new Error(
      `Failed to read ${commandDescription} git diff. Make sure git is installed and you are inside a git repository.${detail}`
    );
  }
}

function buildNameOnlyDiffArgs(args: string[]): string[] {
  return args[0] === "diff" ? [args[0], "--name-only", ...args.slice(1)] : args;
}

type ReadGitDiffOptions = {
  allowEmpty?: boolean;
  excludePaths?: string[];
  repoRoot?: string;
};

function readGitDiff(
  args: string[],
  emptyDiffMessage: string,
  commandDescription: string,
  missingRevisionMessage?: string,
  options: ReadGitDiffOptions = {}
): string {
  const repoRoot = options.repoRoot ?? getDefaultRepoRoot();
  const excludePaths = options.excludePaths ?? [];

  let effectiveArgs = args;
  if (excludePaths.length > 0) {
    const changedPaths = executeGitDiff(
      repoRoot,
      buildNameOnlyDiffArgs(args),
      commandDescription,
      missingRevisionMessage
    )
      .split(/\r?\n/)
      .map((filePath) => filePath.trim())
      .filter(Boolean);
    const includedPaths = filterRepositoryPaths(changedPaths, excludePaths);

    if (includedPaths.length === 0) {
      if (options.allowEmpty) {
        return "";
      }

      throw new Error(emptyDiffMessage);
    }

    effectiveArgs = [...args, "--", ...includedPaths];
  }

  const diff = executeGitDiff(
    repoRoot,
    effectiveArgs,
    commandDescription,
    missingRevisionMessage
  );

  if (!diff.trim()) {
    if (options.allowEmpty) {
      return "";
    }

    throw new Error(emptyDiffMessage);
  }

  return diff;
}

function readStagedDiff(): string {
  const repoRoot = getDefaultRepoRoot();
  return readGitDiff(
    ["diff", "--cached"],
    "No staged changes found. Stage changes before generating a commit message.",
    "staged",
    undefined,
    {
      excludePaths: getRepositoryConfig(repoRoot).aiContext.excludePaths,
      repoRoot,
    }
  );
}

function readHeadDiff(): string {
  const repoRoot = getDefaultRepoRoot();
  return readGitDiff(
    ["diff", "HEAD"],
    "No changes found in git diff HEAD. Make a change before generating a diff summary.",
    "HEAD",
    "git diff HEAD requires at least one commit. Create an initial commit before generating a diff summary.",
    {
      excludePaths: getRepositoryConfig(repoRoot).aiContext.excludePaths,
      repoRoot,
    }
  );
}

function readIncludedUntrackedFiles(repoRoot: string, excludePaths: string[]): string[] {
  const output = runCommand(
    "git",
    ["-C", repoRoot, "ls-files", "--others", "--exclude-standard"],
    "Failed to inspect untracked files."
  );
  const paths = output
    .split(/\r?\n/)
    .map((filePath) => filePath.trim())
    .filter(Boolean);

  return filterRepositoryPaths(paths, excludePaths);
}

function readUntrackedFileDiff(repoRoot: string, filePath: string): string {
  const args = ["-C", repoRoot, "diff", "--no-index", "--", "/dev/null", filePath];
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (result.error) {
    throw new Error(
      `Failed to read untracked file diff for ${filePath}. ${result.error.message}`
    );
  }

  if (result.status !== 0 && result.status !== 1) {
    const detail = stderr.trim() ? ` ${stderr.trim()}` : "";
    throw new Error(`Failed to read untracked file diff for ${filePath}.${detail}`);
  }

  return stdout;
}

function readUntrackedFileDiffs(repoRoot: string, paths: string[]): string {
  return paths
    .map((filePath) => readUntrackedFileDiff(repoRoot, filePath))
    .filter((diff) => diff.trim().length > 0)
    .join("\n");
}

function readIssueWorkflowDiff(repoRoot: string): string {
  const excludePaths = getRepositoryConfig(repoRoot).aiContext.excludePaths;
  const trackedDiff = readGitDiff(
    ["diff", "HEAD"],
    ISSUE_RUN_NO_CHANGES_MESSAGE,
    "HEAD",
    "git diff HEAD requires at least one commit. Create an initial commit before finalizing issue work.",
    {
      allowEmpty: true,
      excludePaths,
      repoRoot,
    }
  );
  const untrackedPaths = readIncludedUntrackedFiles(repoRoot, excludePaths);
  const untrackedDiff = readUntrackedFileDiffs(repoRoot, untrackedPaths);
  const combinedDiff = [trackedDiff, untrackedDiff]
    .filter((diff) => diff.trim().length > 0)
    .join("\n");

  if (!combinedDiff.trim()) {
    throw new Error(ISSUE_RUN_NO_CHANGES_MESSAGE);
  }

  return combinedDiff;
}

export function readReviewDiff(base?: string, head?: string): string {
  if (head && !base) {
    throw new Error(`--head requires --base. ${REVIEW_USAGE}`);
  }

  const repoRoot = getDefaultRepoRoot();
  const excludePaths = getRepositoryConfig(repoRoot).aiContext.excludePaths;

  if (!base) {
    return readGitDiff(
      ["diff", "--unified=3", "HEAD"],
      "No changes found in git diff HEAD. Make a change before generating a PR review.",
      "HEAD",
      "git diff HEAD requires at least one commit. Create an initial commit before generating a PR review.",
      {
        excludePaths,
        repoRoot,
      }
    );
  }

  const range = head ? `${base}...${head}` : `${base}...HEAD`;
  return readGitDiff(
    ["diff", "--unified=3", range],
    `No changes found in git diff ${range}. Make a change before generating a PR review.`,
    range,
    `git diff ${range} requires the referenced revisions to exist before generating a PR review.`,
    {
      excludePaths,
      repoRoot,
    }
  );
}

export function readReviewDiffForAutomation(base?: string, head?: string): string {
  if (head && !base) {
    throw new Error(`--head requires --base. ${REVIEW_USAGE}`);
  }

  const repoRoot = getDefaultRepoRoot();
  const excludePaths = getRepositoryConfig(repoRoot).aiContext.excludePaths;
  const range = base ? (head ? `${base}...${head}` : `${base}...HEAD`) : "HEAD";
  const args = base ? ["diff", "--unified=3", range] : ["diff", "--unified=3", "HEAD"];
  const emptyDiffMessage = base
    ? `No changes found in git diff ${range}. Make a change before generating a PR review.`
    : "No changes found in git diff HEAD. Make a change before generating a PR review.";
  const missingRevisionMessage = base
    ? `git diff ${range} requires the referenced revisions to exist before generating a PR review.`
    : "git diff HEAD requires at least one commit. Create an initial commit before generating a PR review.";

  return readGitDiff(args, emptyDiffMessage, range, missingRevisionMessage, {
    allowEmpty: true,
    excludePaths,
    repoRoot,
  });
}

function runCommand(
  command: string,
  args: string[],
  errorMessage: string
): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error: unknown) {
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : undefined;
    const detail = stderr ? ` ${stderr}` : "";
    throw new Error(`${errorMessage}${detail}`);
  }
}

function runInteractiveCommand(
  command: string,
  args: string[],
  errorMessage: string,
  cwd?: string
): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`${errorMessage} ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
}

function canRunCommand(command: string, args: string[] = ["--version"]): boolean {
  const result = spawnSync(command, args, {
    stdio: "ignore",
  });

  return !result.error && result.status === 0;
}

function hasChanges(repoRoot: string): boolean {
  return runCommand(
    "git",
    ["-C", repoRoot, "status", "--porcelain"],
    "Failed to inspect the working tree."
  ).length > 0;
}

function ensureCleanWorkingTree(repoRoot: string): void {
  if (hasChanges(repoRoot)) {
    throw new Error(
      "Working tree is not clean. Commit or stash existing changes before running prs issue workflows."
    );
  }
}

export function parsePrCommandArgs(args: string[]): PrCommandOptions {
  return parsePrCommandArgsImpl(args, parseIssueNumber);
}

export function parseCodexCommand(args: string[]): CodexCommandOptions {
  return parseCodexCommandArgs(args, parseIssueNumber);
}

export function parseUpdateCommandArgs(args: string[]): { action: "skills" } {
  const updateArgs = args[0] === "update" ? args.slice(1) : args;
  if (updateArgs.length === 1 && updateArgs[0] === "skills") {
    return { action: "skills" };
  }

  throw new Error(UPDATE_USAGE);
}

function resolveLaunchStageNoticeId(args: string[]): LaunchStageNoticeId | undefined {
  const command = args[0] ?? "commit";

  if (command === "feature-backlog") {
    return "feature-backlog";
  }

  if (command === "review" && args[1] === "features") {
    return "feature-backlog";
  }

  if (command === "issue") {
    const issueCommand = parseIssueCommandArgs(args);

    switch (issueCommand.action) {
      case "batch":
        return "issue-batch";
      case "draft":
        return "issue-draft";
      case "finalize":
        return "issue-finalize";
      case "plan":
        return "issue-plan";
      case "prepare":
        return "issue-prepare";
      case "run":
        return "issue-run";
    }
  }

  if (command === "pr") {
    const prCommand = parsePrCommandArgs(args);
    if (prCommand.action === "resolve-conflicts") {
      return "pr-resolve-conflicts";
    }
    return undefined;
  }

  if (command === "codex") {
    const codexCommand = parseCodexCommand(args);
    if (codexCommand.action === "issue") {
      return "issue-run";
    }
    if (codexCommand.action === "issue-batch") {
      return "issue-batch";
    }
    if (codexCommand.action === "pr-prepare-review") {
      return "pr-prepare-review";
    }
    if (codexCommand.action === "pr-resolve-conflicts") {
      return "pr-resolve-conflicts";
    }
  }

  return undefined;
}

function emitLaunchStageNotice(args: string[]): void {
  const noticeId = resolveLaunchStageNoticeId(args);
  if (!noticeId) {
    return;
  }

  process.stdout.write(`${formatLaunchStageNotice(noticeId)}\n`);
}

function stripIssuePlanCommentMarker(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => line.trim() !== ISSUE_PLAN_COMMENT_MARKER)
    .join("\n")
    .trim();
}

export function normalizeRepositoryPath(value: string): string | undefined {
  const trimmed = value.trim().replace(/^`|`$/g, "");
  if (!trimmed || trimmed.includes("\n") || /^[A-Z][\w\s]+$/.test(trimmed)) {
    return undefined;
  }

  return trimmed.replace(/^\.\//, "");
}

export function extractIssuePlanLikelyFiles(planBody: string | undefined): string[] {
  if (!planBody) {
    return [];
  }

  const lines = stripIssuePlanCommentMarker(planBody).split(/\r?\n/);
  const start = lines.findIndex((line) => /^###\s+Likely files\s*$/i.test(line.trim()));
  if (start === -1) {
    return [];
  }

  const files: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^###\s+/.test(line.trim())) {
      break;
    }

    const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }

    const normalized = normalizeRepositoryPath(match[1] ?? "");
    if (normalized) {
      files.push(normalized);
    }
  }

  return [...new Set(files)];
}

export function findOverlappingPullRequests(
  plannedFiles: string[],
  pullRequests: OpenPullRequestChange[]
): IssueOverlappingPullRequest[] {
  const planned = new Set(
    plannedFiles.map((file) => file.replace(/^\.\//, "")).filter(Boolean)
  );

  return pullRequests
    .map((pullRequest) => {
      const matchingFiles = pullRequest.files
        .map((file) => file.replace(/^\.\//, ""))
        .filter((file) => planned.has(file));

      return {
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.url,
        baseRefName: pullRequest.baseRefName,
        headRefName: pullRequest.headRefName,
        matchingFiles,
      };
    })
    .filter((pullRequest) => pullRequest.matchingFiles.length > 0);
}

export function recommendIssueBranchBase(input: {
  configuredBaseBranch: string;
  overlappingPullRequests: IssueOverlappingPullRequest[];
  plannedFiles: string[];
}): IssueBranchBaseDecision {
  const { configuredBaseBranch, overlappingPullRequests, plannedFiles } = input;
  const eligible = overlappingPullRequests.filter(
    (pullRequest) => pullRequest.baseRefName === configuredBaseBranch
  );

  if (eligible.length === 1) {
    const pullRequest = eligible[0] as IssueOverlappingPullRequest;
    return {
      branchName: pullRequest.headRefName,
      pullRequestBaseBranch: pullRequest.headRefName,
      source: "pull-request-head",
      reason: `PR #${pullRequest.number} is the only open PR changing planned files: ${pullRequest.matchingFiles.join(", ")}.`,
      overlappingPullRequests,
    };
  }

  const covering = eligible.filter(
    (pullRequest) => pullRequest.matchingFiles.length === plannedFiles.length
  );
  if (covering.length === 1) {
    const pullRequest = covering[0] as IssueOverlappingPullRequest;
    return {
      branchName: pullRequest.headRefName,
      pullRequestBaseBranch: pullRequest.headRefName,
      source: "pull-request-head",
      reason: `PR #${pullRequest.number} covers all planned files, so a stacked branch avoids starting from stale file content.`,
      overlappingPullRequests,
    };
  }

  return {
    branchName: configuredBaseBranch,
    pullRequestBaseBranch: configuredBaseBranch,
    source: "configured-base",
    reason:
      "Multiple or ambiguous open PR overlaps were found, so the configured base branch is safer than guessing a stacked dependency.",
    overlappingPullRequests,
  };
}

function formatSuperpowersPlanArtifactComment(planMarkdown: string): string {
  const trimmed = planMarkdown.trim();
  if (trimmed.startsWith(ISSUE_PLAN_COMMENT_MARKER)) {
    return `${trimmed}\n`;
  }

  return `${ISSUE_PLAN_COMMENT_MARKER}\n${trimmed}\n`;
}

function logSuperpowersPlanPublicationMessage(
  outputLogPath: string,
  message: string
): void {
  console.log(message);
  appendFileSync(outputLogPath, `${message}\n`, "utf8");
}

async function publishSuperpowersPlanArtifact(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  planFilePath: string;
  outputLogPath: string;
  existingPlanComment?: IssuePlanComment | null;
}): Promise<IssuePlanComment | undefined> {
  const planFile = toRepoRelativePath(options.repoRoot, options.planFilePath);

  if (!existsSync(options.planFilePath)) {
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Superpowers plan publication skipped because ${planFile} does not exist.`
    );
    return undefined;
  }

  const planMarkdown = readFileSync(options.planFilePath, "utf8").trim();
  if (!planMarkdown) {
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Superpowers plan publication skipped because ${planFile} is empty.`
    );
    return undefined;
  }

  const renderedPlan = formatSuperpowersPlanArtifactComment(planMarkdown);
  const existingPlanComment =
    options.existingPlanComment === undefined
      ? await options.forge.fetchIssuePlanComment(options.issueNumber)
      : options.existingPlanComment ?? undefined;

  if (existingPlanComment) {
    const comment = await options.forge.updateIssuePlanComment(
      existingPlanComment.id,
      renderedPlan
    );
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Updated issue resolution plan comment from Superpowers plan: ${comment.url}`
    );
    return comment;
  }

  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    renderedPlan
  );
  logSuperpowersPlanPublicationMessage(
    options.outputLogPath,
    `Created issue resolution plan comment from Superpowers plan: ${comment.url}`
  );
  return comment;
}

function formatNumberedMarkdownList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function renderIssueResolutionPlanComment(
  issueNumber: number,
  plan: GeneratedIssueResolutionPlan
): string {
  const lines = [
    ISSUE_PLAN_COMMENT_MARKER,
    "## Issue Resolution Plan",
    "",
    `Generated by \`prs issue plan ${issueNumber}\`. Edit this comment directly on GitHub to refine the plan. Later \`prs issue\` runs will use the latest version of this comment.`,
    "",
    "### Summary",
    plan.summary,
    "",
    "### Acceptance criteria",
    formatMarkdownList(plan.acceptanceCriteria),
    "",
    "### Likely files",
    formatMarkdownList(plan.likelyFiles),
    "",
    "### Implementation steps",
    formatNumberedMarkdownList(plan.implementationSteps),
    "",
    "### Test plan",
    formatMarkdownList(plan.testPlan),
  ];

  lines.push("", "### Risks", formatMarkdownList(plan.risks));
  lines.push("", "### Done definition", formatMarkdownList(plan.doneDefinition));

  if (plan.openQuestions && plan.openQuestions.length > 0) {
    lines.push("", "### Open questions", formatMarkdownList(plan.openQuestions));
  }

  lines.push("");
  return lines.join("\n");
}

function slugifyIssueTitle(title: string): string {
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

function createIssueBranchName(issueNumber: number, title: string): string {
  const slug = slugifyIssueTitle(title) || `issue-${issueNumber}`;
  return `feat/issue-${issueNumber}-${slug}`;
}

function createIssueDraftWorkspace(repoRoot: string): IssueDraftWorkspace {
  const timestamp = formatRunTimestamp();
  const issueDir = resolve(repoRoot, ".prs", "issues");
  const runDir = resolve(repoRoot, ".prs", "runs", `${timestamp}-issue-draft`);

  mkdirSync(issueDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    draftFilePath: resolve(issueDir, `issue-draft-${timestamp}.md`),
    issueSetFilePath: resolve(runDir, "issue-set.json"),
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    superpowersSpecFilePath: resolve(runDir, "superpowers-spec.md"),
    superpowersPlanFilePath: resolve(runDir, "superpowers-plan.md"),
  };
}

function buildIssueDraftRuntimePrompt(
  repoRoot: string,
  workspace: IssueDraftWorkspace,
  featureIdea: string,
  options: {
    useCodexSuperpowers: boolean;
  }
): string {
  const draftFile = toRepoRelativePath(repoRoot, workspace.draftFilePath);
  const issueSetFile = toRepoRelativePath(repoRoot, workspace.issueSetFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);
  const superpowersSpecFile = toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath);
  const superpowersPlanFile = toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath);

  if (options.useCodexSuperpowers) {
    return [
      "You are working in the current repository.",
      "",
      "The user wants to turn a rough idea into an implementation-ready GitHub issue draft.",
      "",
      "Rough idea:",
      featureIdea,
      "",
      `Write the final Markdown issue draft to \`${draftFile}\`.`,
      `If the work is better split into multiple independent implementation issues, write each issue draft as Markdown under \`${runDir}\` and write an issue-set manifest to \`${issueSetFile}\`.`,
      "The manifest lets prs create linked issues after review. Use local IDs in manifest relationships; prs will replace them with GitHub issue numbers after creation.",
      "If one issue is enough, write only the existing final Markdown draft path.",
      `Write the Superpowers spec artifact to \`${superpowersSpecFile}\`.`,
      `Write the Superpowers plan artifact to \`${superpowersPlanFile}\`.`,
      `Use \`${runDir}\` for run artifacts created by this workflow.`,
      "",
      "Instructions to the coding agent:",
      "- inspect the repository only as needed to understand the idea and scope the work",
      "- avoid asking questions that are already answerable from the codebase",
      "- ask the user targeted clarifying questions only when repository inspection does not answer an important implementation detail",
      "- use `superpowers:brainstorming` first for clarification and scope shaping",
      "- use `superpowers:writing-plans` discipline to make the final issue draft implementation-ready",
      "- override the normal Superpowers spec/plan continuation for this workflow",
      "- keep any intermediate Superpowers docs inside the provided `.prs/runs/...` directory",
      "- write any Superpowers brainstorming/spec artifact only to the provided spec path",
      "- write any Superpowers writing-plans artifact only to the provided plan path",
      "- do not create `docs/superpowers/specs/...` documents",
      "- do not create `docs/superpowers/plans/...` documents",
      "- write the completed draft to the provided draft path before exiting",
      "- write an implementation-ready Markdown issue draft with a top-level title heading and concrete sections such as summary, motivation, scope, requirements, and acceptance criteria when they add value",
      "- keep the draft grounded in actual repository structure, existing patterns, and likely touchpoints",
      "- do not create the GitHub issue directly",
      "- do not modify unrelated repository files",
      "- do not modify `.prs/` except for the provided draft file and local workflow artifacts",
      "",
      "When the draft is complete and saved, stop.",
    ].join("\n");
  }

  return [
    "You are working in the current repository.",
    "",
    "The user wants to turn a rough idea into an implementation-ready GitHub issue draft.",
    "",
    "Rough idea:",
    featureIdea,
    "",
    `Write the final Markdown issue draft to \`${draftFile}\`.`,
    `If the work is better split into multiple independent implementation issues, write each issue draft as Markdown under \`${runDir}\` and write an issue-set manifest to \`${issueSetFile}\`.`,
    "The manifest lets prs create linked issues after review. Use local IDs in manifest relationships; prs will replace them with GitHub issue numbers after creation.",
    "If one issue is enough, write only the existing final Markdown draft path.",
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to the coding agent:",
    "- inspect the repository only as needed to understand the idea and scope the work",
    "- ask the user targeted clarifying questions when repository inspection does not answer an important implementation detail",
    "- avoid asking questions that are already answerable from the codebase",
    "- own the discovery, questioning, and drafting flow end to end",
    "- keep the draft grounded in actual repository structure, existing patterns, and likely touchpoints",
    "- write an implementation-ready Markdown issue draft with a top-level title heading and concrete sections such as summary, motivation, scope, requirements, and acceptance criteria when they add value",
    "- write the completed draft to the provided draft path before exiting",
    "- do not create the GitHub issue directly",
    "- do not modify unrelated repository files",
    "- do not modify `.prs/` except for the provided draft file and local workflow artifacts",
    "",
    "When the draft is complete and saved, stop.",
  ].join("\n");
}

function writeIssueDraftWorkspaceFiles(
  repoRoot: string,
  featureIdea: string,
  workspace: IssueDraftWorkspace,
  runtimeType: InteractiveRuntimeType,
  options: {
    useCodexSuperpowers: boolean;
  }
): void {
  const createdAt = new Date().toISOString();
  const runtime = getInteractiveRuntimeByType(runtimeType);
  const prompt = buildIssueDraftRuntimePrompt(repoRoot, workspace, featureIdea, options);
  const superpowersMetadata = options.useCodexSuperpowers
    ? {
        enabled: true,
        specFile: toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath),
        planFile: toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath),
      }
    : {
        enabled: false,
      };

  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        flow: "issue-draft",
        featureIdea,
        draftFile: toRepoRelativePath(repoRoot, workspace.draftFilePath),
        issueSetFile: toRepoRelativePath(repoRoot, workspace.issueSetFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        runtime: {
          type: runtime.type,
          displayName: runtime.displayName,
          command: runtime.metadata.command,
        },
        superpowers: superpowersMetadata,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.outputLogPath,
    [
      "# prs issue draft run log",
      "",
      `Created: ${createdAt}`,
      `Runtime: ${runtime.displayName}`,
      `Draft file: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
      `Issue set file: ${toRepoRelativePath(repoRoot, workspace.issueSetFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      ...(options.useCodexSuperpowers
        ? [
            `Superpowers spec file: ${toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath)}`,
            `Superpowers plan file: ${toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath)}`,
          ]
        : []),
      "",
    ].join("\n"),
    "utf8"
  );
}

function resolveCallerInputPath(repoRoot: string, inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(repoRoot, inputPath);
}

function readCallerInputFile(repoRoot: string, inputPath: string, label: string): string {
  const resolvedPath = resolveCallerInputPath(repoRoot, inputPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`${label} does not exist: ${inputPath}`);
  }

  return readFileSync(resolvedPath, "utf8");
}

function buildCallerIssueDraftPrompt(input: {
  roughIdea: string;
  contextEntries: { source: string; content: string }[];
  draftContents?: string;
  issueSetFilePath?: string;
  superpowersArtifacts: { label: string; source: string; content: string }[];
}): string {
  return [
    "The active prs:create skill produced this issue draft in the current Codex context.",
    "",
    "Rough idea:",
    input.roughIdea || "(not provided)",
    "",
    "Caller-provided context:",
    ...(input.contextEntries.length > 0
      ? input.contextEntries.flatMap((entry, index) => [
          "",
          `Context ${index + 1} (${entry.source}):`,
          entry.content.trimEnd(),
        ])
      : ["(not provided)"]),
    "",
    ...(input.draftContents !== undefined
      ? ["Caller-produced issue draft:", input.draftContents.trimEnd()]
      : [
          "Caller-produced issue set:",
          input.issueSetFilePath ?? "(not provided)",
        ]),
    ...(input.superpowersArtifacts.length > 0
      ? input.superpowersArtifacts.flatMap((artifact) => [
          "",
          `${artifact.label} (${artifact.source}):`,
          artifact.content.trimEnd(),
        ])
      : []),
  ].join("\n");
}

function safeIssueSetDraftFileName(issueId: string, index: number): string {
  const slug =
    issueId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `issue-${index + 1}`;

  return `${String(index + 1).padStart(2, "0")}-${slug}.md`;
}

function ingestCallerIssueSet(
  repoRoot: string,
  sourceIssueSetFilePath: string,
  workspace: IssueDraftWorkspace
): void {
  const sourcePath = resolveCallerInputPath(repoRoot, sourceIssueSetFilePath);
  const rawManifest = readCallerInputFile(repoRoot, sourceIssueSetFilePath, "Issue set file");
  const parsedManifest = IssueDraftSet.parse(JSON.parse(rawManifest));
  if (parsedManifest.mode !== "multiple") {
    throw new Error("Caller issue set must use mode \"multiple\".");
  }

  const sourceDir = dirname(sourcePath);
  const ingestedIssues = parsedManifest.issues.map((issue, index) => {
    const sourceDraftPath = isAbsolute(issue.draftFile)
      ? issue.draftFile
      : resolve(sourceDir, issue.draftFile);
    if (!existsSync(sourceDraftPath)) {
      throw new Error(`Issue set draft file for "${issue.id}" does not exist: ${sourceDraftPath}.`);
    }

    const draftContents = readFileSync(sourceDraftPath, "utf8");
    parseIssueDraftDocument(draftContents);
    const targetPath = resolve(workspace.runDir, safeIssueSetDraftFileName(issue.id, index));
    writeFileSync(targetPath, `${draftContents.trim()}\n`, "utf8");

    return {
      ...issue,
      draftFile: toRepoRelativePath(repoRoot, targetPath),
    };
  });

  writeFileSync(
    workspace.issueSetFilePath,
    `${JSON.stringify(
      {
        version: 1,
        mode: "multiple",
        sourceIssueNumber: parsedManifest.sourceIssueNumber,
        linkingStrategy: parsedManifest.linkingStrategy,
        issues: ingestedIssues,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function writeCallerIssueDraftWorkspaceFiles(
  repoRoot: string,
  options: Extract<IssueDraftCommandOptions, { mode: "caller" }>,
  workspace: IssueDraftWorkspace
): void {
  const createdAt = new Date().toISOString();
  const draftContents = options.draftFilePath
    ? readCallerInputFile(repoRoot, options.draftFilePath, "Draft file").trim()
    : undefined;

  if (draftContents !== undefined) {
    if (!draftContents) {
      throw new Error(`Draft file is empty: ${options.draftFilePath}`);
    }
    parseIssueDraftDocument(draftContents);
    writeFileSync(workspace.draftFilePath, `${draftContents}\n`, "utf8");
  } else if (options.issueSetFilePath) {
    ingestCallerIssueSet(repoRoot, options.issueSetFilePath, workspace);
  }

  const roughIdea =
    options.roughIdeaFilePath !== undefined
      ? readCallerInputFile(repoRoot, options.roughIdeaFilePath, "Rough idea file").trim()
      : options.roughIdea?.trim() ?? "";
  const contextEntries = [
    ...options.contextValues.map((content, index) => ({
      source: `--context ${index + 1}`,
      content,
    })),
    ...options.contextFilePaths.map((filePath) => ({
      source: filePath,
      content: readCallerInputFile(repoRoot, filePath, "Context file"),
    })),
  ];
  const superpowersSpec = options.superpowersSpecFilePath
    ? readCallerInputFile(repoRoot, options.superpowersSpecFilePath, "Superpowers spec file")
    : undefined;
  const superpowersPlan = options.superpowersPlanFilePath
    ? readCallerInputFile(repoRoot, options.superpowersPlanFilePath, "Superpowers plan file")
    : undefined;
  const superpowersArtifacts = [
    ...(superpowersSpec
      ? [
          {
            label: "Superpowers spec artifact",
            source: options.superpowersSpecFilePath as string,
            content: superpowersSpec,
          },
        ]
      : []),
    ...(superpowersPlan
      ? [
          {
            label: "Superpowers plan artifact",
            source: options.superpowersPlanFilePath as string,
            content: superpowersPlan,
          },
        ]
      : []),
  ];
  const prompt = buildCallerIssueDraftPrompt({
    roughIdea,
    contextEntries,
    draftContents,
    issueSetFilePath: options.issueSetFilePath,
    superpowersArtifacts,
  });

  if (superpowersSpec !== undefined) {
    writeFileSync(workspace.superpowersSpecFilePath, `${superpowersSpec.trim()}\n`, "utf8");
  }
  if (superpowersPlan !== undefined) {
    writeFileSync(workspace.superpowersPlanFilePath, `${superpowersPlan.trim()}\n`, "utf8");
  }
  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        flow: "issue-draft",
        draftProducer: "caller",
        featureIdea: roughIdea,
        draftFile: toRepoRelativePath(repoRoot, workspace.draftFilePath),
        issueSetFile: toRepoRelativePath(repoRoot, workspace.issueSetFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        caller: {
          draftFile: options.draftFilePath,
          issueSetFile: options.issueSetFilePath,
          roughIdea,
          roughIdeaFile: options.roughIdeaFilePath,
          context: contextEntries,
          superpowersSpecFile: options.superpowersSpecFilePath,
          superpowersPlanFile: options.superpowersPlanFilePath,
        },
        superpowers: {
          enabled: superpowersArtifacts.length > 0,
          specFile:
            superpowersSpec === undefined
              ? undefined
              : toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath),
          planFile:
            superpowersPlan === undefined
              ? undefined
              : toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath),
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
      "# prs issue draft run log",
      "",
      "Draft producer: caller",
      `Created: ${createdAt}`,
      "Runtime: not launched",
      ...(options.draftFilePath ? [`Draft source: ${options.draftFilePath}`] : []),
      ...(options.issueSetFilePath ? [`Issue set source: ${options.issueSetFilePath}`] : []),
      `Draft file: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
      `Issue set file: ${toRepoRelativePath(repoRoot, workspace.issueSetFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      ...(superpowersSpec !== undefined
        ? [
            `Superpowers spec source: ${options.superpowersSpecFilePath}`,
            `Superpowers spec file: ${toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath)}`,
          ]
        : []),
      ...(superpowersPlan !== undefined
        ? [
            `Superpowers plan source: ${options.superpowersPlanFilePath}`,
            `Superpowers plan file: ${toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath)}`,
          ]
        : []),
      "",
      "The draft was produced by the active prs:create skill; no separate interactive AI runtime was opened.",
      "",
    ].join("\n"),
    "utf8"
  );
}

function isPrsManagedIssue(issue: IssueDetails): boolean {
  return issue.body.trimStart().startsWith(PRS_MANAGED_ISSUE_MARKER);
}

function formatIssueRefineComments(comments: RepositoryComment[]): string {
  if (comments.length === 0) {
    return "- (No issue comments.)";
  }

  return comments
    .map((comment) => {
      const author = comment.author.trim() || "unknown";
      const body = comment.body.trim() || "(No comment body provided.)";
      return `- @${author}: ${body}`;
    })
    .join("\n");
}

function buildIssueRefineRuntimePrompt(input: {
  repoRoot: string;
  workspace: IssueRefineWorkspace;
  issue: IssueDetails;
  issueNumber: number;
  requestedChanges?: string;
  comments: RepositoryComment[];
  useCodexSuperpowers: boolean;
}): string {
  const draftFile = toRepoRelativePath(input.repoRoot, input.workspace.draftFilePath);
  const issueSetFile = toRepoRelativePath(
    input.repoRoot,
    input.workspace.issueSetFilePath
  );
  const runDir = toRepoRelativePath(input.repoRoot, input.workspace.runDir);
  const superpowersSpecFile = toRepoRelativePath(
    input.repoRoot,
    input.workspace.superpowersSpecFilePath
  );
  const superpowersPlanFile = toRepoRelativePath(
    input.repoRoot,
    input.workspace.superpowersPlanFilePath
  );
  const requestedChangesSection = input.requestedChanges
    ? [
        "What changes should be made to the original requirements?",
        input.requestedChanges,
        "",
      ]
    : [];

  const superpowersArtifactInstructions = input.useCodexSuperpowers
    ? [
        `Write the Superpowers spec artifact to \`${superpowersSpecFile}\`.`,
        `Write the Superpowers plan artifact to \`${superpowersPlanFile}\`.`,
      ]
    : [];
  const superpowersAgentInstructions = input.useCodexSuperpowers
    ? [
        "- use `superpowers:brainstorming` first for clarification and scope shaping",
        "- use `superpowers:writing-plans` discipline to make the refined issue implementation-ready",
        "- override the normal Superpowers spec/plan continuation for this workflow",
        "- keep any intermediate Superpowers docs inside the provided `.prs/runs/...` directory",
        "- write any Superpowers brainstorming/spec artifact only to the provided spec path",
        "- write any Superpowers writing-plans artifact only to the provided plan path",
        "- do not create `docs/superpowers/specs/...` documents",
        "- do not create `docs/superpowers/plans/...` documents",
      ]
    : [];

  return [
    "You are working in the current repository.",
    "",
    `Refine GitHub issue #${input.issueNumber} into an implementation-ready specification.`,
    "",
    "The issue body remains the canonical source of truth for execution.",
    "Issue comments are refinement context only.",
    "",
    ...requestedChangesSection,
    "Current issue title:",
    input.issue.title,
    "",
    "Current issue body:",
    input.issue.body.trim() || "(No issue body provided.)",
    "",
    "Relevant issue comments:",
    formatIssueRefineComments(input.comments),
    "",
    `Write the refined markdown to \`${draftFile}\`.`,
    `If the work is better split into multiple independent implementation issues, write each issue draft as Markdown under \`${runDir}\` and write an issue-set manifest to \`${issueSetFile}\`.`,
    "The manifest lets prs create linked issues after review. Use local IDs in manifest relationships; prs will replace them with GitHub issue numbers after creation.",
    "If one issue is enough, write only the existing final Markdown draft path.",
    ...superpowersArtifactInstructions,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to the coding agent:",
    "- inspect the repository only as needed to refine the specification",
    "- keep the refined draft grounded in the current repository structure and existing patterns",
    "- treat issue comments as context, not as the canonical spec",
    ...superpowersAgentInstructions,
    "- write an implementation-ready Markdown issue draft with a top-level title heading and concrete sections when they add value",
    "- write the completed draft to the provided draft path before exiting",
    "- do not create or update GitHub issues directly",
    "- do not modify unrelated repository files",
    "- do not modify `.prs/` except for the provided draft file and local workflow artifacts",
    "",
    "When the refined specification is complete and saved, stop.",
  ].join("\n");
}

function appendIssueRefineLog(outputLogPath: string, message: string): void {
  appendFileSync(outputLogPath, `${message}\n`, "utf8");
}

function updateIssueRefineWorkspaceMetadata(
  workspace: IssueRefineWorkspace,
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

function writeIssueRefineWorkspaceFiles(
  repoRoot: string,
  workspace: IssueRefineWorkspace,
  runtimeType: InteractiveRuntimeType,
  issueNumber: number,
  issue: IssueDetails,
  comments: RepositoryComment[],
  requestedChanges: string | undefined,
  runtimeInvocation: "new" | "resume",
  useCodexSuperpowers: boolean,
  sessionId?: string,
  warnings: string[] = []
): void {
  const createdAt = new Date().toISOString();
  const runtime = getInteractiveRuntimeByType(runtimeType);
  const prompt = buildIssueRefineRuntimePrompt({
    repoRoot,
    workspace,
    issue,
    issueNumber,
    requestedChanges,
    comments,
    useCodexSuperpowers,
  });
  const superpowersMetadata = useCodexSuperpowers
    ? {
        enabled: true,
        specFile: toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath),
        planFile: toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath),
      }
    : {
        enabled: false,
      };

  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        flow: "issue-refine",
        issueNumber,
        issueTitle: issue.title,
        issueUrl: issue.url,
        sourceIssueManaged: isPrsManagedIssue(issue),
        ...(requestedChanges ? { requestedChanges } : {}),
        commentCount: comments.length,
        draftFile: toRepoRelativePath(repoRoot, workspace.draftFilePath),
        issueSetFile: toRepoRelativePath(repoRoot, workspace.issueSetFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        superpowers: superpowersMetadata,
        runtime: {
          type: runtime.type,
          displayName: runtime.displayName,
          command: runtime.metadata.command,
          invocation: runtimeInvocation,
          sessionId,
          sandboxMode: runtime.metadata.sandboxMode,
          approvalPolicy: runtime.metadata.approvalPolicy,
          warnings,
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
      "# prs issue refine run log",
      "",
      `Created: ${createdAt}`,
      `Issue number: ${issueNumber}`,
      `Issue URL: ${issue.url}`,
      `Draft file: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
      `Issue set file: ${toRepoRelativePath(repoRoot, workspace.issueSetFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      ...(useCodexSuperpowers
        ? [
            `Superpowers spec file: ${toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath)}`,
            `Superpowers plan file: ${toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath)}`,
          ]
        : []),
      `Runtime: ${runtime.displayName}`,
      `Runtime invocation: ${runtimeInvocation}`,
      ...(sessionId ? [`Runtime session: ${sessionId}`] : []),
      ...warnings.map((warning) => `Warning: ${warning}`),
      "",
    ].join("\n"),
    "utf8"
  );
}

function createIssueRefineSessionState(
  repoRoot: string,
  issueNumber: number,
  runtimeType: InteractiveRuntimeType,
  workspace: IssueRefineWorkspace,
  sessionId?: string,
  completion?:
    | {
        mode: "updated-existing" | "created-linked";
        issueNumber: number;
        issueUrl: string;
      }
    | {
        mode: "created-linked";
        issues: Array<{ issueNumber: number; issueUrl: string }>;
      }
    | {
        mode: "kept-on-disk";
      }
): IssueRefineSessionState {
  const previousState = loadIssueRefineSessionState(repoRoot, issueNumber);
  const createdAt =
    previousState && previousState.runDir === workspace.runDir
      ? previousState.createdAt
      : new Date().toISOString();

  return {
    issueNumber,
    runtimeType,
    runDir: workspace.runDir,
    promptFile: workspace.promptFilePath,
    outputLog: workspace.outputLogPath,
    latestDraftFile: workspace.draftFilePath,
    ...(sessionId ? { sessionId } : {}),
    ...(completion?.mode === "kept-on-disk"
      ? {
          completionMode: "kept-on-disk" as const,
        }
      : completion
        ? {
            completionMode: completion.mode,
            ...("issues" in completion
              ? {
                  completedIssues: completion.issues,
                }
              : {
                  completedIssueNumber: completion.issueNumber,
                  completedIssueUrl: completion.issueUrl,
                }),
          }
        : {}),
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function persistIssueRefineSessionState(
  repoRoot: string,
  issueNumber: number,
  runtimeType: InteractiveRuntimeType,
  workspace: IssueRefineWorkspace,
  sessionId?: string,
  completion?:
    | {
        mode: "updated-existing" | "created-linked";
        issueNumber: number;
        issueUrl: string;
      }
    | {
        mode: "created-linked";
        issues: Array<{ issueNumber: number; issueUrl: string }>;
      }
    | {
        mode: "kept-on-disk";
      }
): void {
  writeIssueRefineSessionState(
    repoRoot,
    createIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtimeType,
      workspace,
      sessionId,
      completion
    )
  );
}

function createIssueRefineWorkspaceFromState(
  state: Pick<
    IssueRefineSessionState,
    "runDir" | "promptFile" | "outputLog" | "latestDraftFile"
  >
): IssueRefineWorkspace {
  return {
    runDir: state.runDir,
    draftFilePath: state.latestDraftFile,
    issueSetFilePath: resolve(state.runDir, "issue-set.json"),
    promptFilePath: state.promptFile,
    metadataFilePath: resolve(state.runDir, "metadata.json"),
    outputLogPath: state.outputLog,
    superpowersSpecFilePath: resolve(state.runDir, "superpowers-spec.md"),
    superpowersPlanFilePath: resolve(state.runDir, "superpowers-plan.md"),
  };
}

function buildIssueRefineStaleSessionWarning(
  issueNumber: number,
  runtimeType: InteractiveRuntimeType,
  sessionId: string
): string {
  return `Saved ${
    getInteractiveRuntimeByType(runtimeType).displayName
  } refine session ${sessionId} for issue #${issueNumber} is no longer available. Starting a fresh refinement session.`;
}

function buildIssueRefineRuntimeMismatchWarning(
  savedRuntimeType: InteractiveRuntimeType,
  currentRuntimeType: InteractiveRuntimeType
): string {
  return `The saved issue-refine session used ${
    getInteractiveRuntimeByType(savedRuntimeType).displayName
  }, but the configured runtime is ${
    getInteractiveRuntimeByType(currentRuntimeType).displayName
  }. Starting a fresh refinement session.`;
}

function buildIssueRefineMissingWorkspaceWarning(issueNumber: number): string {
  return `Saved issue-refine workspace artifacts for issue #${issueNumber} are missing. Starting a fresh refinement session.`;
}

function ensurePrsManagedIssueBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith(PRS_MANAGED_ISSUE_MARKER)) {
    return trimmed;
  }

  return `${PRS_MANAGED_ISSUE_MARKER}\n\n${trimmed}`;
}

function buildLinkedPrsManagedIssueBody(
  sourceIssueNumber: number,
  body: string
): string {
  return [
    PRS_MANAGED_ISSUE_MARKER,
    "",
    `Refined from source issue #${sourceIssueNumber}.`,
    "",
    body.trim(),
  ].join("\n");
}

function getPrsLinkedSourceIssueNumber(issue: IssueDetails): number | undefined {
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

function parseCreatedIssueUrl(issueUrl: string): { issueNumber: number; issueUrl: string } {
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

function loadIssueSessionState(
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

function writeIssueSessionState(
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

function buildIssueResumeRecoveryMessage(
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

function createIssueWorkspace(
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

function createIssueBatchKey(issueNumbers: number[]): string {
  return `issues-${issueNumbers.join("-")}`;
}

function createIssueBatchWorkspace(
  repoRoot: string,
  issueNumbers: number[]
): IssueBatchWorkspace {
  const runDir = getIssueBatchRunDir(repoRoot, issueNumbers);
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    summaryFilePath: resolve(runDir, "summary.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
  };
}

function createInitialIssueBatchState(
  issueNumbers: number[],
  workspace: IssueBatchWorkspace
): IssueBatchState {
  const now = new Date().toISOString();

  return {
    key: createIssueBatchKey(issueNumbers),
    issueNumbers,
    createdAt: now,
    updatedAt: now,
    latestRunDir: workspace.runDir,
    issues: issueNumbers.map((issueNumber) => ({
      issueNumber,
      status: "pending",
      attempts: [],
    })),
  };
}

function loadIssueBatchState(
  repoRoot: string,
  issueNumbers: number[]
): IssueBatchState | undefined {
  const stateFilePath = resolveExistingIssueBatchStateFilePath(repoRoot, issueNumbers);
  if (!existsSync(stateFilePath)) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as Partial<IssueBatchState>;
  if (
    parsed.key !== createIssueBatchKey(issueNumbers) ||
    !Array.isArray(parsed.issueNumbers) ||
    parsed.issueNumbers.length !== issueNumbers.length ||
    parsed.issueNumbers.some((issueNumber, index) => issueNumber !== issueNumbers[index]) ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    typeof parsed.latestRunDir !== "string" ||
    !Array.isArray(parsed.issues)
  ) {
    throw new Error(
      `Issue batch state at ${toRepoRelativePath(repoRoot, stateFilePath)} is malformed. Remove it and rerun the batch to start fresh.`
    );
  }

  return parsed as IssueBatchState;
}

function writeIssueBatchState(
  repoRoot: string,
  issueNumbers: number[],
  state: IssueBatchState
): void {
  mkdirSync(getIssueBatchStateDir(repoRoot), { recursive: true });
  writeFileSync(
    getIssueBatchStateFilePath(repoRoot, issueNumbers),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

function appendIssueBatchLog(workspace: IssueBatchWorkspace, message: string): void {
  appendFileSync(workspace.outputLogPath, `${message}\n`, "utf8");
}

function formatIssueBatchSummary(
  repoRoot: string,
  state: IssueBatchState,
  workspace: IssueBatchWorkspace
): string {
  const lines: string[] = [
    "# Issue Batch Summary",
    "",
    `Batch key: ${state.key}`,
    `Issues: ${state.issueNumbers.join(", ")}`,
    `Created: ${state.createdAt}`,
    `Updated: ${state.updatedAt}`,
    `Batch run directory: ${toRepoRelativePath(repoRoot, workspace.runDir)}`,
  ];

  if (state.stoppedIssueNumber !== undefined) {
    lines.push(`Stopped at issue: #${state.stoppedIssueNumber}`);
  }

  lines.push("", "## Issue status", "");

  for (const issueState of state.issues) {
    const pullRequestSummary =
      issueState.pullRequest?.status === "created" && issueState.pullRequest.url
        ? `PR ${issueState.pullRequest.url}`
        : issueState.pullRequest?.status === "skipped"
          ? `PR skipped (${issueState.pullRequest.reason})`
          : issueState.prUrl
            ? `PR ${issueState.prUrl}`
            : undefined;
    const details = [
      `#${issueState.issueNumber}`,
      issueState.status,
      issueState.branchName ? `branch ${issueState.branchName}` : undefined,
      issueState.runDir ? `run ${issueState.runDir}` : undefined,
      pullRequestSummary,
    ]
      .filter(Boolean)
      .join(" | ");
    lines.push(`- ${details}`);

    if (issueState.error) {
      lines.push(`  Error: ${issueState.error}`);
    }

    if (issueState.attempts.length > 0) {
      const latestAttempt = issueState.attempts.at(-1);
      if (latestAttempt) {
        lines.push(
          `  Latest attempt: ${latestAttempt.status} at ${latestAttempt.updatedAt}`
        );
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function writeIssueBatchArtifacts(
  repoRoot: string,
  state: IssueBatchState,
  workspace: IssueBatchWorkspace
): void {
  writeFileSync(
    workspace.summaryFilePath,
    formatIssueBatchSummary(repoRoot, state, workspace),
    "utf8"
  );
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        key: state.key,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        issueNumbers: state.issueNumbers,
        latestRunDir: toRepoRelativePath(repoRoot, workspace.runDir),
        stoppedIssueNumber: state.stoppedIssueNumber,
        issues: state.issues,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function updateIssueBatchState(
  repoRoot: string,
  issueNumbers: number[],
  state: IssueBatchState,
  workspace: IssueBatchWorkspace,
  updater: (currentState: IssueBatchState) => IssueBatchState
): IssueBatchState {
  const nextState = {
    ...updater(state),
    updatedAt: new Date().toISOString(),
    latestRunDir: toRepoRelativePath(repoRoot, workspace.runDir),
  };
  writeIssueBatchState(repoRoot, issueNumbers, nextState);
  writeIssueBatchArtifacts(repoRoot, nextState, workspace);
  return nextState;
}

function formatIssueSnapshot(
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

function localBranchExists(repoRoot: string, branchName: string): boolean {
  const result = spawnSync(
    "git",
    ["-C", repoRoot, "rev-parse", "--verify", branchName],
    {
      stdio: "ignore",
    }
  );

  return !result.error && result.status === 0;
}

function ensureBranchDoesNotExist(repoRoot: string, branchName: string): void {
  if (localBranchExists(repoRoot, branchName)) {
    throw new Error(`Branch "${branchName}" already exists.`);
  }
}

function switchToExistingIssueBranch(repoRoot: string, branchName: string): void {
  console.log(`Switching to existing issue branch ${branchName}...`);
  runInteractiveCommand(
    "git",
    ["checkout", branchName],
    `Failed to switch to existing issue branch "${branchName}".`,
    repoRoot
  );
}

function syncIssueBaseBranch(
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

function formatIssueOverlapSummary(
  overlappingPullRequests: IssueOverlappingPullRequest[]
): string {
  return overlappingPullRequests
    .map(
      (pullRequest) =>
        `#${pullRequest.number} ${pullRequest.title} (${pullRequest.matchingFiles.join(", ")})`
    )
    .join("; ");
}

function formatIssueOverlapNotice(decision: IssueBranchBaseDecision): string {
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

function createConfiguredIssueBaseDecision(
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

async function promptForIssueBranchBaseDecision(input: {
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

async function chooseIssueBranchBase(input: {
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

function syncIssueSelectedBaseBranch(
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

function updateIssueWorkspaceMetadata(
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

function recordIssueRunOutcome(
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

function createIssueSessionState(
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

function persistIssueSessionState(
  repoRoot: string,
  context: IssueRunContext,
  sessionId?: string
): void {
  writeIssueSessionState(repoRoot, createIssueSessionState(repoRoot, context, sessionId));
}

function buildRuntimePrompt(
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

function writeIssueWorkspaceFiles(
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

function writeGitHubOutput(name: string, value: string): void {
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

function emitIssuePrepareOutputs(repoRoot: string, context: IssueRunContext): void {
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
  command: string,
  args: string[],
  errorMessage: string,
  outputLogPath: string,
  cwd?: string
): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  appendRunLog(outputLogPath, command, args, stdout, stderr);

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
}

function verifyBuild(repoRoot: string, buildCommand: string[], outputLogPath: string): void {
  ensureVerificationCommandAvailable(repoRoot, buildCommand, "prs");

  runTrackedCommand(
    buildCommand[0],
    buildCommand.slice(1),
    "Build failed. Changes were not committed.",
    outputLogPath,
    repoRoot
  );
}

function captureVerificationFailure(
  repoRoot: string,
  buildCommand: string[]
): VerificationFailure | undefined {
  const result = spawnSync(buildCommand[0], buildCommand.slice(1), {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (stdout) {
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
  }

  if (!result.error && result.status === 0) {
    return undefined;
  }

  return {
    command: buildCommand,
    status: result.status ?? null,
    stdout,
    stderr,
    error: result.error?.message,
  };
}

function commitGeneratedChanges(
  repoRoot: string,
  commitMessage: ReviewedGeneratedText
): void {
  if (!hasChanges(repoRoot)) {
    throw new Error(
      "The interactive runtime completed without producing any file changes to commit."
    );
  }

  runInteractiveCommand("git", ["add", "."], "Failed to stage the generated changes.", repoRoot);
  runInteractiveCommand(
    "git",
    ["commit", "-F", commitMessage.filePath],
    "Failed to create the generated commit.",
    repoRoot
  );
}

function printManualPrInstructions(
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

function printIssueRunOutcomeSummary(outcome: IssueRunOutcomeSummary): void {
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

function formatCommitMessage(title: string, body?: string): string {
  return body ? `${title}\n\n${body}\n` : `${title}\n`;
}

function formatMarkdownList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function parseIssueDraftDocument(content: string): { title: string; body: string } {
  const lines = content.split(/\r?\n/);
  const titleLineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (titleLineIndex === -1 || !lines[titleLineIndex].startsWith("# ")) {
    throw new Error(
      "Issue draft must start with a top-level markdown heading like `# Issue title`."
    );
  }

  const title = lines[titleLineIndex].slice(2).trim();
  const body = lines.slice(titleLineIndex + 1).join("\n").trim();

  if (!title) {
    throw new Error("Issue draft title cannot be empty.");
  }

  if (!body) {
    throw new Error("Issue draft body cannot be empty.");
  }

  return {
    title,
    body,
  };
}

type ParsedIssueDraftSetIssue = {
  id: string;
  draftFilePath: string;
  title: string;
  body: string;
  dependsOn: string[];
  blocks: string[];
  related: string[];
};

type ParsedIssueDraftSet = {
  mode: "multiple";
  sourceIssueNumber?: number;
  linkingStrategy?: string;
  issues: ParsedIssueDraftSetIssue[];
};

function isPathWithinDirectory(parentDir: string, candidatePath: string): boolean {
  const relativePath = relative(parentDir, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function loadIssueDraftSet(input: {
  repoRoot: string;
  runDir: string;
  issueSetFilePath: string;
  fallbackSourceIssueNumber?: number;
}): ParsedIssueDraftSet {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(input.issueSetFilePath, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Issue set manifest at ${toRepoRelativePath(
        input.repoRoot,
        input.issueSetFilePath
      )} is invalid JSON. ${message}`
    );
  }

  const parsedManifest = IssueDraftSet.parse(manifest);
  if (parsedManifest.mode !== "multiple") {
    throw new Error("Issue set manifest must use mode \"multiple\".");
  }

  return {
    mode: "multiple",
    sourceIssueNumber:
      parsedManifest.sourceIssueNumber ?? input.fallbackSourceIssueNumber,
    linkingStrategy: parsedManifest.linkingStrategy,
    issues: parsedManifest.issues.map((issue) => {
      const draftFilePath = resolve(input.repoRoot, issue.draftFile);
      if (!isPathWithinDirectory(input.runDir, draftFilePath)) {
        throw new Error(
          `Issue set draft file for "${issue.id}" must stay inside ${toRepoRelativePath(
            input.repoRoot,
            input.runDir
          )}.`
        );
      }

      if (!existsSync(draftFilePath)) {
        throw new Error(
          `Issue set draft file for "${issue.id}" does not exist: ${toRepoRelativePath(
            input.repoRoot,
            draftFilePath
          )}.`
        );
      }

      const parsedDraft = parseIssueDraftDocument(
        readFileSync(draftFilePath, "utf8")
      );

      return {
        id: issue.id,
        draftFilePath,
        title: parsedDraft.title,
        body: parsedDraft.body,
        dependsOn: issue.dependsOn,
        blocks: issue.blocks,
        related: issue.related,
      };
    }),
  };
}

type IssueSetCreatedIssue = {
  id: string;
  number: number;
  url: string;
};

type ToolCreatedIssueRecord = CreatedIssueRecord & {
  id?: string;
};

function formatIssueNumberList(
  issueSet: ParsedIssueDraftSet,
  createdIssuesById: Map<string, IssueSetCreatedIssue>,
  ids: string[]
): string | undefined {
  const refs = issueSet.issues
    .filter((issue) => ids.includes(issue.id))
    .map((issue) => createdIssuesById.get(issue.id))
    .filter((issue): issue is IssueSetCreatedIssue => issue !== undefined)
    .map((issue) => `#${issue.number}`);

  return refs.length > 0 ? refs.join(", ") : undefined;
}

function replaceLinkedIssuesSection(body: string, section: string): string {
  const trimmedBody = body.trim();
  const linkedIssuesHeading = /^## Linked Issues\s*$/m;
  const match = linkedIssuesHeading.exec(trimmedBody);
  if (!match || match.index === undefined) {
    return `${trimmedBody}\n\n${section}`;
  }

  const before = trimmedBody.slice(0, match.index).trimEnd();
  const afterStart = match.index + match[0].length;
  const nextHeadingMatch = /\n##\s+/.exec(trimmedBody.slice(afterStart));
  const after =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? trimmedBody.slice(afterStart + nextHeadingMatch.index).trimStart()
      : "";

  return [before, section, after].filter((part) => part.length > 0).join("\n\n");
}

function buildLinkedIssueBody(
  issueSet: ParsedIssueDraftSet,
  issue: ParsedIssueDraftSetIssue,
  createdIssuesById: Map<string, IssueSetCreatedIssue>,
  options: {
    forcePrsManaged: boolean;
  }
): string {
  const lines = ["## Linked Issues", ""];

  if (issueSet.linkingStrategy) {
    lines.push(`- Part of: ${issueSet.linkingStrategy}`);
  }

  const dependsOn = formatIssueNumberList(issueSet, createdIssuesById, issue.dependsOn);
  if (dependsOn) {
    lines.push(`- Depends on: ${dependsOn}`);
  }

  const blocks = formatIssueNumberList(issueSet, createdIssuesById, issue.blocks);
  if (blocks) {
    lines.push(`- Blocks: ${blocks}`);
  }

  const related = formatIssueNumberList(issueSet, createdIssuesById, issue.related);
  if (related) {
    lines.push(`- Related: ${related}`);
  }

  if (issueSet.sourceIssueNumber !== undefined) {
    lines.push(`- Source issue: #${issueSet.sourceIssueNumber}`);
  }

  const linkedBody = replaceLinkedIssuesSection(issue.body, lines.join("\n"));
  return options.forcePrsManaged ? ensurePrsManagedIssueBody(linkedBody) : linkedBody;
}

function formatIssueDraftSetPreview(
  repoRoot: string,
  issueSet: ParsedIssueDraftSet
): string {
  return issueSet.issues
    .map(
      (issue, index) =>
        `${index + 1}. ${issue.title}\n   Draft: ${toRepoRelativePath(
          repoRoot,
          issue.draftFilePath
        )}`
    )
    .join("\n");
}

async function reviewIssueDraftSet(input: {
  repoRoot: string;
  issueSet: ParsedIssueDraftSet;
  prompt: string;
  promptForLine(prompt: string): Promise<string>;
  reload(): ParsedIssueDraftSet;
}): Promise<ParsedIssueDraftSet | null> {
  let currentSet = input.issueSet;

  while (true) {
    printGeneratedTextPreview(
      "Generated issue draft set",
      formatIssueDraftSetPreview(input.repoRoot, currentSet)
    );

    const action = (await input.promptForLine(input.prompt)).trim().toLowerCase();
    if (!action || action === "y" || action === "yes") {
      return currentSet;
    }

    if (action === "n" || action === "no") {
      return null;
    }

    if (
      action === "m" ||
      action === "modify" ||
      action === "e" ||
      action === "edit"
    ) {
      for (const issue of currentSet.issues) {
        openFileInEditor(issue.draftFilePath, `issue draft ${issue.id}`);
      }
      currentSet = input.reload();
      continue;
    }

    console.log("Choose yes, no, or modify.");
  }
}

async function createLinkedIssueDraftSet(input: {
  issueSet: ParsedIssueDraftSet;
  forge: RepositoryForge;
  forcePrsManaged: boolean;
}): Promise<IssueSetCreatedIssue[]> {
  const createdIssues: IssueSetCreatedIssue[] = [];
  for (const issue of input.issueSet.issues) {
    const initialBody = input.forcePrsManaged
      ? ensurePrsManagedIssueBody(issue.body)
      : issue.body;
    const createdIssue = parseCreatedIssueUrl(
      await input.forge.createDraftIssue(issue.title, initialBody)
    );
    createdIssues.push({
      id: issue.id,
      number: createdIssue.issueNumber,
      url: createdIssue.issueUrl,
    });
  }

  const createdIssuesById = new Map(
    createdIssues.map((issue) => [issue.id, issue] as const)
  );
  for (const issue of input.issueSet.issues) {
    const createdIssue = createdIssuesById.get(issue.id);
    if (!createdIssue) {
      continue;
    }

    const linkedBody = buildLinkedIssueBody(
      input.issueSet,
      issue,
      createdIssuesById,
      {
        forcePrsManaged: input.forcePrsManaged,
      }
    );
    const updatedIssue = await input.forge.updateIssue(
      createdIssue.number,
      issue.title,
      linkedBody
    );
    createdIssue.url = updatedIssue.url;
  }

  return createdIssues;
}

async function createIssueDraftSetWithRecords(input: {
  issueSet: ParsedIssueDraftSet;
  forge: RepositoryForge;
  labels: string[];
  forcePrsManaged: boolean;
}): Promise<ToolCreatedIssueRecord[]> {
  const createdIssues: ToolCreatedIssueRecord[] = [];

  for (const issue of input.issueSet.issues) {
    const initialBody = input.forcePrsManaged
      ? ensurePrsManagedIssueBody(issue.body)
      : issue.body;
    const createdIssue = await input.forge.createOrReuseIssue(
      issue.title,
      initialBody,
      input.labels
    );
    createdIssues.push({
      ...createdIssue,
      id: issue.id,
    });
  }

  const createdIssuesById = new Map<string, IssueSetCreatedIssue>();
  for (const issue of createdIssues) {
    if (!issue.id) {
      continue;
    }

    createdIssuesById.set(issue.id, {
      id: issue.id,
      number: issue.number,
      url: issue.url,
    });
  }

  for (const issue of input.issueSet.issues) {
    const createdIssue = createdIssues.find((entry) => entry.id === issue.id);
    if (!createdIssue || createdIssue.status !== "created") {
      continue;
    }

    const linkedBody = buildLinkedIssueBody(
      input.issueSet,
      issue,
      createdIssuesById,
      {
        forcePrsManaged: input.forcePrsManaged,
      }
    );
    const updatedIssue = await input.forge.updateIssue(
      createdIssue.number,
      issue.title,
      linkedBody
    );
    createdIssue.url = updatedIssue.url;
  }

  return createdIssues;
}

function createAuditPublicationHints(input: {
  issueNumbers: number[];
  planFilePath?: string;
}): Array<{ issueNumber: number; file: string; section: string }> {
  if (!input.planFilePath || input.issueNumbers.length === 0) {
    return [];
  }

  return [
    {
      issueNumber: input.issueNumbers[0],
      file: input.planFilePath,
      section: "plan",
    },
  ];
}

async function promptForLine(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function promptForRequiredLine(prompt: string): Promise<string> {
  while (true) {
    const answer = (await promptForLine(prompt)).trim();
    if (answer) {
      return answer;
    }

    console.log("A response is required.");
  }
}

async function promptForYesNoDefaultNo(prompt: string): Promise<boolean> {
  while (true) {
    const answer = (await promptForLine(prompt)).trim().toLowerCase();

    if (!answer || answer === "n" || answer === "no") {
      return false;
    }

    if (answer === "y" || answer === "yes") {
      return true;
    }

    console.log("Choose yes or no.");
  }
}

async function promptForYesNoDefaultYes(prompt: string): Promise<boolean> {
  while (true) {
    const answer = (await promptForLine(prompt)).trim().toLowerCase();

    if (!answer || answer === "y" || answer === "yes") {
      return true;
    }

    if (answer === "n" || answer === "no") {
      return false;
    }

    console.log("Choose yes or no.");
  }
}

function createStandaloneIssueFinalizeRunDir(repoRoot: string, issueNumber: number): string {
  const runDir = resolve(
    repoRoot,
    ".prs",
    "runs",
    `${formatRunTimestamp()}-issue-${issueNumber}-finalize`
  );

  mkdirSync(runDir, { recursive: true });
  return runDir;
}

function createAutoAcceptedGeneratedText(
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

async function finalizeIssueRunUnattended(
  repoRoot: string,
  issueNumber: number,
  provider: AIProvider,
  runDir: string
): Promise<Extract<FinalizeIssueRunResult, { committed: true }>> {
  const proposal = await generateDiffBasedCommitProposal(
    repoRoot,
    provider,
    readIssueWorkflowDiff
  );
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

function ensureIssueClosingReferences(body: string, issueNumbers: number[]): string {
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

function writeIssuePullRequestFiles(
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

function writePRDescriptionFailureArtifact(
  repoRoot: string,
  runDir: string,
  error: StructuredGenerationError
): string {
  const artifactPath = resolve(runDir, "pr-description-generation-error.json");

  writeFileSync(
    artifactPath,
    `${JSON.stringify(
      {
        stage: "pr-description",
        kind: error.kind,
        message: error.message,
        rawResponse: error.rawResponse,
        parsedJson: error.parsedJson,
        normalizedJson: error.normalizedJson,
        validationIssues: error.validationIssues,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return toRepoRelativePath(repoRoot, artifactPath);
}

function appendIssueOverlapDependencyNote(
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

async function generateIssuePullRequest(
  provider: AIProvider,
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
  let description: Awaited<ReturnType<typeof generatePRDescription>>;
  try {
    description = await generatePRDescription(provider, {
      diff: options.diff,
      issueTitle: options.issue.title,
      issueBody: options.issue.body,
    });
  } catch (error: unknown) {
    if (error instanceof StructuredGenerationError) {
      const artifactSuffix =
        options.runDir !== undefined
          ? ` Diagnostic artifact: ${writePRDescriptionFailureArtifact(
              options.repoRoot,
              options.runDir,
              error
            )}.`
          : "";
      throw new Error(
        `Failed to generate PR description. ${error.message}${artifactSuffix}`
      );
    }

    throw error;
  }

  const assistant = await generatePRAssistant(provider, {
    diff: options.diff,
    prTitle: description.title,
    prBody: description.body,
    commitMessages: options.commitMessage.content.trim(),
  });

  const linkedSourceIssueNumber = getPrsLinkedSourceIssueNumber(options.issue);
  const closingIssueNumbers =
    linkedSourceIssueNumber === undefined ||
    linkedSourceIssueNumber === options.issueNumber
      ? [options.issueNumber]
      : [options.issueNumber, linkedSourceIssueNumber];

  const bodyWithOverlapNote = appendIssueOverlapDependencyNote(
    ensureIssueClosingReferences(description.body, closingIssueNumbers),
    options.overlapDecision
  );
  const body = mergePRAssistantSection(
    bodyWithOverlapNote,
    buildPRAssistantSection(assistant)
  );
  const pullRequest: GeneratedIssuePullRequest = {
    title: description.title,
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

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDiffSummary(
  summary: Awaited<ReturnType<typeof generateDiffSummary>>
): string {
  const sections = [
    "Changes Overview",
    summary.summary,
    "",
    "Major Areas Affected",
  ];

  for (const area of summary.majorAreas) {
    sections.push(`- ${area}`);
  }

  if (summary.riskAreas && summary.riskAreas.length > 0) {
    sections.push("", "Potential Risk Areas");
    for (const risk of summary.riskAreas) {
      sections.push(`- ${risk}`);
    }
  }

  sections.push("");
  return sections.join("\n");
}

async function createProvider(
  repoRoot = getDefaultRepoRoot()
): Promise<{
  provider: AIProvider;
  providerType: ResolvedRepositoryConfigType["ai"]["provider"]["type"];
}> {
  loadRepoEnv(repoRoot);
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const configuredProvider = repositoryConfig.ai.provider;
  const defaultProvider = {
    type: "openai" as const,
  };
  const environment = readProviderEnvironment();

  try {
    return {
      provider: await createProviderFromConfig(configuredProvider, environment),
      providerType: configuredProvider.type,
    };
  } catch (error: unknown) {
    const configuredMessage = error instanceof Error ? error.message : String(error);

    if (configuredProvider.type === defaultProvider.type) {
      throw new Error(configuredMessage);
    }

    try {
      const provider = await createProviderFromConfig(defaultProvider, environment);
      console.log(
        `Configured provider "${configuredProvider.type}" is unavailable. ${configuredMessage} Falling back to the default provider "${defaultProvider.type}".`
      );
      return {
        provider,
        providerType: defaultProvider.type,
      };
    } catch (defaultError: unknown) {
      const defaultMessage =
        defaultError instanceof Error ? defaultError.message : String(defaultError);
      throw new Error(
        `Configured provider "${configuredProvider.type}" is unavailable. ${configuredMessage} The default provider "${defaultProvider.type}" is also unavailable. ${defaultMessage}`
      );
    }
  }
}

async function runReviewCommand(args = getCliArgs()): Promise<void> {
  if (args[1] === "tests") {
    await runTestBacklogCommand(args);
    return;
  }

  if (args[1] === "features") {
    await runFeatureBacklogCommand(args);
    return;
  }

  const options = parseReviewCommandArgs(args);
  const diff = readReviewDiff(options.base, options.head);
  const { provider } = await createProvider();
  const issue =
    options.issueNumber !== undefined
      ? await getRepositoryForge().fetchIssueDetails(options.issueNumber)
      : undefined;
  const result = await generatePRReview(provider, {
    diff,
    issueNumber: options.issueNumber,
    issueTitle: issue?.title,
    issueBody: issue?.body,
    issueUrl: issue?.url,
  });
  const output = {
    ...result,
    issue: issue
      ? {
          number: options.issueNumber,
          title: issue.title,
          url: issue.url,
        }
      : undefined,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${formatCorePRReviewMarkdown(result, {
      number: options.issueNumber,
      title: issue?.title,
      url: issue?.url,
    })}\n`
  );
}

async function runAuditCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const command = parseAuditCommandArgs(getCliArgs());
  const artifactPath = isAbsolute(command.filePath)
    ? command.filePath
    : resolve(repoRoot, command.filePath);

  if (!existsSync(artifactPath)) {
    throw new Error(`Audit artifact file does not exist: ${command.filePath}`);
  }

  const forge = getRepositoryForge(repoRoot);
  const content = readFileSync(artifactPath, "utf8").trim();
  if (!content) {
    throw new Error(`Audit artifact file is empty: ${command.filePath}`);
  }

  const result = await publishAuditArtifact(forge, {
    target: command.target,
    sectionName: command.sectionName,
    content,
    localRun: command.localRun,
  });

  console.log(`Audit artifact ${result.status}: ${result.comment.url}`);
}

async function runUpdateCommand(): Promise<void> {
  const command = parseUpdateCommandArgs(getCliArgs());
  if (command.action === "skills") {
    logManagedCodexSkillsRefreshResult(refreshManagedCodexSkills());
  }
}

async function runPrCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const prCommand = parsePrCommandArgs(getCliArgs());
  const repositoryConfig = getRepositoryConfig(repoRoot);

  if (prCommand.action === "resolve-conflicts") {
    await runPrResolveConflictsCodexLauncher(prCommand.prNumber, repoRoot, repositoryConfig);
    return;
  }

  if (prCommand.action === "fix-comments") {
    const result = await runPrFixCommentsCommand({
      mode: "prepare",
      prNumber: prCommand.prNumber,
      repoRoot,
      buildCommand: repositoryConfig.buildCommand,
      ensureVerificationCommandAvailable,
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch: () => {
            throw new Error("prs pr fix-comments must not launch Codex.");
          },
        }),
      },
      forge: getRepositoryForge(repoRoot),
      ensureCleanWorkingTree,
      promptForLine,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  if (prCommand.action === "fix-failing-tests") {
    const result = await runPrFixFailingTestsCommand({
      mode: "prepare",
      prNumber: prCommand.prNumber,
      repoRoot,
      buildCommand: repositoryConfig.buildCommand,
      ensureVerificationCommandAvailable,
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch: () => {
            throw new Error("prs pr fix-failing-tests must not launch Codex.");
          },
        }),
      },
      forge: getRepositoryForge(repoRoot),
      ensureCleanWorkingTree,
      captureVerificationFailure,
      promptForLine,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  const result = await runPrFixTestsCommand({
    mode: "prepare",
    prNumber: prCommand.prNumber,
    repoRoot,
    buildCommand: repositoryConfig.buildCommand,
    ensureVerificationCommandAvailable,
    runtime: {
      resolve: () => ({
        displayName: "Codex",
        launch: () => {
          throw new Error("prs pr fix-tests must not launch Codex.");
        },
      }),
    },
    forge: getRepositoryForge(repoRoot),
    ensureCleanWorkingTree,
    promptForLine,
    verifyBuild,
    hasChanges,
    commitGeneratedChanges,
  });
  if (result) {
    console.log(JSON.stringify(result, null, 2));
  }
}

async function runPrPrepareReviewCodexLauncher(
  prNumber: number,
  repoRoot: string,
  repositoryConfig: ReturnType<typeof getRepositoryConfig>
): Promise<void> {
  await runPrPrepareReviewCommand({
    prNumber,
    repoRoot,
    buildCommand: repositoryConfig.buildCommand,
    ensureVerificationCommandAvailable,
    preflightBaseBranch: preflightRemoteBranch,
    forge: getRepositoryForge(repoRoot),
    ensureCleanWorkingTree,
    promptForLine,
    hasChanges,
    verifyBuild,
    commitGeneratedChanges,
    readDiff: readIssueWorkflowDiff,
    createProvider: async (providerRepoRoot) => createProvider(providerRepoRoot),
  });
}

async function runPrResolveConflictsCodexLauncher(
  prNumber: number,
  repoRoot: string,
  repositoryConfig: ReturnType<typeof getRepositoryConfig>
): Promise<void> {
  await runPrResolveConflictsCommand({
    prNumber,
    repoRoot,
    buildCommand: repositoryConfig.buildCommand,
    ensureVerificationCommandAvailable,
    preflightBaseBranch: preflightRemoteBranch,
    forge: getRepositoryForge(repoRoot),
    ensureCleanWorkingTree,
    verifyBuild,
  });
}

async function runCodexCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const codexCommand = parseCodexCommand(getCliArgs());

  if (codexCommand.action === "issue") {
    await runUnattendedIssueCommand(codexCommand.issueNumber);
    return;
  }

  if (codexCommand.action === "issue-batch") {
    await runIssueBatchCommand(codexCommand.issueNumbers);
    return;
  }

  if (codexCommand.action === "pr-prepare-review") {
    await runPrPrepareReviewCodexLauncher(
      codexCommand.prNumber,
      repoRoot,
      repositoryConfig
    );
    return;
  }

  await runPrResolveConflictsCodexLauncher(
    codexCommand.prNumber,
    repoRoot,
    repositoryConfig
  );
}

async function runToolCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  loadRepoEnv(repoRoot);
  const toolCommand = parsePrsToolCommandArgs(getCliArgs().slice(1));
  const repositoryConfig = getRepositoryConfig(repoRoot);

  if (toolCommand.kind === "pr-list") {
    const result = await listPullRequestsTool({
      actionable: toolCommand.actionable,
      repoRoot,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-list") {
    const result = await listIssuesTool({
      actionable: toolCommand.actionable,
      repoRoot,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-ready") {
    const result = await readyIssueTool({
      all: toolCommand.all,
      issueNumber: toolCommand.issueNumber,
      repoRoot,
      forge: getRepositoryForge(repoRoot),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-create") {
    const forge = getRepositoryForge(repoRoot);

    if (forge.type === "none") {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "blocked",
            message:
              "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue creation.",
            nextAction: "configure-forge",
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (!forge.isAuthenticated()) {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "blocked",
            message:
              "GitHub issue creation requires GH_TOKEN or GITHUB_TOKEN in the repository environment, or an authenticated gh session.",
            nextAction: "configure-github-auth",
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (toolCommand.draftFilePath) {
      const draftFilePath = resolve(repoRoot, toolCommand.draftFilePath);
      const parsedDraft = parseIssueDraftDocument(readFileSync(draftFilePath, "utf8"));
      const body = toolCommand.forcePrsManaged
        ? ensurePrsManagedIssueBody(parsedDraft.body)
        : parsedDraft.body;
      const issue = await forge.createOrReuseIssue(
        parsedDraft.title,
        body,
        toolCommand.labels
      );

      process.stdout.write(
        `${JSON.stringify(
          {
            status: "ok",
            mode: "single",
            issues: [issue],
            createdIssues: [issue],
            auditPublicationHints: createAuditPublicationHints({
              issueNumbers: [issue.number],
              planFilePath: toolCommand.planFilePath,
            }),
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (!toolCommand.issueSetFilePath) {
      throw new Error("Provide exactly one of --draft-file or --issue-set.");
    }

    const issueSetFilePath = resolve(repoRoot, toolCommand.issueSetFilePath);
    const runDir = toolCommand.runDir
      ? resolve(repoRoot, toolCommand.runDir)
      : dirname(issueSetFilePath);
    const issueSet = loadIssueDraftSet({
      repoRoot,
      runDir,
      issueSetFilePath,
    });
    const issues = await createIssueDraftSetWithRecords({
      issueSet,
      forge,
      labels: toolCommand.labels,
      forcePrsManaged: toolCommand.forcePrsManaged,
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          mode: "multiple",
          issues,
          createdIssues: issues,
          auditPublicationHints: createAuditPublicationHints({
            issueNumbers: issues.map((issue) => issue.number),
            planFilePath: toolCommand.planFilePath,
          }),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (toolCommand.kind === "pr-prepare-review") {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    let result: Awaited<ReturnType<typeof preparePullRequestReviewTool>>;
    try {
      result = await preparePullRequestReviewTool({
        prNumber: toolCommand.prNumber,
        repoRoot,
        buildCommand: repositoryConfig.buildCommand,
        ensureVerificationCommandAvailable,
        preflightBaseBranch: preflightRemoteBranch,
        forge: getRepositoryForge(repoRoot),
        ensureCleanWorkingTree,
        promptForLine,
        hasChanges,
        verifyBuild,
        commitGeneratedChanges,
        readDiff: readIssueWorkflowDiff,
        createProvider: async (providerRepoRoot) => createProvider(providerRepoRoot),
      });
    } finally {
      console.log = originalConsoleLog;
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "pr-push-reviewed") {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    try {
      ensureCleanWorkingTree(repoRoot);
      const forge = getRepositoryForge(repoRoot);
      const pullRequest = await forge.fetchPullRequestDetails(toolCommand.prNumber);
      const runDir = resolve(
        repoRoot,
        ".prs",
        "runs",
        `${formatRunTimestamp()}-pr-${pullRequest.number}-push-reviewed`
      );
      mkdirSync(runDir, { recursive: true });
      const outputLogPath = resolve(runDir, "output.log");
      const createdAt = new Date().toISOString();
      writeFileSync(
        outputLogPath,
        [
          "# prs tool pr push-reviewed run log",
          "",
          `Created: ${createdAt}`,
          `Pull request: #${pullRequest.number} ${pullRequest.title}`,
          `Head branch: ${pullRequest.headRefName}`,
          "",
        ].join("\n"),
        "utf8"
      );
      const pushResult = pushReviewedPullRequestUpdates(
        repoRoot,
        outputLogPath,
        pullRequest.headRefName
      );

      process.stdout.write(
        `${JSON.stringify(
          {
            status: pushResult.status,
            prNumber: pullRequest.number,
            headRefName: pullRequest.headRefName,
            remoteRef: pushResult.remoteRef,
            runDir: toRepoRelativePath(repoRoot, runDir),
            outputLogPath: toRepoRelativePath(repoRoot, outputLogPath),
          },
          null,
          2
        )}\n`
      );
    } finally {
      console.log = originalConsoleLog;
    }
    return;
  }

  if (
    toolCommand.kind === "pr-fix-comments" ||
    toolCommand.kind === "pr-fix-failing-tests" ||
    toolCommand.kind === "pr-fix-tests"
  ) {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    const runtime = {
      resolve: () => ({
        displayName: "Codex",
        launch: () => {
          throw new Error("prs tool pr fix preparation must not launch Codex.");
        },
      }),
    };
    let result:
      | Awaited<ReturnType<typeof runPrFixCommentsCommand>>
      | Awaited<ReturnType<typeof runPrFixFailingTestsCommand>>
      | Awaited<ReturnType<typeof runPrFixTestsCommand>>;
    try {
      if (toolCommand.kind === "pr-fix-comments") {
        result = await runPrFixCommentsCommand({
          mode: "prepare",
          selection: toolCommand.selection,
          prNumber: toolCommand.prNumber,
          repoRoot,
          buildCommand: repositoryConfig.buildCommand,
          ensureVerificationCommandAvailable,
          runtime,
          forge: getRepositoryForge(repoRoot),
          ensureCleanWorkingTree,
          promptForLine,
          verifyBuild,
          hasChanges,
          commitGeneratedChanges,
        });
      } else if (toolCommand.kind === "pr-fix-failing-tests") {
        result = await runPrFixFailingTestsCommand({
          mode: "prepare",
          prNumber: toolCommand.prNumber,
          repoRoot,
          buildCommand: repositoryConfig.buildCommand,
          ensureVerificationCommandAvailable,
          runtime,
          forge: getRepositoryForge(repoRoot),
          ensureCleanWorkingTree,
          captureVerificationFailure,
          promptForLine,
          verifyBuild,
          hasChanges,
          commitGeneratedChanges,
        });
      } else {
        result = await runPrFixTestsCommand({
          mode: "prepare",
          selection: toolCommand.selection,
          prNumber: toolCommand.prNumber,
          repoRoot,
          buildCommand: repositoryConfig.buildCommand,
          ensureVerificationCommandAvailable,
          runtime,
          forge: getRepositoryForge(repoRoot),
          ensureCleanWorkingTree,
          promptForLine,
          verifyBuild,
          hasChanges,
          commitGeneratedChanges,
        });
      }
    } finally {
      console.log = originalConsoleLog;
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "pr-ready") {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    let result: Awaited<ReturnType<typeof readyPullRequestTool>>;
    try {
      result = await readyPullRequestTool({
        all: toolCommand.all,
        prNumber: toolCommand.prNumber,
        repoRoot,
        buildCommand: repositoryConfig.buildCommand,
        localRuntime: repositoryConfig.localRuntime,
        ensureVerificationCommandAvailable,
        forge: getRepositoryForge(repoRoot),
        ensureCleanWorkingTree,
      });
    } finally {
      console.log = originalConsoleLog;
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error("This prs tool command is not implemented yet.");
}

function formatTestBacklogMarkdown(
  result: Awaited<ReturnType<typeof analyzeTestBacklog>>,
  createdIssues: CreatedIssueRecord[]
): string {
  const lines: string[] = [
    "# AI Test Backlog",
    "",
    "## Summary",
    result.summary,
    "",
    "## Current testing setup",
    `- Status: ${toTitleCase(result.currentTestingSetup.status)}`,
    `- Test files detected: ${result.currentTestingSetup.testFileCount}`,
    `- Frameworks: ${
      result.currentTestingSetup.frameworks.length > 0
        ? result.currentTestingSetup.frameworks.join(", ")
        : "None detected"
    }`,
    `- CI integration: ${toTitleCase(result.currentTestingSetup.ciIntegration.status)}`,
  ];

  if (result.currentTestingSetup.evidence.length > 0) {
    lines.push(
      `- Evidence: ${result.currentTestingSetup.evidence.slice(0, 5).join("; ")}`
    );
  }

  if (result.currentTestingSetup.frameworkRecommendation) {
    lines.push(
      `- Recommended framework: ${result.currentTestingSetup.frameworkRecommendation.recommended}`
    );
    lines.push(
      `- Recommendation rationale: ${result.currentTestingSetup.frameworkRecommendation.rationale}`
    );
  }

  if (result.currentTestingSetup.ciIntegration.workflows.length > 0) {
    lines.push(
      `- CI workflows: ${result.currentTestingSetup.ciIntegration.workflows.join(", ")}`
    );
  }

  if (result.currentTestingSetup.ciIntegration.evidence.length > 0) {
    lines.push(
      `- CI evidence: ${result.currentTestingSetup.ciIntegration.evidence.slice(0, 5).join("; ")}`
    );
  }

  if (result.currentTestingSetup.notes.length > 0) {
    lines.push("");
    lines.push("## Notes");
    lines.push(...result.currentTestingSetup.notes.map((note) => `- ${note}`));
  }

  if (result.currentTestingSetup.ciIntegration.notes.length > 0) {
    lines.push("");
    lines.push("## CI notes");
    lines.push(
      ...result.currentTestingSetup.ciIntegration.notes.map((note) => `- ${note}`)
    );
  }

  lines.push("", "## Prioritized findings", "");
  if (result.findings.length === 0) {
    lines.push("No prioritized testing backlog findings were detected for this repository.");
    lines.push("");
  } else {
    for (const finding of result.findings) {
      lines.push(`### ${finding.title}`);
      lines.push(`- Priority: ${toTitleCase(finding.priority)}`);
      lines.push(`- Suggested test types: ${finding.suggestedTestTypes.join(", ")}`);
      lines.push(`- Rationale: ${finding.rationale}`);
      if (finding.existingCoverage) {
        lines.push(`- Existing coverage signal: ${finding.existingCoverage}`);
      }
      lines.push(
        `- Related paths: ${finding.relatedPaths.map((path) => `\`${path}\``).join(", ")}`
      );
      lines.push(`- Draft issue title: ${finding.issueTitle}`);
      lines.push("");
    }
  }

  lines.push(...formatCreatedIssueResultLines(createdIssues));

  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function formatFeatureBacklogMarkdown(
  result: Awaited<ReturnType<typeof analyzeFeatureBacklog>>,
  createdIssues: CreatedIssueRecord[]
): string {
  const lines: string[] = [
    "# AI Feature Backlog",
    "",
    "## Summary",
    result.summary,
    "",
    "## Repository signals",
    `- CLI surface: ${toTitleCase(String(result.repositorySignals.hasCli))}`,
    `- GitHub Actions: ${toTitleCase(String(result.repositorySignals.hasGitHubActions))}`,
    `- Existing tests: ${toTitleCase(String(result.repositorySignals.hasTests))}`,
    `- Issue templates: ${toTitleCase(String(result.repositorySignals.hasIssueTemplates))}`,
    `- Release automation: ${toTitleCase(String(result.repositorySignals.hasReleaseAutomation))}`,
    `- Examples/templates: ${toTitleCase(String(result.repositorySignals.hasExamples))}`,
    `- Package manifests: ${result.repositorySignals.packageCount}`,
    `- Workflows: ${result.repositorySignals.workflowCount}`,
    `- Provider adapters: ${result.repositorySignals.providerCount}`,
  ];

  if (result.repositorySignals.evidence.length > 0) {
    lines.push(
      `- Evidence: ${result.repositorySignals.evidence.slice(0, 5).join("; ")}`
    );
  }

  if (result.repositorySignals.notes.length > 0) {
    lines.push("", "## Notes");
    lines.push(...result.repositorySignals.notes.map((note) => `- ${note}`));
  }

  lines.push("", "## Prioritized suggestions", "");
  for (const suggestion of result.suggestions) {
    lines.push(`### ${suggestion.title}`);
    lines.push(`- Priority: ${toTitleCase(suggestion.priority)}`);
    lines.push(`- Category: ${toTitleCase(suggestion.category)}`);
    lines.push(`- Rationale: ${suggestion.rationale}`);
    lines.push(`- Evidence: ${suggestion.evidence.join("; ")}`);
    lines.push(
      `- Related paths: ${suggestion.relatedPaths.map((path) => `\`${path}\``).join(", ")}`
    );
    lines.push(`- Draft issue title: ${suggestion.issueTitle}`);
    lines.push("");
  }

  if (createdIssues.length > 0) {
    lines.push("## Issue results");
    lines.push(
      ...createdIssues.map(
        (issue) =>
          `- ${issue.status === "created" ? "Created" : "Reused"} #${issue.number}: ${issue.title} (${issue.url})`
      )
    );
    lines.push("");
  }

  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function parseNumberedSelection(
  response: string,
  maxIndex: number,
  itemType = "item"
): number[] {
  const normalized = response.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "n") {
    return [];
  }

  if (normalized === "all") {
    return Array.from({ length: maxIndex }, (_, index) => index);
  }

  const selected = new Set<number>();
  for (const part of response.split(",")) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `Invalid selection "${trimmed}". Use comma-separated ${itemType} numbers, "all", or "none".`
      );
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxIndex) {
      throw new Error(
        `Invalid selection "${trimmed}". Choose ${itemType} values between 1 and ${maxIndex}.`
      );
    }

    selected.add(parsed - 1);
  }

  return [...selected].sort((left, right) => left - right);
}

function formatCreatedIssueResultLines(createdIssues: CreatedIssueRecord[]): string[] {
  if (createdIssues.length === 0) {
    return [];
  }

  return [
    "## Issue results",
    ...createdIssues.map(
      (issue) =>
        `- ${issue.status === "created" ? "Created" : "Reused"} #${issue.number}: ${issue.title} (${issue.url})`
    ),
    "",
  ];
}

function parseTestBacklogIssueSelection(response: string, maxIndex: number): number[] {
  const normalized = response.trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return Array.from({ length: maxIndex }, (_, index) => index);
  }

  return parseNumberedSelection(response, maxIndex, "finding");
}

function appendAdditionalDescription(body: string, additionalDescription: string): string {
  const trimmed = additionalDescription.trim();
  if (!trimmed) {
    return body;
  }

  return `${body}\n\n## Maintainer notes\n${trimmed}\n`;
}

async function maybeCreateTestBacklogIssues(
  options: TestBacklogCommandOptions,
  analysis: Awaited<ReturnType<typeof analyzeTestBacklog>>,
  selectedIndexes = analysis.findings
    .slice(0, options.maxIssues)
    .map((_, index) => index)
): Promise<CreatedIssueRecord[]> {
  if (!options.createIssues) {
    return [];
  }

  const forge = getRepositoryForge(options.repoRoot);
  const createdIssues: CreatedIssueRecord[] = [];

  for (const findingIndex of selectedIndexes) {
    const finding = analysis.findings[findingIndex];
    if (!finding) {
      continue;
    }

    createdIssues.push(
      await forge.createOrReuseIssue(
        finding.issueTitle,
        finding.issueBody,
        options.labels
      )
    );
  }

  return createdIssues;
}

async function maybePromptForTestBacklogIssueCreation(
  options: TestBacklogCommandOptions,
  analysis: Awaited<ReturnType<typeof analyzeTestBacklog>>
): Promise<CreatedIssueRecord[]> {
  if (
    options.createIssues ||
    options.format !== "markdown" ||
    analysis.findings.length === 0 ||
    !process.stdin.isTTY
  ) {
    return [];
  }

  const shouldCreateIssues = await promptForYesNoDefaultYes(
    "Do you want to create GitHub issues now? (Y/n): "
  );
  if (!shouldCreateIssues) {
    return [];
  }

  const candidateFindings = analysis.findings.slice(0, options.maxIssues);
  const issueNumbers = candidateFindings
    .map((_, index) => String(index + 1))
    .join(",");
  const rawSelection = await promptForLine(
    `Which issues would you like to create? (ALL/${issueNumbers}): `
  );
  const selectedIndexes = parseTestBacklogIssueSelection(
    rawSelection,
    candidateFindings.length
  );

  return maybeCreateTestBacklogIssues(
    {
      ...options,
      createIssues: true,
    },
    analysis,
    selectedIndexes
  );
}

async function maybeCreateFeatureBacklogIssues(
  options: FeatureBacklogCommandOptions,
  analysis: Awaited<ReturnType<typeof analyzeFeatureBacklog>>
): Promise<CreatedIssueRecord[]> {
  if (!options.createIssues) {
    return [];
  }

  const forge = getRepositoryForge(options.repoRoot);
  const createdIssues: CreatedIssueRecord[] = [];
  const selectionPrompt = analysis.suggestions
    .map((suggestion, index) => `${index + 1}:${suggestion.issueTitle}`)
    .join(", ");
  const rawSelection = await promptForLine(
    `Create issues for which suggestions? [all|none|${selectionPrompt}]: `
  );
  const selectedIndexes = parseNumberedSelection(
    rawSelection,
    analysis.suggestions.length,
    "suggestion"
  ).slice(0, options.maxIssues);

  if (selectedIndexes.length === 0) {
    return [];
  }

  for (const suggestionIndex of selectedIndexes) {
    const suggestion = analysis.suggestions[suggestionIndex];
    const titleInput = await promptForLine(
      `Issue title [${suggestion.issueTitle}]: `
    );
    const issueTitle = titleInput.trim() || suggestion.issueTitle;
    const extraDescription = await promptForLine(
      "Additional description (optional): "
    );
    const labelsInput = await promptForLine(
      `Labels [${options.labels.join(",")}]: `
    );
    const labels = labelsInput.trim()
      ? labelsInput
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean)
      : options.labels;

    createdIssues.push(
      await forge.createOrReuseIssue(
        issueTitle,
        appendAdditionalDescription(suggestion.issueBody, extraDescription),
        labels
      )
    );
  }

  return createdIssues;
}

async function runTestBacklogCommand(args = getCliArgs()): Promise<void> {
  const options = parseTestBacklogCommandArgs(args);
  const repositoryConfig = getRepositoryConfig(options.repoRoot);
  const analysis = await analyzeTestBacklog({
    excludePaths: repositoryConfig.aiContext.excludePaths,
    repoRoot: options.repoRoot,
    maxFindings: options.top,
  });
  const createdIssues = await maybeCreateTestBacklogIssues(options, analysis);
  const output = {
    ...analysis,
    createdIssues,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatTestBacklogMarkdown(analysis, createdIssues)}\n`);

  const interactivelyCreatedIssues = await maybePromptForTestBacklogIssueCreation(
    options,
    analysis
  );
  if (interactivelyCreatedIssues.length > 0) {
    process.stdout.write(
      `\n${formatCreatedIssueResultLines(interactivelyCreatedIssues).join("\n")}`
    );
  }
}

async function runFeatureBacklogCommand(args = getCliArgs()): Promise<void> {
  const options = parseFeatureBacklogCommandArgs(args);
  const repositoryConfig = getRepositoryConfig(options.repoRoot);
  const analysis = await analyzeFeatureBacklog({
    excludePaths: repositoryConfig.aiContext.excludePaths,
    repoRoot: options.repoRoot,
    maxSuggestions: options.top,
  });
  const createdIssues = await maybeCreateFeatureBacklogIssues(options, analysis);
  const output = {
    ...analysis,
    createdIssues,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatFeatureBacklogMarkdown(analysis, createdIssues)}\n`);
}

async function runIssueDraftCommand(
  options: IssueDraftCommandOptions
): Promise<void> {
  if (options.mode === "runtime") {
    await runIssueDraftRuntimeCommand();
    return;
  }

  const repoRoot = getDefaultRepoRoot();
  const workspace = createIssueDraftWorkspace(repoRoot);
  const shouldPublishSuperpowersPlan = Boolean(options.superpowersPlanFilePath);

  writeCallerIssueDraftWorkspaceFiles(repoRoot, options, workspace);

  const issueSet = existsSync(workspace.issueSetFilePath)
    ? loadIssueDraftSet({
        repoRoot,
        runDir: workspace.runDir,
        issueSetFilePath: workspace.issueSetFilePath,
      })
    : undefined;

  const forge = getRepositoryForge(repoRoot);
  if (issueSet) {
    if (!forge.isAuthenticated()) {
      printGeneratedTextPreview(
        "Generated issue draft set",
        formatIssueDraftSetPreview(repoRoot, issueSet)
      );
      if (forge.type === "github") {
        console.log("Issue creation skipped because GitHub access is unavailable.");
      } else {
        console.log(
          "Issue creation skipped because repository forge support is disabled by .prs/config.json."
        );
      }
      return;
    }

    const reviewedIssueSet = await reviewIssueDraftSet({
      repoRoot,
      issueSet,
      prompt: "Create these linked issues in GitHub? [Y/n/m]: ",
      promptForLine,
      reload: () =>
        loadIssueDraftSet({
          repoRoot,
          runDir: workspace.runDir,
          issueSetFilePath: workspace.issueSetFilePath,
        }),
    });

    if (!reviewedIssueSet) {
      console.log(
        `Issue draft set kept at ${toRepoRelativePath(
          repoRoot,
          workspace.issueSetFilePath
        )}.`
      );
      return;
    }

    const createdIssues = await createLinkedIssueDraftSet({
      issueSet: reviewedIssueSet,
      forge,
      forcePrsManaged: false,
    });
    for (const issue of createdIssues) {
      console.log(`Created issue: ${issue.url}`);
    }
    if (shouldPublishSuperpowersPlan && createdIssues[0]) {
      await publishSuperpowersPlanArtifact({
        repoRoot,
        forge,
        issueNumber: createdIssues[0].number,
        planFilePath: workspace.superpowersPlanFilePath,
        outputLogPath: workspace.outputLogPath,
      });
    }
    return;
  }

  if (!existsSync(workspace.draftFilePath)) {
    throw new Error(
      `The prs:create skill did not write the issue draft to ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }

  const draftContents = readFileSync(workspace.draftFilePath, "utf8").trim();
  if (!draftContents) {
    throw new Error(
      `The prs:create skill wrote an empty issue draft at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }
  if (!forge.isAuthenticated()) {
    printGeneratedTextPreview("Generated issue draft", draftContents);
    if (forge.type === "github") {
      console.log("Issue creation skipped because GitHub access is unavailable.");
    } else {
      console.log(
        "Issue creation skipped because repository forge support is disabled by .prs/config.json."
      );
    }
    return;
  }

  const reviewedDraft = await reviewGeneratedText({
    filePath: workspace.draftFilePath,
    initialContent: draftContents,
    previewHeading: "Generated issue draft",
    prompt: "Create this issue in GitHub? [Y/n/m]: ",
    emptyContentMessage: "Issue draft cannot be empty.",
    editorDescription: "issue draft",
    promptForLine,
    validate: (content) => {
      parseIssueDraftDocument(content);
    },
  });

  if (!reviewedDraft) {
    console.log(
      `Draft kept at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
    return;
  }

  const parsedDraft = parseIssueDraftDocument(reviewedDraft.content);
  const issueUrl = await forge.createDraftIssue(parsedDraft.title, parsedDraft.body);
  console.log(`Created issue: ${issueUrl}`);
  if (shouldPublishSuperpowersPlan) {
    const createdIssue = parseCreatedIssueUrl(issueUrl);
    await publishSuperpowersPlanArtifact({
      repoRoot,
      forge,
      issueNumber: createdIssue.issueNumber,
      planFilePath: workspace.superpowersPlanFilePath,
      outputLogPath: workspace.outputLogPath,
    });
  }
}

async function runIssueDraftRuntimeCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const runtime = selectInteractiveRuntime(repositoryConfig.ai.runtime, {
    onFallback: (message) => {
      console.log(message);
    },
  });
  const shouldUseCodexSuperpowers =
    runtime.type === "codex" &&
    repositoryConfig.ai.issue.useCodexSuperpowers &&
    isCodexSuperpowersAvailable();

  if (
    runtime.type === "codex" &&
    repositoryConfig.ai.issue.useCodexSuperpowers &&
    !shouldUseCodexSuperpowers
  ) {
    console.log(
      "Codex Superpowers-backed issue workflows are enabled in .prs/config.json, but Superpowers is not available in the current Codex installation. Falling back to the standard issue-draft prompt."
    );
  }

  const featureIdea = await promptForRequiredLine("Rough idea: ");
  const workspace = createIssueDraftWorkspace(repoRoot);
  writeIssueDraftWorkspaceFiles(repoRoot, featureIdea, workspace, runtime.type, {
    useCodexSuperpowers: shouldUseCodexSuperpowers,
  });

  console.log(
    `${runtime.displayName} will open a separate interactive AI session for issue drafting. Only the context saved in ${toRepoRelativePath(
      repoRoot,
      workspace.promptFilePath
    )} will be available to that session.`
  );
  runtime.launch(repoRoot, {
    promptFilePath: workspace.promptFilePath,
    outputLogPath: workspace.outputLogPath,
  });

  const issueSet = existsSync(workspace.issueSetFilePath)
    ? loadIssueDraftSet({
        repoRoot,
        runDir: workspace.runDir,
        issueSetFilePath: workspace.issueSetFilePath,
      })
    : undefined;

  const forge = getRepositoryForge(repoRoot);
  if (issueSet) {
    if (!forge.isAuthenticated()) {
      printGeneratedTextPreview(
        "Generated issue draft set",
        formatIssueDraftSetPreview(repoRoot, issueSet)
      );
      if (forge.type === "github") {
        console.log("Issue creation skipped because GitHub access is unavailable.");
      } else {
        console.log(
          "Issue creation skipped because repository forge support is disabled by .prs/config.json."
        );
      }
      return;
    }

    const reviewedIssueSet = await reviewIssueDraftSet({
      repoRoot,
      issueSet,
      prompt: "Create these linked issues in GitHub? [Y/n/m]: ",
      promptForLine,
      reload: () =>
        loadIssueDraftSet({
          repoRoot,
          runDir: workspace.runDir,
          issueSetFilePath: workspace.issueSetFilePath,
        }),
    });

    if (!reviewedIssueSet) {
      console.log(
        `Issue draft set kept at ${toRepoRelativePath(
          repoRoot,
          workspace.issueSetFilePath
        )}.`
      );
      return;
    }

    const createdIssues = await createLinkedIssueDraftSet({
      issueSet: reviewedIssueSet,
      forge,
      forcePrsManaged: false,
    });
    for (const issue of createdIssues) {
      console.log(`Created issue: ${issue.url}`);
    }
    if (shouldUseCodexSuperpowers && createdIssues[0]) {
      await publishSuperpowersPlanArtifact({
        repoRoot,
        forge,
        issueNumber: createdIssues[0].number,
        planFilePath: workspace.superpowersPlanFilePath,
        outputLogPath: workspace.outputLogPath,
      });
    }
    return;
  }

  if (!existsSync(workspace.draftFilePath)) {
    throw new Error(
      [
        `${runtime.displayName} returned without writing the expected issue draft.`,
        `Expected draft path: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
        `Run directory: ${toRepoRelativePath(repoRoot, workspace.runDir)}`,
        `Prompt path: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
        `Output log path: ${toRepoRelativePath(repoRoot, workspace.outputLogPath)}`,
        "Recovery: rerun the prs:create skill flow in the current Codex session, then pass the completed draft with `prs issue draft --draft-file <path>`.",
      ].join("\n")
    );
  }

  const draftContents = readFileSync(workspace.draftFilePath, "utf8").trim();
  if (!draftContents) {
    throw new Error(
      `${runtime.displayName} wrote an empty issue draft at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }
  if (!forge.isAuthenticated()) {
    printGeneratedTextPreview("Generated issue draft", draftContents);
    if (forge.type === "github") {
      console.log("Issue creation skipped because GitHub access is unavailable.");
    } else {
      console.log(
        "Issue creation skipped because repository forge support is disabled by .prs/config.json."
      );
    }
    return;
  }

  const reviewedDraft = await reviewGeneratedText({
    filePath: workspace.draftFilePath,
    initialContent: draftContents,
    previewHeading: "Generated issue draft",
    prompt: "Create this issue in GitHub? [Y/n/m]: ",
    emptyContentMessage: "Issue draft cannot be empty.",
    editorDescription: "issue draft",
    promptForLine,
    validate: (content) => {
      parseIssueDraftDocument(content);
    },
  });

  if (!reviewedDraft) {
    console.log(
      `Draft kept at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
    return;
  }

  const parsedDraft = parseIssueDraftDocument(reviewedDraft.content);
  const issueUrl = await forge.createDraftIssue(parsedDraft.title, parsedDraft.body);
  console.log(`Created issue: ${issueUrl}`);
  if (shouldUseCodexSuperpowers) {
    const createdIssue = parseCreatedIssueUrl(issueUrl);
    await publishSuperpowersPlanArtifact({
      repoRoot,
      forge,
      issueNumber: createdIssue.issueNumber,
      planFilePath: workspace.superpowersPlanFilePath,
      outputLogPath: workspace.outputLogPath,
    });
  }
}

async function runIssueRefineCommand(issueNumber: number): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const forge = getRepositoryForge(repoRoot);
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const runtime = selectInteractiveRuntime(repositoryConfig.ai.runtime, {
    onFallback: (message) => {
      console.log(message);
    },
  });
  const shouldUseCodexSuperpowers =
    runtime.type === "codex" &&
    repositoryConfig.ai.issue.useCodexSuperpowers &&
    isCodexSuperpowersAvailable();

  if (
    runtime.type === "codex" &&
    repositoryConfig.ai.issue.useCodexSuperpowers &&
    !shouldUseCodexSuperpowers
  ) {
    console.log(
      "Codex Superpowers-backed issue workflows are enabled in .prs/config.json, but Superpowers is not available in the current Codex installation. Falling back to the standard issue-refine prompt."
    );
  }

  console.log(`Fetching issue #${issueNumber}...`);
  const issue = await forge.fetchIssueDetails(issueNumber);
  const comments = await forge.fetchIssueComments(issueNumber);
  const existingSessionState = loadIssueRefineSessionState(repoRoot, issueNumber);
  const resumableSessionState =
    existingSessionState?.completionMode === undefined ? existingSessionState : undefined;
  const warnings: string[] = [];
  let runtimeInvocation: "new" | "resume" = "new";
  let sessionId: string | undefined;

  if (resumableSessionState) {
    if (resumableSessionState.runtimeType !== runtime.type) {
      warnings.push(
        buildIssueRefineRuntimeMismatchWarning(
          resumableSessionState.runtimeType,
          runtime.type
        )
      );
    } else if (
      resumableSessionState.sessionId &&
      getInteractiveRuntimeByType(runtime.type).metadata.supportsSessionTracking
    ) {
      const savedSession = findTrackedRuntimeSessionById(
        runtime.type,
        repoRoot,
        resumableSessionState.sessionId
      );

      if (savedSession) {
        if (existsSync(resumableSessionState.runDir)) {
          runtimeInvocation = "resume";
          sessionId = resumableSessionState.sessionId;
        } else {
          warnings.push(buildIssueRefineMissingWorkspaceWarning(issueNumber));
        }
      } else {
        warnings.push(
          buildIssueRefineStaleSessionWarning(
            issueNumber,
            runtime.type,
            resumableSessionState.sessionId
          )
        );
      }
    }
  }
  let requestedChanges: string | undefined;
  if (runtimeInvocation !== "resume") {
    const shouldSpecifyChanges = await promptForYesNoDefaultNo(
      "Specify changes to the original requirements? [y/N]: "
    );
    requestedChanges = shouldSpecifyChanges
      ? await promptForRequiredLine(
          "What changes should be made to the original requirements? "
        )
      : undefined;
  }

  const workspace =
    runtimeInvocation === "resume" && resumableSessionState
      ? createIssueRefineWorkspaceFromState(resumableSessionState)
      : createIssueRefineWorkspace(repoRoot, issueNumber);
  writeIssueRefineWorkspaceFiles(
    repoRoot,
    workspace,
    runtime.type,
    issueNumber,
    issue,
    comments,
    requestedChanges,
    runtimeInvocation,
    shouldUseCodexSuperpowers,
    sessionId,
    warnings
  );

  for (const warning of warnings) {
    console.log(warning);
    appendIssueRefineLog(workspace.outputLogPath, `Warning: ${warning}`);
  }

  const runtimeLaunch = runtime.launch(
    repoRoot,
    {
      promptFilePath: workspace.promptFilePath,
      outputLogPath: workspace.outputLogPath,
    },
    runtimeInvocation === "resume" ? { resumeSessionId: sessionId } : undefined
  );
  const resolvedSessionId = runtimeLaunch.sessionId;
  persistIssueRefineSessionState(
    repoRoot,
    issueNumber,
    runtime.type,
    workspace,
    resolvedSessionId
  );
  updateIssueRefineWorkspaceMetadata(workspace, (currentMetadata) => ({
    ...currentMetadata,
    runtime: {
      ...((currentMetadata.runtime as Record<string, unknown> | undefined) ?? {}),
      type: runtime.type,
      displayName: runtime.displayName,
      command: runtime.metadata.command,
      invocation: runtimeLaunch.invocation,
      sessionId: resolvedSessionId,
      sandboxMode: runtime.metadata.sandboxMode,
      approvalPolicy: runtime.metadata.approvalPolicy,
      warnings,
    },
  }));

  const issueSet = existsSync(workspace.issueSetFilePath)
    ? loadIssueDraftSet({
        repoRoot,
        runDir: workspace.runDir,
        issueSetFilePath: workspace.issueSetFilePath,
        fallbackSourceIssueNumber: issueNumber,
      })
    : undefined;

  if (issueSet) {
    if (!forge.isAuthenticated()) {
      printGeneratedTextPreview(
        "Generated refined issue draft set",
        formatIssueDraftSetPreview(repoRoot, issueSet)
      );
      console.log(
        forge.type === "github"
          ? "Issue refinement apply step skipped because GitHub access is unavailable."
          : "Issue refinement apply step skipped because repository forge support is disabled by .prs/config.json."
      );
      persistIssueRefineSessionState(
        repoRoot,
        issueNumber,
        runtime.type,
        workspace,
        resolvedSessionId,
        {
          mode: "kept-on-disk",
        }
      );
      return;
    }

    const reviewedIssueSet = await reviewIssueDraftSet({
      repoRoot,
      issueSet,
      prompt: "Create these linked PRS-managed issues in GitHub? [Y/n/m]: ",
      promptForLine,
      reload: () =>
        loadIssueDraftSet({
          repoRoot,
          runDir: workspace.runDir,
          issueSetFilePath: workspace.issueSetFilePath,
          fallbackSourceIssueNumber: issueNumber,
        }),
    });

    if (!reviewedIssueSet) {
      persistIssueRefineSessionState(
        repoRoot,
        issueNumber,
        runtime.type,
        workspace,
        resolvedSessionId,
        {
          mode: "kept-on-disk",
        }
      );
      console.log(
        `Refined issue set kept at ${toRepoRelativePath(
          repoRoot,
          workspace.issueSetFilePath
        )}.`
      );
      return;
    }

    const createdIssues = await createLinkedIssueDraftSet({
      issueSet: reviewedIssueSet,
      forge,
      forcePrsManaged: true,
    });
    persistIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtime.type,
      workspace,
      resolvedSessionId,
      {
        mode: "created-linked",
        issues: createdIssues.map((issue) => ({
          issueNumber: issue.number,
          issueUrl: issue.url,
        })),
      }
    );
    for (const issue of createdIssues) {
      console.log(`Created linked issue: ${issue.url}`);
    }
    if (shouldUseCodexSuperpowers && createdIssues[0]) {
      await publishSuperpowersPlanArtifact({
        repoRoot,
        forge,
        issueNumber: createdIssues[0].number,
        planFilePath: workspace.superpowersPlanFilePath,
        outputLogPath: workspace.outputLogPath,
      });
    }
    return;
  }

  if (!existsSync(workspace.draftFilePath)) {
    throw new Error(
      `${runtime.displayName} did not write the refined issue draft to ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }

  const draftContents = readFileSync(workspace.draftFilePath, "utf8").trim();
  if (!draftContents) {
    throw new Error(
      `${runtime.displayName} wrote an empty refined issue draft at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }

  if (!forge.isAuthenticated()) {
    printGeneratedTextPreview("Generated refined issue draft", draftContents);
    console.log(
      forge.type === "github"
        ? "Issue refinement apply step skipped because GitHub access is unavailable."
        : "Issue refinement apply step skipped because repository forge support is disabled by .prs/config.json."
    );
    persistIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtime.type,
      workspace,
      resolvedSessionId,
      {
        mode: "kept-on-disk",
      }
    );
    return;
  }

  const managedSourceIssue = isPrsManagedIssue(issue);
  const reviewedDraft = await reviewGeneratedText({
    filePath: workspace.draftFilePath,
    initialContent: draftContents,
    previewHeading: "Generated refined issue draft",
    prompt: managedSourceIssue
      ? `Update PRS-managed issue #${issueNumber} in GitHub with this refined specification? [Y/n/m]: `
      : "Create a linked PRS-managed issue from this refined specification? [Y/n/m]: ",
    emptyContentMessage: "Issue refine draft cannot be empty.",
    editorDescription: "issue refine draft",
    promptForLine,
    validate: (content) => {
      parseIssueDraftDocument(content);
    },
  });

  if (!reviewedDraft) {
    persistIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtime.type,
      workspace,
      resolvedSessionId,
      {
        mode: "kept-on-disk",
      }
    );
    console.log(
      `Refined draft kept at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
    return;
  }

  const parsedDraft = parseIssueDraftDocument(reviewedDraft.content);

  if (managedSourceIssue) {
    const updatedIssue = await forge.updateIssue(
      issueNumber,
      parsedDraft.title,
      ensurePrsManagedIssueBody(parsedDraft.body)
    );
    persistIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtime.type,
      workspace,
      resolvedSessionId,
      {
        mode: "updated-existing",
        issueNumber: updatedIssue.number,
        issueUrl: updatedIssue.url,
      }
    );
    console.log(`Updated issue: ${updatedIssue.url}`);
    if (shouldUseCodexSuperpowers) {
      await publishSuperpowersPlanArtifact({
        repoRoot,
        forge,
        issueNumber: updatedIssue.number,
        planFilePath: workspace.superpowersPlanFilePath,
        outputLogPath: workspace.outputLogPath,
      });
    }
    return;
  }

  const linkedIssue = parseCreatedIssueUrl(
    await forge.createDraftIssue(
      parsedDraft.title,
      buildLinkedPrsManagedIssueBody(issueNumber, parsedDraft.body)
    )
  );
  persistIssueRefineSessionState(
    repoRoot,
    issueNumber,
    runtime.type,
    workspace,
    resolvedSessionId,
    {
      mode: "created-linked",
      issueNumber: linkedIssue.issueNumber,
      issueUrl: linkedIssue.issueUrl,
    }
  );
  console.log(`Created linked issue: ${linkedIssue.issueUrl}`);
  if (shouldUseCodexSuperpowers) {
    await publishSuperpowersPlanArtifact({
      repoRoot,
      forge,
      issueNumber: linkedIssue.issueNumber,
      planFilePath: workspace.superpowersPlanFilePath,
      outputLogPath: workspace.outputLogPath,
    });
  }
}

type IssuePlanResolutionMode = "explicit-plan-command" | "execution-preflight";

function buildIssuePlanRuntimePrompt(input: {
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
    "- do not create or update GitHub issues or comments directly",
    "- do not modify unrelated repository files",
    "- do not modify `.prs/` except for the provided local workflow artifacts",
    "",
    "When the plan artifact is complete and saved, stop.",
  ].join("\n");
}

function writeIssuePlanWorkspaceFiles(
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

function shouldUseSuperpowersIssuePlan(options: {
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

async function createStructuredIssuePlanComment(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  issue: IssueDetails;
  existingPlanComment?: IssuePlanComment;
  mode: IssuePlanResolutionMode;
}): Promise<IssuePlanComment> {
  const { provider } = await createProvider(options.repoRoot);
  const plan = await generateIssueResolutionPlan(provider, {
    issueNumber: options.issueNumber,
    issueTitle: options.issue.title,
    issueBody: options.issue.body,
    issueUrl: options.issue.url,
  });
  const renderedPlan = renderIssueResolutionPlanComment(options.issueNumber, plan);

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

async function createSuperpowersIssuePlanComment(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  issue: IssueDetails;
  existingPlanComment?: IssuePlanComment;
  mode: IssuePlanResolutionMode;
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
  if (options.mode === "execution-preflight") {
    launchUnattendedRuntime("codex", options.repoRoot, workspace);
  } else {
    const runtime = getInteractiveRuntimeByType("codex");
    runtime.launch(options.repoRoot, workspace);
  }

  const comment = await publishSuperpowersPlanArtifact({
    repoRoot: options.repoRoot,
    forge: options.forge,
    issueNumber: options.issueNumber,
    planFilePath: workspace.superpowersPlanFilePath,
    outputLogPath: workspace.outputLogPath,
    existingPlanComment: options.existingPlanComment ?? null,
  });

  if (!comment) {
    console.log(
      "Codex Superpowers did not produce a non-empty issue plan artifact; using structured provider issue plan generation."
    );
  }

  return comment;
}

async function resolveIssuePlanComment(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  refresh: boolean;
  mode: IssuePlanResolutionMode;
  issue?: IssueDetails;
  runtimeType?: InteractiveRuntimeType;
}): Promise<IssuePlanComment> {
  const existingPlanComment = await options.forge.fetchIssuePlanComment(
    options.issueNumber
  );

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
  });
}

async function runIssuePlanCommand(
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

async function prepareIssueRun(
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
  ensureCleanWorkingTree(repoRoot);
  console.log(`Fetching issue #${issueNumber}...`);
  const issue = await forge.fetchIssueDetails(issueNumber);
  const sessionStateFilePath = getIssueSessionStateFilePath(repoRoot, issueNumber);
  const resolvePlanCommentForRun = () =>
    resolveIssuePlanComment({
      repoRoot,
      forge,
      issueNumber,
      refresh: false,
      mode: "execution-preflight",
      issue,
      runtimeType: runtime.type,
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

async function finalizeIssueRun(
  repoRoot: string,
  issueNumber: number,
  provider: AIProvider,
  runDir?: string
): Promise<FinalizeIssueRunResult> {
  const proposal = await generateDiffBasedCommitProposal(
    repoRoot,
    provider,
    readIssueWorkflowDiff
  );
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

function requireCodexForUnattendedIssueRuns(
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

async function runUnattendedIssueCommand(
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

  const { provider, providerType } = await createProvider(repoRoot);
  let finalized: Awaited<ReturnType<typeof finalizeIssueRunUnattended>>;
  try {
    finalized = await finalizeIssueRunUnattended(
      repoRoot,
      context.issueNumber,
      provider,
      context.workspace.runDir
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
  const pullRequest = await generateIssuePullRequest(provider, {
    repoRoot,
    issueNumber: context.issueNumber,
    issue: context.issue,
    diff: finalized.diff,
    commitMessage: finalized.commitMessage,
    overlapDecision: context.overlapDecision,
    runDir: context.workspace.runDir,
  });
  updateIssueWorkspaceMetadata(context.workspace, (currentMetadata) => ({
    ...currentMetadata,
    provider: {
      type: providerType,
    },
  }));

  console.log("Pushing branch and opening a pull request...");
  const createdPullRequest = await forge.createPullRequest({
    branchName: context.branchName,
    baseBranch: context.baseBranch,
    title: pullRequest.title,
    body: pullRequest.body,
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

function createIssueNoChangesOutcome(
  context: IssueRunContext,
  runDir: string
): IssueRunOutcomeSummary {
  return {
    issueNumber: context.issueNumber,
    branchName: context.branchName,
    baseBranch: context.baseBranch,
    runDir,
    committed: false,
    pullRequest: {
      status: "skipped",
      reason: "no-changes",
    },
  };
}

function getIssueBatchWorktreePath(
  repoRoot: string,
  issueNumbers: number[],
  issueNumber: number
): string {
  return resolve(
    repoRoot,
    ".prs",
    "worktrees",
    createIssueBatchKey(issueNumbers),
    `issue-${issueNumber}`
  );
}

function copyLocalWorkflowFileToWorktree(
  repoRoot: string,
  worktreePath: string,
  relativePath: string
): void {
  const sourcePath = resolve(repoRoot, relativePath);
  if (!existsSync(sourcePath)) {
    return;
  }

  const targetPath = resolve(worktreePath, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

function copyLocalWorkflowConfigToWorktree(repoRoot: string, worktreePath: string): void {
  copyLocalWorkflowFileToWorktree(repoRoot, worktreePath, ".prs/config.json");
  copyLocalWorkflowFileToWorktree(repoRoot, worktreePath, ".env");
}

function ensureIssueBatchWorktree(
  repoRoot: string,
  issueNumbers: number[],
  issueNumber: number,
  baseBranch: string
): string {
  const worktreePath = getIssueBatchWorktreePath(repoRoot, issueNumbers, issueNumber);

  if (existsSync(worktreePath)) {
    const worktreeRoot = runCommand(
      "git",
      ["-C", worktreePath, "rev-parse", "--show-toplevel"],
      `Existing issue worktree at ${worktreePath} is not a usable git worktree.`
    );
    if (resolve(worktreeRoot) !== resolve(worktreePath)) {
      throw new Error(
        `Existing issue worktree path ${worktreePath} resolves to ${worktreeRoot}; remove it or choose a fresh issue batch.`
      );
    }
    copyLocalWorkflowConfigToWorktree(repoRoot, worktreePath);
    return worktreePath;
  }

  mkdirSync(dirname(worktreePath), { recursive: true });
  runInteractiveCommand(
    "git",
    ["worktree", "add", "--detach", worktreePath, `origin/${baseBranch}`],
    `Failed to create worktree for issue #${issueNumber}.`,
    repoRoot
  );
  copyLocalWorkflowConfigToWorktree(repoRoot, worktreePath);
  return worktreePath;
}

function toBatchRelativePath(repoRoot: string, worktreePath: string, pathValue: string): string {
  const absolutePath = isAbsolute(pathValue) ? pathValue : resolve(worktreePath, pathValue);
  return toRepoRelativePath(repoRoot, absolutePath);
}

function readIssueBatchSessionDetails(
  repoRoot: string,
  worktreePath: string,
  issueNumber: number
): { branchName?: string; runDir?: string } {
  const sessionState = loadIssueSessionState(worktreePath, issueNumber);
  if (!sessionState) {
    return {};
  }

  return {
    branchName: sessionState.branchName,
    runDir: toBatchRelativePath(repoRoot, worktreePath, sessionState.runDir),
  };
}

function isIssuePullRequestOutcome(value: unknown): value is IssuePullRequestOutcome {
  if (!value || typeof value !== "object") {
    return false;
  }

  const status = (value as { status?: unknown }).status;
  if (status === "created") {
    return (
      typeof (value as { title?: unknown }).title === "string" &&
      ((value as { url?: unknown }).url === undefined ||
        typeof (value as { url?: unknown }).url === "string")
    );
  }

  if (status === "manual") {
    return (
      typeof (value as { titleFilePath?: unknown }).titleFilePath === "string" &&
      typeof (value as { bodyFilePath?: unknown }).bodyFilePath === "string"
    );
  }

  if (status === "skipped") {
    const reason = (value as { reason?: unknown }).reason;
    return (
      reason === "commit-declined" ||
      reason === "no-changes" ||
      reason === "forge-disabled"
    );
  }

  return false;
}

function readIssueRunResultFromWorktree(
  repoRoot: string,
  worktreePath: string,
  issueNumber: number
): UnattendedIssueRunResult {
  const sessionState = loadIssueSessionState(worktreePath, issueNumber);
  if (!sessionState) {
    throw new Error(`Issue #${issueNumber} completed without writing session state.`);
  }

  const metadataPath = resolve(worktreePath, sessionState.runDir, "metadata.json");
  if (!existsSync(metadataPath)) {
    throw new Error(`Issue #${issueNumber} completed without writing run metadata.`);
  }

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
    outcome?: Partial<IssueRunOutcomeSummary>;
  };
  const outcome = metadata.outcome;
  if (
    !outcome ||
    outcome.issueNumber !== issueNumber ||
    typeof outcome.branchName !== "string" ||
    typeof outcome.runDir !== "string" ||
    typeof outcome.committed !== "boolean" ||
    !isIssuePullRequestOutcome(outcome.pullRequest)
  ) {
    throw new Error(`Issue #${issueNumber} completed without a valid recorded outcome.`);
  }

  return {
    branchName: outcome.branchName,
    runDir: toBatchRelativePath(repoRoot, worktreePath, outcome.runDir),
    committed: outcome.committed,
    pullRequest: outcome.pullRequest,
  };
}

type IssueBatchChildResult = {
  issueNumber: number;
  worktreePath: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

function runIssueBatchChild(
  issueNumber: number,
  worktreePath: string
): Promise<IssueBatchChildResult> {
  const cliEntrypoint = process.argv[1];
  if (!cliEntrypoint) {
    throw new Error("Cannot locate the prs CLI entrypoint for multi-issue execution.");
  }

  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [cliEntrypoint, "issue", String(issueNumber), "--mode", "unattended"],
      {
        cwd: worktreePath,
        env: {
          ...process.env,
          GIT_AI_DISABLE_AUTO_RUN: "0",
          PRS_ISSUE_WORKTREE_BASE_READY: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let spawnError: Error | undefined;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (exitCode, signal) => {
      resolvePromise({
        issueNumber,
        worktreePath,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        error: spawnError,
      });
    });
  });
}

function summarizeIssueBatchChildFailure(result: IssueBatchChildResult): string {
  if (result.error) {
    return result.error.message;
  }

  const output = [result.stdout, result.stderr]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = output.at(-1);
  if (lastLine) {
    return lastLine;
  }

  if (result.signal) {
    return `Issue process exited after signal ${result.signal}.`;
  }

  return `Issue process exited with code ${result.exitCode ?? "unknown"}.`;
}

async function runIssueBatchCommand(issueNumbers: number[]): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const repositoryConfig = getRepositoryConfig(repoRoot);
  requireCodexForUnattendedIssueRuns(repositoryConfig);
  const forge = getRepositoryForge(repoRoot);
  if (!forge.isAuthenticated()) {
    throw new Error(
      "Multi-issue runs require authenticated GitHub access so prs can open pull requests automatically."
    );
  }
  preflightIssueBaseBranch(repoRoot, repositoryConfig.baseBranch);

  const workspace = createIssueBatchWorkspace(repoRoot, issueNumbers);
  let state =
    loadIssueBatchState(repoRoot, issueNumbers) ??
    createInitialIssueBatchState(issueNumbers, workspace);
  state = updateIssueBatchState(repoRoot, issueNumbers, state, workspace, (currentState) => ({
    ...currentState,
    latestRunDir: toRepoRelativePath(repoRoot, workspace.runDir),
  }));

  const issueRuns: Array<{ issueNumber: number; worktreePath: string }> = [];

  for (let index = 0; index < issueNumbers.length; index += 1) {
    const issueNumber = issueNumbers[index];
    const issueState = state.issues.find((entry) => entry.issueNumber === issueNumber);
    if (!issueState) {
      throw new Error(`Missing batch state for issue #${issueNumber}.`);
    }

    if (issueState.status === "completed") {
      const skipMessage = `[${index + 1}/${issueNumbers.length}] Skipping completed issue #${issueNumber}.`;
      console.log(skipMessage);
      appendIssueBatchLog(workspace, skipMessage);
      continue;
    }

    const worktreePath = ensureIssueBatchWorktree(
      repoRoot,
      issueNumbers,
      issueNumber,
      repositoryConfig.baseBranch
    );
    const relativeWorktreePath = toRepoRelativePath(repoRoot, worktreePath);
    const startMessage = `[${index + 1}/${issueNumbers.length}] Starting issue #${issueNumber} in ${relativeWorktreePath}.`;
    console.log(startMessage);
    appendIssueBatchLog(workspace, startMessage);
    const now = new Date().toISOString();
    state = updateIssueBatchState(
      repoRoot,
      issueNumbers,
      state,
      workspace,
      (currentState) => ({
        ...currentState,
        stoppedIssueNumber: undefined,
        issues: currentState.issues.map((entry) =>
          entry.issueNumber !== issueNumber
            ? entry
            : {
                ...entry,
                status: "running",
                worktreePath: relativeWorktreePath,
                error: undefined,
                attempts: [
                  ...entry.attempts,
                  {
                    startedAt: now,
                    updatedAt: now,
                    status: "running",
                    worktreePath: relativeWorktreePath,
                  },
                ],
              }
        ),
      })
    );
    issueRuns.push({ issueNumber, worktreePath });
  }

  const childResults = await Promise.all(
    issueRuns.map((issueRun) =>
      runIssueBatchChild(issueRun.issueNumber, issueRun.worktreePath)
    )
  );
  const failures: string[] = [];

  for (const childResult of childResults) {
    const { issueNumber, worktreePath } = childResult;
    appendIssueBatchLog(
      workspace,
      [
        `# Output for issue #${issueNumber}`,
        childResult.stdout.trim(),
        childResult.stderr.trim(),
        "",
      ]
        .filter((line) => line.length > 0)
        .join("\n")
    );

    if (!childResult.error && childResult.exitCode === 0) {
      try {
        const result = readIssueRunResultFromWorktree(
          repoRoot,
          worktreePath,
          issueNumber
        );
        const resultPrUrl =
          result.pullRequest.status === "created" ? result.pullRequest.url : undefined;
        const successMessage =
          result.pullRequest.status === "created" && result.pullRequest.url
            ? `Completed issue #${issueNumber}: ${result.pullRequest.url}`
            : result.pullRequest.status === "skipped"
              ? `Completed issue #${issueNumber}: skipped (${result.pullRequest.reason})`
              : `Completed issue #${issueNumber}.`;
        console.log(successMessage);
        appendIssueBatchLog(workspace, successMessage);
        state = updateIssueBatchState(
          repoRoot,
          issueNumbers,
          state,
          workspace,
          (currentState) => ({
            ...currentState,
            stoppedIssueNumber: undefined,
            issues: currentState.issues.map((entry) =>
              entry.issueNumber !== issueNumber
                ? entry
                : {
                    ...entry,
                    status: "completed",
                    worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                    branchName: result.branchName,
                    runDir: result.runDir,
                    prUrl: resultPrUrl,
                    pullRequest: result.pullRequest,
                    error: undefined,
                    attempts:
                      entry.attempts.length === 0
                        ? [
                            {
                              startedAt: new Date().toISOString(),
                              updatedAt: new Date().toISOString(),
                              status: "completed",
                              worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                              branchName: result.branchName,
                              runDir: result.runDir,
                              prUrl: resultPrUrl,
                              pullRequest: result.pullRequest,
                            },
                          ]
                        : entry.attempts.map((attempt, attemptIndex) =>
                            attemptIndex === entry.attempts.length - 1
                              ? {
                                  ...attempt,
                                  updatedAt: new Date().toISOString(),
                                  status: "completed",
                                  worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                                  branchName: result.branchName,
                                  runDir: result.runDir,
                                  prUrl: resultPrUrl,
                                  pullRequest: result.pullRequest,
                                  error: undefined,
                                }
                              : attempt
                          ),
                  }
            ),
          })
        );
        continue;
      } catch (error: unknown) {
        childResult.error = error instanceof Error ? error : new Error(String(error));
      }
    }

    const message = summarizeIssueBatchChildFailure(childResult);
    failures.push(`#${issueNumber}: ${message}`);
    const sessionDetails = readIssueBatchSessionDetails(
      repoRoot,
      worktreePath,
      issueNumber
    );
    const failureMessage = `Issue #${issueNumber} failed: ${message}`;
    console.log(failureMessage);
    appendIssueBatchLog(workspace, failureMessage);
    state = updateIssueBatchState(
      repoRoot,
      issueNumbers,
      state,
      workspace,
      (currentState) => ({
        ...currentState,
        stoppedIssueNumber: currentState.stoppedIssueNumber ?? issueNumber,
        issues: currentState.issues.map((entry) =>
          entry.issueNumber !== issueNumber
            ? entry
            : {
                ...entry,
                status: "failed",
                worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                branchName: sessionDetails.branchName ?? entry.branchName,
                runDir: sessionDetails.runDir ?? entry.runDir,
                error: message,
                attempts:
                  entry.attempts.length === 0
                    ? [
                        {
                          startedAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                          status: "failed",
                          worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                          branchName: sessionDetails.branchName,
                          runDir: sessionDetails.runDir,
                          error: message,
                        },
                      ]
                    : entry.attempts.map((attempt, attemptIndex) =>
                        attemptIndex === entry.attempts.length - 1
                          ? {
                              ...attempt,
                              updatedAt: new Date().toISOString(),
                              status: "failed",
                              worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                              branchName: sessionDetails.branchName ?? attempt.branchName,
                              runDir: sessionDetails.runDir ?? attempt.runDir,
                              error: message,
                            }
                          : attempt
                      ),
              }
        ),
      })
    );
  }

  if (failures.length > 0) {
    throw new Error(`One or more issue runs failed: ${failures.join("; ")}`);
  }
}

async function runIssueCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const args = getCliArgs();
  const issueCommand = parseIssueCommandArgs(args);

  if (issueCommand.action === "draft") {
    await runIssueDraftCommand(issueCommand);
    return;
  }

  if (issueCommand.action === "plan") {
    await runIssuePlanCommand(issueCommand.issueNumber, {
      refresh: issueCommand.refresh,
    });
    return;
  }

  if (issueCommand.action === "refine") {
    await runIssueRefineCommand(issueCommand.issueNumber);
    return;
  }

  if (issueCommand.action === "batch") {
    await runIssueBatchCommand(issueCommand.issueNumbers);
    return;
  }

  if (issueCommand.action === "prepare") {
    const context = await prepareIssueRun(
      issueCommand.issueNumber,
      issueCommand.mode
    );
    emitIssuePrepareOutputs(repoRoot, context);
    process.stdout.write(
      `${JSON.stringify(
        {
          issueNumber: context.issueNumber,
          issueTitle: context.issue.title,
          issueUrl: context.issue.url,
          branchName: context.branchName,
          runtimeType: context.runtime.type,
          issueFile: toRepoRelativePath(repoRoot, context.workspace.issueFilePath),
          promptFile: toRepoRelativePath(repoRoot, context.workspace.promptFilePath),
          metadataFile: toRepoRelativePath(repoRoot, context.workspace.metadataFilePath),
          outputLog: toRepoRelativePath(repoRoot, context.workspace.outputLogPath),
          runDir: toRepoRelativePath(repoRoot, context.workspace.runDir),
          mode: context.mode,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (issueCommand.action === "finalize") {
    const { provider } = await createProvider(repoRoot);
    await finalizeIssueRun(repoRoot, issueCommand.issueNumber, provider);
    return;
  }

  if (issueCommand.mode === "unattended") {
    await runUnattendedIssueCommand(issueCommand.issueNumber);
    return;
  }

  const repositoryConfig = getRepositoryConfig(repoRoot);
  const selectedRuntime = selectInteractiveRuntime(repositoryConfig.ai.runtime, {
    onFallback: (message) => {
      console.log(message);
    },
  });
  const context = await prepareIssueRun(issueCommand.issueNumber, "local", {
    allowResume: true,
    runtimeType: selectedRuntime.type,
  });
  const forge = getRepositoryForge(repoRoot);
  const runtime = getInteractiveRuntimeByType(selectedRuntime.type);
  const relativeRunDir = toRepoRelativePath(repoRoot, context.workspace.runDir);

  console.log(`Prepared issue branch ${context.branchName}.`);
  console.log(`Issue run artifacts: ${relativeRunDir}`);
  console.log(
    context.runtime.invocation === "resume"
      ? `Resuming the saved interactive ${runtime.displayName} session in this terminal...`
      : `Opening an interactive ${runtime.displayName} session in this terminal...`
  );
  console.log(`Complete the issue work in ${runtime.displayName}.`);
  console.log(
    `When ${runtime.displayName} exits, prs will resume with build and commit steps.`
  );
  const runtimeLaunch = runtime.launch(repoRoot, context.workspace, {
    resumeSessionId: context.runtime.sessionId,
  });
  console.log(`${runtime.displayName} exited; handing control back to prs.`);
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

  const { provider, providerType } = await createProvider(repoRoot);
  let finalized: FinalizeIssueRunResult;
  try {
    finalized = await finalizeIssueRun(
      repoRoot,
      context.issueNumber,
      provider,
      context.workspace.runDir
    );
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.message !== ISSUE_RUN_NO_CHANGES_MESSAGE) {
      throw error;
    }

    const outcome: IssueRunOutcomeSummary = {
      issueNumber: context.issueNumber,
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      runDir: relativeRunDir,
      committed: false,
      pullRequest: {
        status: "skipped",
        reason: "no-changes",
      },
    };
    recordIssueRunOutcome(context.workspace, outcome);
    console.log(ISSUE_RUN_NO_CHANGES_MESSAGE);
    printIssueRunOutcomeSummary(outcome);
    return;
  }
  if (!finalized.committed) {
    const outcome: IssueRunOutcomeSummary = {
      issueNumber: context.issueNumber,
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      runDir: relativeRunDir,
      committed: false,
      pullRequest: {
        status: "skipped",
        reason: "commit-declined",
      },
    };
    recordIssueRunOutcome(context.workspace, outcome);
    console.log("Skipping pull request creation because no commit was created.");
    printIssueRunOutcomeSummary(outcome);
    return;
  }

  const pullRequest = await generateIssuePullRequest(provider, {
    repoRoot,
    issueNumber: context.issueNumber,
    issue: context.issue,
    diff: finalized.diff,
    commitMessage: finalized.commitMessage,
    overlapDecision: context.overlapDecision,
    runDir: context.workspace.runDir,
  });
  updateIssueWorkspaceMetadata(context.workspace, (currentMetadata) => ({
    ...currentMetadata,
    provider: {
      type: providerType,
    },
  }));

  if (forge.isAuthenticated()) {
    console.log("Pushing branch and opening a pull request...");
    const createdPullRequest = await forge.createPullRequest({
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      title: pullRequest.title,
      body: pullRequest.body,
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
      runDir: relativeRunDir,
      committed: true,
      pullRequest: {
        status: "created",
        title: pullRequest.title,
        url: createdPullRequest.url,
      },
    };
    recordIssueRunOutcome(context.workspace, outcome);
    printIssueRunOutcomeSummary(outcome);
    return;
  }

  if (forge.type === "github") {
    const titleFilePath =
      pullRequest.titleFilePath ?? resolve(context.workspace.runDir, "pull-request-title.txt");
    const bodyFilePath =
      pullRequest.bodyFilePath ?? resolve(context.workspace.runDir, "pull-request-body.md");
    printManualPrInstructions(
      repoRoot,
      context.branchName,
      context.baseBranch,
      titleFilePath,
      bodyFilePath
    );
    const outcome: IssueRunOutcomeSummary = {
      issueNumber: context.issueNumber,
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      runDir: relativeRunDir,
      committed: true,
      pullRequest: {
        status: "manual",
        titleFilePath: toRepoRelativePath(repoRoot, titleFilePath),
        bodyFilePath: toRepoRelativePath(repoRoot, bodyFilePath),
      },
    };
    recordIssueRunOutcome(context.workspace, outcome);
    printIssueRunOutcomeSummary(outcome);
    return;
  }

  const outcome: IssueRunOutcomeSummary = {
    issueNumber: context.issueNumber,
    branchName: context.branchName,
    baseBranch: context.baseBranch,
    runDir: relativeRunDir,
    committed: true,
    pullRequest: {
      status: "skipped",
      reason: "forge-disabled",
    },
  };
  recordIssueRunOutcome(context.workspace, outcome);
  printIssueRunOutcomeSummary(outcome);
  console.log(
    "Pull request creation skipped because repository forge support is disabled by .prs/config.json."
  );
}

export async function run(): Promise<void> {
  const args = getCliArgs();
  const firstArg = args[0];
  if (getInvokedCommandName() === LEGACY_PRODUCT_SHORT_NAME) {
    console.warn(GIT_AI_ALIAS_DEPRECATION_MESSAGE);
  }

  if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
    process.stdout.write(`${TOP_LEVEL_HELP}\n`);
    return;
  }

  const command = args[0] ?? "commit";
  if (
    command !== "commit" &&
    command !== "diff" &&
    command !== "setup" &&
    command !== "update" &&
    command !== "audit" &&
    command !== "issue" &&
    command !== "pr" &&
    command !== "codex" &&
    command !== "tool" &&
    command !== "review" &&
    command !== "test-backlog" &&
    command !== "feature-backlog"
  ) {
    throw new Error(`Unknown command: ${command}.\n\n${TOP_LEVEL_HELP}`);
  }

  warnIfManagedCodexSkillsAreStale(command);
  emitLaunchStageNotice(args);

  if (command === "commit") {
    const diff = readStagedDiff();
    const { provider } = await createProvider();
    const result = await generateCommitMessage(provider, diff);
    process.stdout.write(formatCommitMessage(result.title, result.body));
    return;
  }

  if (command === "issue") {
    await runIssueCommand();
    return;
  }

  if (command === "setup") {
    const setupCommand = parseSetupCommandArgs(args);
    if (setupCommand.updateSkills) {
      logManagedCodexSkillsRefreshResult(refreshManagedCodexSkills());
      return;
    }

    await runSetupCommand({
      repoRoot: getDefaultRepoRoot(),
      promptForLine,
    });
    return;
  }

  if (command === "update") {
    await runUpdateCommand();
    return;
  }

  if (command === "audit") {
    await runAuditCommand();
    return;
  }

  if (command === "pr") {
    await runPrCommand();
    return;
  }

  if (command === "codex") {
    await runCodexCommand();
    return;
  }

  if (command === "tool") {
    await runToolCommand();
    return;
  }

  if (command === "review") {
    await runReviewCommand();
    return;
  }

  if (command === "test-backlog") {
    await runTestBacklogCommand();
    return;
  }

  if (command === "feature-backlog") {
    await runFeatureBacklogCommand();
    return;
  }

  const diff = readHeadDiff();
  const { provider } = await createProvider();
  const result = await generateDiffSummary(provider, { diff });
  process.stdout.write(formatDiffSummary(result));
}

if (process.env.GIT_AI_DISABLE_AUTO_RUN !== "1") {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
