#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  analyzeFeatureBacklog,
  analyzeTestBacklog,
  buildPRAssistantSection,
  filterRepositoryPaths,
  generateCommitMessage,
  generateDiffSummary,
  generatePRReview,
  generateIssueResolutionPlan,
  generatePRAssistant,
  generatePRDescription,
  mergePRAssistantSection,
  StructuredGenerationError,
} from "@git-ai/core";
import {
  createProviderFromConfig,
  type AIProvider,
  readProviderEnvironment,
} from "@git-ai/providers";
import type { ResolvedRepositoryConfigType } from "@git-ai/contracts";
import dotenv from "dotenv";
import {
  formatCommandForDisplay,
  loadResolvedRepositoryConfig,
} from "./config";
import { buildDoneStateInstructions } from "./done-state";
import {
  formatLaunchStageNotice,
  type LaunchStageNoticeId,
} from "./launch-stage";
import {
  parsePrCommandArgs as parsePrCommandArgsImpl,
  type PrCommandOptions,
} from "./commands/pr";
import {
  createRepositoryForge,
  type CreatedIssueRecord,
  type IssueDetails,
  type IssuePlanComment,
  type RepositoryForge,
} from "./forge";
import {
  printGeneratedTextPreview,
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
  launchUnattendedRuntime,
  selectInteractiveRuntime,
  type InteractiveRuntimeType,
} from "./runtime";
import {
  formatRunTimestamp,
  getIssueBatchRunDir,
  getIssueBatchStateDir,
  getIssueBatchStateFilePath,
  getIssueSessionStateFilePath,
  getIssueStateDir,
  toRepoRelativePath,
} from "./run-artifacts";
import { parseSetupCommandArgs, runSetupCommand } from "./setup";
import { runPrFixCommentsCommand } from "./workflows/pr-fix-comments/run";
import { runPrPrepareReviewCommand } from "./workflows/pr-prepare-review/run";
import { runPrFixTestsCommand } from "./workflows/pr-fix-tests/run";

export { parseSetupCommandArgs };

type IssueWorkspace = {
  issueDir: string;
  issueFilePath: string;
  runDir: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
};

type IssueWorkspaceMode = "local" | "github-action" | "unattended";
type IssueRunMode = "interactive" | "unattended";
type IssuePrepareMode = "local" | "github-action";
type IssueDraftWorkspace = {
  runDir: string;
  draftFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
};

type IssueCommandOptions =
  | {
      action: "run";
      issueNumber: number;
      mode: IssueRunMode;
    }
  | {
      action: "batch";
      issueNumbers: number[];
      mode: "unattended";
    }
  | {
      action: "prepare";
      issueNumber: number;
      mode: IssuePrepareMode;
    }
  | {
      action: "finalize" | "plan";
      issueNumber: number;
      mode: "local";
    }
  | {
      action: "draft";
    };

type GeneratedIssueResolutionPlan = Awaited<
  ReturnType<typeof generateIssueResolutionPlan>
>;

type BacklogOutputFormat = "json" | "markdown";

type ReviewOutputFormat = "json" | "markdown";

type ReviewCommandOptions = {
  base?: string;
  head?: string;
  format: ReviewOutputFormat;
  issueNumber?: number;
};

type TestBacklogCommandOptions = {
  repoRoot: string;
  format: BacklogOutputFormat;
  top: number;
  createIssues: boolean;
  maxIssues: number;
  labels: string[];
};

type FeatureBacklogCommandOptions = {
  repoRoot: string;
  format: BacklogOutputFormat;
  top: number;
  createIssues: boolean;
  maxIssues: number;
  labels: string[];
};

type IssueRunContext = {
  issueNumber: number;
  issue: IssueDetails;
  planComment?: IssuePlanComment;
  branchName: string;
  workspace: IssueWorkspace;
  mode: IssueWorkspaceMode;
  runtime: {
    type: InteractiveRuntimeType;
    invocation: "new" | "resume";
    sessionId?: string;
    sessionStateFilePath: string;
  };
};

type IssueSessionState = {
  issueNumber: number;
  runtimeType: InteractiveRuntimeType;
  branchName: string;
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

type IssueBatchStatus = "pending" | "running" | "completed" | "failed";

type IssueBatchAttempt = {
  startedAt: string;
  updatedAt: string;
  status: IssueBatchStatus;
  runDir?: string;
  branchName?: string;
  prUrl?: string;
  error?: string;
};

type IssueBatchIssueState = {
  issueNumber: number;
  status: IssueBatchStatus;
  runDir?: string;
  branchName?: string;
  prUrl?: string;
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
  prUrl?: string;
};

const ISSUE_PLAN_COMMENT_MARKER = "<!-- git-ai:issue-plan -->";

const ISSUE_USAGE = [
  "Usage:",
  "  git-ai issue <number> [--mode <interactive|unattended>]",
  "  git-ai issue batch <number> <number> [...number] [--mode unattended]",
  "  git-ai issue draft",
  "  git-ai issue plan <number>",
  "  git-ai issue prepare <number> [--mode <local|github-action>]",
  "  git-ai issue finalize <number>",
].join("\n");

const TEST_BACKLOG_USAGE = [
  "Usage:",
  "  git-ai test-backlog [--format <markdown|json>] [--top <count>]",
  "                       [--repo-root <path>] [--create-issues]",
  "                       [--max-issues <count>] [--label <name>] [--labels <a,b>]",
].join("\n");

const FEATURE_BACKLOG_USAGE = [
  "Usage:",
  "  git-ai feature-backlog [repo-path] [--format <markdown|json>] [--top <count>]",
  "                          [--create-issues] [--max-issues <count>]",
  "                          [--label <name>] [--labels <a,b>]",
].join("\n");

const REVIEW_USAGE = [
  "Usage:",
  "  git-ai review [--base <git-ref>] [--head <git-ref>] [--format <markdown|json>]",
  "                [--issue-number <number>]",
].join("\n");

const TOP_LEVEL_HELP = [
  "git-ai",
  "",
  "GitHub-first AI workflows for pull request review, follow-up fixes, and backlog discovery.",
  "",
  "Start here:",
  "  git-ai review",
  "  git-ai pr fix-comments <pr-number>",
  "  git-ai pr fix-tests <pr-number>",
  "  git-ai test-backlog [--top <count>]",
  "",
  "Advanced:",
  "  git-ai issue draft",
  "  git-ai issue plan <number>",
  "  git-ai issue <number> [--mode <interactive|unattended>]",
  "  git-ai issue prepare <number> [--mode <local|github-action>]",
  "  git-ai issue finalize <number>",
  "",
  "Beta:",
  "  git-ai issue batch <number> <number> [...number] [--mode unattended]",
  "  git-ai pr prepare-review <pr-number>",
  "  git-ai feature-backlog [repo-path]",
  "",
  "Supporting commands:",
  "  git-ai setup",
  "  git-ai commit",
  "  git-ai diff",
  "",
  "GitHub-only by design: forge-backed issue and pull request workflows currently target GitHub repositories.",
].join("\n");

function getCliArgs(): string[] {
  return process.argv.slice(2).filter((arg) => arg !== "--");
}

function getDefaultRepoRoot(): string {
  return resolveRuntimeRepoRoot();
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

function readIssueWorkflowDiff(repoRoot: string): string {
  return readGitDiff(
    ["diff", "HEAD"],
    "The interactive runtime completed without producing any file changes to commit.",
    "HEAD",
    "git diff HEAD requires at least one commit. Create an initial commit before finalizing issue work.",
    {
      excludePaths: getRepositoryConfig(repoRoot).aiContext.excludePaths,
      repoRoot,
    }
  );
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
      "Working tree is not clean. Commit or stash existing changes before running git-ai issue workflows."
    );
  }
}

function parseIssueNumber(rawValue: string | undefined): number {
  if (!rawValue) {
    throw new Error(`Missing issue number. ${ISSUE_USAGE}`);
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`Invalid issue number "${rawValue}". ${ISSUE_USAGE}`);
  }

  const issueNumber = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid issue number "${rawValue}". ${ISSUE_USAGE}`);
  }

  return issueNumber;
}

function parseIssueModeOption(rawArgs: string[]): string | undefined {
  let mode: string | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (rawArg === "--mode") {
      mode = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--mode=")) {
      mode = rawArg.slice("--mode=".length);
      continue;
    }

    throw new Error(`Unknown issue option "${rawArg}". ${ISSUE_USAGE}`);
  }

  return mode;
}

function parseIssueRunMode(rawArgs: string[]): IssueRunMode {
  const mode = parseIssueModeOption(rawArgs);
  if (mode === undefined) {
    return "interactive";
  }

  if (mode !== "interactive" && mode !== "unattended") {
    throw new Error(
      `Invalid issue mode "${mode}". Expected "interactive" or "unattended".`
    );
  }

  return mode;
}

function parseIssuePrepareMode(rawArgs: string[]): IssuePrepareMode {
  const mode = parseIssueModeOption(rawArgs);
  if (mode === undefined) {
    return "local";
  }

  if (mode !== "local" && mode !== "github-action") {
    throw new Error(
      `Invalid issue mode "${mode}". Expected "local" or "github-action".`
    );
  }

  return mode;
}

function parseIssueBatchArgs(rawArgs: string[]): {
  issueNumbers: number[];
  mode: "unattended";
} {
  const issueNumbers: number[] = [];
  let mode: string | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (rawArg === "--mode") {
      mode = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--mode=")) {
      mode = rawArg.slice("--mode=".length);
      continue;
    }

    if (rawArg.startsWith("--")) {
      throw new Error(`Unknown issue option "${rawArg}". ${ISSUE_USAGE}`);
    }

    issueNumbers.push(parseIssueNumber(rawArg));
  }

  if (mode !== undefined && mode !== "unattended") {
    if (mode === "interactive") {
      throw new Error(
        "Batch issue runs only support `--mode unattended`. Interactive batch mode is not supported."
      );
    }

    throw new Error(`Invalid issue mode "${mode}". Expected "unattended".`);
  }

  const uniqueIssueNumbers = [...new Set(issueNumbers)];
  if (uniqueIssueNumbers.length < 2) {
    throw new Error(
      `Batch issue runs require at least two issue numbers. ${ISSUE_USAGE}`
    );
  }

  if (uniqueIssueNumbers.length !== issueNumbers.length) {
    throw new Error("Batch issue runs do not support duplicate issue numbers.");
  }

  return {
    issueNumbers,
    mode: "unattended",
  };
}

export function parseIssueCommandArgs(args: string[]): IssueCommandOptions {
  const issueArgs = args.slice(1);
  const subcommand = issueArgs[0];

  if (subcommand === "draft") {
    if (issueArgs.length > 1) {
      throw new Error(`Unknown issue option "${issueArgs[1]}". ${ISSUE_USAGE}`);
    }

    return {
      action: "draft",
    };
  }

  if (subcommand === "batch") {
    const parsed = parseIssueBatchArgs(issueArgs.slice(1));
    return {
      action: "batch",
      issueNumbers: parsed.issueNumbers,
      mode: parsed.mode,
    };
  }

  if (subcommand === "prepare") {
    return {
      action: "prepare",
      issueNumber: parseIssueNumber(issueArgs[1]),
      mode: parseIssuePrepareMode(issueArgs.slice(2)),
    };
  }

  if (subcommand === "finalize") {
    const optionArgs = issueArgs.slice(2);
    if (optionArgs.length > 0) {
      throw new Error(`Unknown issue option "${optionArgs[0]}". ${ISSUE_USAGE}`);
    }

    return {
      action: "finalize",
      issueNumber: parseIssueNumber(issueArgs[1]),
      mode: "local",
    };
  }

  if (subcommand === "plan") {
    const optionArgs = issueArgs.slice(2);
    if (optionArgs.length > 0) {
      throw new Error(`Unknown issue option "${optionArgs[0]}". ${ISSUE_USAGE}`);
    }

    return {
      action: "plan",
      issueNumber: parseIssueNumber(issueArgs[1]),
      mode: "local",
    };
  }

  return {
    action: "run",
    issueNumber: parseIssueNumber(issueArgs[0]),
    mode: parseIssueRunMode(issueArgs.slice(1)),
  };
}

export function parsePrCommandArgs(args: string[]): PrCommandOptions {
  return parsePrCommandArgsImpl(args, parseIssueNumber);
}

function parsePositiveInteger(value: string | undefined, flagName: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`Invalid value for ${flagName}: "${value ?? ""}". Expected a positive integer.`);
  }

  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Invalid value for ${flagName}: "${value}". Expected a positive integer.`);
  }

  return parsedValue;
}

export function parseTestBacklogCommandArgs(args: string[]): TestBacklogCommandOptions {
  const optionArgs = args.slice(1);
  let repoRoot = getDefaultRepoRoot();
  let format: BacklogOutputFormat = "markdown";
  let top = 5;
  let createIssues = false;
  let maxIssues = 3;
  const labels = new Set<string>();

  for (let index = 0; index < optionArgs.length; index += 1) {
    const rawArg = optionArgs[index];

    if (rawArg === "--repo-root") {
      const rawRepoRoot = optionArgs[index + 1];
      if (!rawRepoRoot) {
        throw new Error(`Missing value for --repo-root. ${TEST_BACKLOG_USAGE}`);
      }
      repoRoot = resolve(process.cwd(), rawRepoRoot);
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--repo-root=")) {
      const rawRepoRoot = rawArg.slice("--repo-root=".length);
      if (!rawRepoRoot) {
        throw new Error(`Missing value for --repo-root. ${TEST_BACKLOG_USAGE}`);
      }
      repoRoot = resolve(process.cwd(), rawRepoRoot);
      continue;
    }

    if (rawArg === "--format") {
      const rawFormat = optionArgs[index + 1];
      if (rawFormat !== "json" && rawFormat !== "markdown") {
        throw new Error(`Invalid format "${rawFormat ?? ""}". ${TEST_BACKLOG_USAGE}`);
      }
      format = rawFormat;
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--format=")) {
      const rawFormat = rawArg.slice("--format=".length);
      if (rawFormat !== "json" && rawFormat !== "markdown") {
        throw new Error(`Invalid format "${rawFormat}". ${TEST_BACKLOG_USAGE}`);
      }
      format = rawFormat;
      continue;
    }

    if (rawArg === "--top") {
      top = parsePositiveInteger(optionArgs[index + 1], "--top");
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--top=")) {
      top = parsePositiveInteger(rawArg.slice("--top=".length), "--top");
      continue;
    }

    if (rawArg === "--create-issues") {
      createIssues = true;
      continue;
    }

    if (rawArg === "--max-issues") {
      maxIssues = parsePositiveInteger(optionArgs[index + 1], "--max-issues");
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--max-issues=")) {
      maxIssues = parsePositiveInteger(
        rawArg.slice("--max-issues=".length),
        "--max-issues"
      );
      continue;
    }

    if (rawArg === "--label") {
      const label = optionArgs[index + 1]?.trim();
      if (!label) {
        throw new Error(`Missing value for --label. ${TEST_BACKLOG_USAGE}`);
      }
      labels.add(label);
      index += 1;
      continue;
    }

    if (rawArg === "--labels") {
      const rawLabels = optionArgs[index + 1];
      if (!rawLabels) {
        throw new Error(`Missing value for --labels. ${TEST_BACKLOG_USAGE}`);
      }
      for (const label of rawLabels.split(",")) {
        const trimmed = label.trim();
        if (trimmed) {
          labels.add(trimmed);
        }
      }
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--labels=")) {
      for (const label of rawArg.slice("--labels=".length).split(",")) {
        const trimmed = label.trim();
        if (trimmed) {
          labels.add(trimmed);
        }
      }
      continue;
    }

    throw new Error(`Unknown test-backlog option "${rawArg}". ${TEST_BACKLOG_USAGE}`);
  }

  return {
    repoRoot,
    format,
    top,
    createIssues,
    maxIssues: Math.min(maxIssues, top),
    labels: [...labels],
  };
}

export function parseFeatureBacklogCommandArgs(args: string[]): FeatureBacklogCommandOptions {
  const optionArgs = args.slice(1);
  let repoRoot = getDefaultRepoRoot();
  let format: BacklogOutputFormat = "markdown";
  let top = 5;
  let createIssues = false;
  let maxIssues = 3;
  const labels = new Set<string>();
  let repoPathWasSet = false;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const rawArg = optionArgs[index];

    if (!rawArg.startsWith("-")) {
      if (repoPathWasSet) {
        throw new Error(`Unknown feature-backlog argument "${rawArg}". ${FEATURE_BACKLOG_USAGE}`);
      }

      repoRoot = resolve(rawArg);
      repoPathWasSet = true;
      continue;
    }

    if (rawArg === "--format") {
      const rawFormat = optionArgs[index + 1];
      if (rawFormat !== "json" && rawFormat !== "markdown") {
        throw new Error(`Invalid format "${rawFormat ?? ""}". ${FEATURE_BACKLOG_USAGE}`);
      }
      format = rawFormat;
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--format=")) {
      const rawFormat = rawArg.slice("--format=".length);
      if (rawFormat !== "json" && rawFormat !== "markdown") {
        throw new Error(`Invalid format "${rawFormat}". ${FEATURE_BACKLOG_USAGE}`);
      }
      format = rawFormat;
      continue;
    }

    if (rawArg === "--top") {
      top = parsePositiveInteger(optionArgs[index + 1], "--top");
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--top=")) {
      top = parsePositiveInteger(rawArg.slice("--top=".length), "--top");
      continue;
    }

    if (rawArg === "--create-issues") {
      createIssues = true;
      continue;
    }

    if (rawArg === "--max-issues") {
      maxIssues = parsePositiveInteger(optionArgs[index + 1], "--max-issues");
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--max-issues=")) {
      maxIssues = parsePositiveInteger(
        rawArg.slice("--max-issues=".length),
        "--max-issues"
      );
      continue;
    }

    if (rawArg === "--label") {
      const label = optionArgs[index + 1]?.trim();
      if (!label) {
        throw new Error(`Missing value for --label. ${FEATURE_BACKLOG_USAGE}`);
      }
      labels.add(label);
      index += 1;
      continue;
    }

    if (rawArg === "--labels") {
      const rawLabels = optionArgs[index + 1];
      if (!rawLabels) {
        throw new Error(`Missing value for --labels. ${FEATURE_BACKLOG_USAGE}`);
      }
      for (const label of rawLabels.split(",")) {
        const trimmed = label.trim();
        if (trimmed) {
          labels.add(trimmed);
        }
      }
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--labels=")) {
      for (const label of rawArg.slice("--labels=".length).split(",")) {
        const trimmed = label.trim();
        if (trimmed) {
          labels.add(trimmed);
        }
      }
      continue;
    }

    throw new Error(`Unknown feature-backlog option "${rawArg}". ${FEATURE_BACKLOG_USAGE}`);
  }

  return {
    repoRoot,
    format,
    top,
    createIssues,
    maxIssues: Math.min(maxIssues, top),
    labels: [...labels],
  };
}

export function parseReviewCommandArgs(args: string[]): ReviewCommandOptions {
  const optionArgs = args.slice(1);
  let base: string | undefined;
  let head: string | undefined;
  let format: ReviewOutputFormat = "markdown";
  let issueNumber: number | undefined;

  for (let index = 0; index < optionArgs.length; index += 1) {
    const rawArg = optionArgs[index];

    if (rawArg === "--base") {
      base = optionArgs[index + 1]?.trim();
      if (!base) {
        throw new Error(`Missing value for --base. ${REVIEW_USAGE}`);
      }
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--base=")) {
      base = rawArg.slice("--base=".length).trim();
      if (!base) {
        throw new Error(`Missing value for --base. ${REVIEW_USAGE}`);
      }
      continue;
    }

    if (rawArg === "--head") {
      head = optionArgs[index + 1]?.trim();
      if (!head) {
        throw new Error(`Missing value for --head. ${REVIEW_USAGE}`);
      }
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--head=")) {
      head = rawArg.slice("--head=".length).trim();
      if (!head) {
        throw new Error(`Missing value for --head. ${REVIEW_USAGE}`);
      }
      continue;
    }

    if (rawArg === "--format") {
      const rawFormat = optionArgs[index + 1];
      if (rawFormat !== "json" && rawFormat !== "markdown") {
        throw new Error(`Invalid format "${rawFormat ?? ""}". ${REVIEW_USAGE}`);
      }
      format = rawFormat;
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--format=")) {
      const rawFormat = rawArg.slice("--format=".length);
      if (rawFormat !== "json" && rawFormat !== "markdown") {
        throw new Error(`Invalid format "${rawFormat}". ${REVIEW_USAGE}`);
      }
      format = rawFormat;
      continue;
    }

    if (rawArg === "--issue-number") {
      issueNumber = parseIssueNumber(optionArgs[index + 1]);
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--issue-number=")) {
      issueNumber = parseIssueNumber(rawArg.slice("--issue-number=".length));
      continue;
    }

    throw new Error(`Unknown review option "${rawArg}". ${REVIEW_USAGE}`);
  }

  if (head && !base) {
    throw new Error(`--head requires --base. ${REVIEW_USAGE}`);
  }

  return {
    base,
    head,
    format,
    issueNumber,
  };
}

function resolveLaunchStageNoticeId(args: string[]): LaunchStageNoticeId | undefined {
  const command = args[0] ?? "commit";

  if (command === "feature-backlog") {
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
    return prCommand.action === "prepare-review" ? "pr-prepare-review" : undefined;
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
    `Generated by \`git-ai issue plan ${issueNumber}\`. Edit this comment directly on GitHub to refine the plan. Later \`git-ai issue\` runs will use the latest version of this comment.`,
    "",
    "### Summary",
    plan.summary,
    "",
    "### Implementation steps",
    formatNumberedMarkdownList(plan.implementationSteps),
    "",
    "### Validation",
    formatMarkdownList(plan.validationSteps),
  ];

  if (plan.risks && plan.risks.length > 0) {
    lines.push("", "### Risks", formatMarkdownList(plan.risks));
  }

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
  const issueDir = resolve(repoRoot, ".git-ai", "issues");
  const runDir = resolve(repoRoot, ".git-ai", "runs", `${timestamp}-issue-draft`);

  mkdirSync(issueDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    draftFilePath: resolve(issueDir, `issue-draft-${timestamp}.md`),
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
  };
}

function buildIssueDraftRuntimePrompt(
  repoRoot: string,
  workspace: IssueDraftWorkspace,
  featureIdea: string
): string {
  const draftFile = toRepoRelativePath(repoRoot, workspace.draftFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);

  return [
    "You are working in the current repository.",
    "",
    "The user wants to turn a rough idea into an implementation-ready GitHub issue draft.",
    "",
    "Rough idea:",
    featureIdea,
    "",
    `Write the final Markdown issue draft to \`${draftFile}\`.`,
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
    "- do not modify `.git-ai/` except for the provided draft file and local workflow artifacts",
    "",
    "When the draft is complete and saved, stop.",
  ].join("\n");
}

function writeIssueDraftWorkspaceFiles(
  repoRoot: string,
  featureIdea: string,
  workspace: IssueDraftWorkspace,
  runtimeType: InteractiveRuntimeType
): void {
  const createdAt = new Date().toISOString();
  const runtime = getInteractiveRuntimeByType(runtimeType);
  const prompt = buildIssueDraftRuntimePrompt(repoRoot, workspace, featureIdea);

  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        flow: "issue-draft",
        featureIdea,
        draftFile: toRepoRelativePath(repoRoot, workspace.draftFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        runtime: {
          type: runtime.type,
          displayName: runtime.displayName,
          command: runtime.metadata.command,
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
      "# git-ai issue draft run log",
      "",
      `Created: ${createdAt}`,
      `Runtime: ${runtime.displayName}`,
      `Draft file: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      "",
    ].join("\n"),
    "utf8"
  );
}

function loadIssueSessionState(
  repoRoot: string,
  issueNumber: number
): IssueSessionState | undefined {
  const stateFilePath = getIssueSessionStateFilePath(repoRoot, issueNumber);
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
      )} is malformed. Remove it and rerun \`git-ai issue ${issueNumber}\` to start a fresh session.`
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
    `Recovery: remove ${stateFile} and rerun \`git-ai issue ${issueNumber}\` to start a fresh session.`,
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
    resolve(repoRoot, ".git-ai", "issues", `${issueNumber}-${slug}`);
  const runDir = resolve(
    repoRoot,
    ".git-ai",
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
  const stateFilePath = getIssueBatchStateFilePath(repoRoot, issueNumbers);
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
    const details = [
      `#${issueState.issueNumber}`,
      issueState.status,
      issueState.branchName ? `branch ${issueState.branchName}` : undefined,
      issueState.runDir ? `run ${issueState.runDir}` : undefined,
      issueState.prUrl ? `PR ${issueState.prUrl}` : undefined,
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

function syncIssueBaseBranch(repoRoot: string, baseBranch: string): void {
  console.log(`Switching to base branch ${baseBranch}...`);
  runInteractiveCommand(
    "git",
    ["checkout", baseBranch],
    `Failed to switch to base branch "${baseBranch}".`,
    repoRoot
  );

  console.log(`Pulling latest changes for ${baseBranch}...`);
  runInteractiveCommand(
    "git",
    ["pull"],
    `Failed to pull latest changes for base branch "${baseBranch}".`,
    repoRoot
  );
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
            "You are running inside an unattended local git-ai issue workflow via Codex.",
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
    "- do not modify `.git-ai/` unless needed for local workflow artifacts",
    "- do not commit `.git-ai/` files",
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
      "# git-ai issue run log",
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
  if (!canRunCommand(buildCommand[0])) {
    throw new Error(`The \`${buildCommand[0]}\` CLI is not available on PATH.`);
  }

  runTrackedCommand(
    buildCommand[0],
    buildCommand.slice(1),
    "Build failed. Changes were not committed.",
    outputLogPath,
    repoRoot
  );
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

function createStandaloneIssueFinalizeRunDir(repoRoot: string, issueNumber: number): string {
  const runDir = resolve(
    repoRoot,
    ".git-ai",
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

function ensureIssueClosingReference(body: string, issueNumber: number): string {
  const trimmedBody = body.trim();
  if (new RegExp(`\\bcloses\\s+#${issueNumber}\\b`, "i").test(trimmedBody)) {
    return trimmedBody;
  }

  return `${trimmedBody}\n\nCloses #${issueNumber}`;
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

async function generateIssuePullRequest(
  provider: AIProvider,
  options: {
    repoRoot: string;
    issueNumber: number;
    issue: IssueDetails;
    diff: string;
    commitMessage: ReviewedGeneratedText;
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

  const body = mergePRAssistantSection(
    ensureIssueClosingReference(description.body, options.issueNumber),
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

function formatPRReviewMarkdown(
  review: Awaited<ReturnType<typeof generatePRReview>>,
  issue?: IssueDetails,
  issueNumber?: number
): string {
  const lines: string[] = [
    "# AI PR Review",
    "",
    "## Summary",
    review.summary,
  ];

  if (issue) {
    lines.push(
      "",
      "## Linked issue",
      `- ${issueNumber !== undefined ? `#${issueNumber}: ` : ""}[${issue.title}](${issue.url})`
    );
  }

  if (review.findings.length > 0) {
    lines.push("", "## Higher-level findings");

    for (const finding of review.findings) {
      lines.push(
        `- ${finding.title} (${toTitleCase(finding.severity)} ${finding.category}): ${finding.body}`
      );
      if (finding.relatedPaths && finding.relatedPaths.length > 0) {
        lines.push(`  Related paths: ${finding.relatedPaths.map((path) => `\`${path}\``).join(", ")}`);
      }
      if (finding.suggestion) {
        lines.push(`  Suggestion: ${finding.suggestion}`);
      }
    }
  }

  lines.push("", "## Line-level findings");

  if (review.comments.length === 0) {
    lines.push("No actionable line-level review comments identified.");
  } else {
    for (const comment of review.comments) {
      lines.push(
        `- \`${comment.path}:${comment.line}\` (${toTitleCase(comment.severity)} ${comment.category}): ${comment.body}`
      );
      if (comment.suggestion) {
        lines.push(`  Suggestion: ${comment.suggestion}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
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

async function runReviewCommand(): Promise<void> {
  const options = parseReviewCommandArgs(getCliArgs());
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

  process.stdout.write(`${formatPRReviewMarkdown(result, issue, options.issueNumber)}\n`);
}

async function runPrCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const prCommand = parsePrCommandArgs(getCliArgs());
  const repositoryConfig = getRepositoryConfig(repoRoot);

  if (prCommand.action === "prepare-review") {
    await runPrPrepareReviewCommand({
      prNumber: prCommand.prNumber,
      repoRoot,
      buildCommand: repositoryConfig.buildCommand,
      forge: getRepositoryForge(repoRoot),
      ensureCleanWorkingTree,
      promptForLine,
      hasChanges,
      verifyBuild,
      commitGeneratedChanges,
      readDiff: readIssueWorkflowDiff,
      createProvider: async (providerRepoRoot) => createProvider(providerRepoRoot),
    });
    return;
  }

  if (prCommand.action === "fix-comments") {
    await runPrFixCommentsCommand({
      prNumber: prCommand.prNumber,
      repoRoot,
      buildCommand: repositoryConfig.buildCommand,
      runtime: {
        resolve: () => {
          const runtime = selectInteractiveRuntime(repositoryConfig.ai.runtime, {
            onFallback: (message) => {
              console.log(message);
            },
          });
          return {
            displayName: runtime.displayName,
            launch: (runtimeRepoRoot, workspace) => {
              runtime.launch(runtimeRepoRoot, workspace);
            },
          };
        },
      },
      forge: getRepositoryForge(repoRoot),
      ensureCleanWorkingTree,
      promptForLine,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });
    return;
  }

  await runPrFixTestsCommand({
    prNumber: prCommand.prNumber,
    repoRoot,
    buildCommand: repositoryConfig.buildCommand,
    runtime: {
      resolve: () => {
        const runtime = selectInteractiveRuntime(repositoryConfig.ai.runtime, {
          onFallback: (message) => {
            console.log(message);
          },
        });
        return {
          displayName: runtime.displayName,
          launch: (runtimeRepoRoot, workspace) => {
            runtime.launch(runtimeRepoRoot, workspace);
          },
        };
      },
    },
    forge: getRepositoryForge(repoRoot),
    ensureCleanWorkingTree,
    promptForLine,
    verifyBuild,
    hasChanges,
    commitGeneratedChanges,
  });
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

function appendAdditionalDescription(body: string, additionalDescription: string): string {
  const trimmed = additionalDescription.trim();
  if (!trimmed) {
    return body;
  }

  return `${body}\n\n## Maintainer notes\n${trimmed}\n`;
}

async function maybeCreateTestBacklogIssues(
  options: TestBacklogCommandOptions,
  analysis: Awaited<ReturnType<typeof analyzeTestBacklog>>
): Promise<CreatedIssueRecord[]> {
  if (!options.createIssues) {
    return [];
  }

  const forge = getRepositoryForge(options.repoRoot);
  const createdIssues: CreatedIssueRecord[] = [];

  for (const finding of analysis.findings.slice(0, options.maxIssues)) {
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

async function runTestBacklogCommand(): Promise<void> {
  const options = parseTestBacklogCommandArgs(getCliArgs());
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
}

async function runFeatureBacklogCommand(): Promise<void> {
  const options = parseFeatureBacklogCommandArgs(getCliArgs());
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

async function runIssueDraftCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const runtime = selectInteractiveRuntime(repositoryConfig.ai.runtime, {
    onFallback: (message) => {
      console.log(message);
    },
  });
  const featureIdea = await promptForRequiredLine("Rough idea: ");
  const workspace = createIssueDraftWorkspace(repoRoot);
  writeIssueDraftWorkspaceFiles(repoRoot, featureIdea, workspace, runtime.type);

  runtime.launch(repoRoot, {
    promptFilePath: workspace.promptFilePath,
    outputLogPath: workspace.outputLogPath,
  });

  if (!existsSync(workspace.draftFilePath)) {
    throw new Error(
      `${runtime.displayName} did not write the issue draft to ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }

  const draftContents = readFileSync(workspace.draftFilePath, "utf8").trim();
  if (!draftContents) {
    throw new Error(
      `${runtime.displayName} wrote an empty issue draft at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }
  const forge = getRepositoryForge(repoRoot);
  if (!forge.isAuthenticated()) {
    printGeneratedTextPreview("Generated issue draft", draftContents);
    if (forge.type === "github") {
      console.log("Issue creation skipped because GitHub access is unavailable.");
    } else {
      console.log(
        "Issue creation skipped because repository forge support is disabled by .git-ai/config.json."
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
}

async function runIssuePlanCommand(issueNumber: number): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const forge = getRepositoryForge(repoRoot);
  console.log(`Fetching issue #${issueNumber}...`);
  const issue = await forge.fetchIssueDetails(issueNumber);
  const existingPlanComment = await forge.fetchIssuePlanComment(issueNumber);

  if (existingPlanComment) {
    console.log(
      `Using existing issue resolution plan comment: ${existingPlanComment.url}`
    );
    return;
  }

  const { provider } = await createProvider(repoRoot);
  const plan = await generateIssueResolutionPlan(provider, {
    issueNumber,
    issueTitle: issue.title,
    issueBody: issue.body,
    issueUrl: issue.url,
  });
  const comment = await forge.createIssuePlanComment(
    issueNumber,
    renderIssueResolutionPlanComment(issueNumber, plan)
  );

  console.log(`Created issue resolution plan comment: ${comment.url}`);
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
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable issue workflows."
    );
  }
  ensureCleanWorkingTree(repoRoot);
  console.log(`Fetching issue #${issueNumber}...`);
  const issue = await forge.fetchIssueDetails(issueNumber);
  const planComment = await forge.fetchIssuePlanComment(issueNumber);
  const sessionStateFilePath = getIssueSessionStateFilePath(repoRoot, issueNumber);
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
  syncIssueBaseBranch(repoRoot, repositoryConfig.baseBranch);
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
    noChangesMessage: "The interactive runtime completed without producing any file changes to commit.",
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
      'Unattended issue runs currently require `ai.runtime.type` to be "codex" in .git-ai/config.json.'
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
      "Unattended issue runs require authenticated GitHub access so git-ai can open the pull request automatically."
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
  const finalized = await finalizeIssueRunUnattended(
    repoRoot,
    context.issueNumber,
    provider,
    context.workspace.runDir
  );
  const pullRequest = await generateIssuePullRequest(provider, {
    repoRoot,
    issueNumber: context.issueNumber,
    issue: context.issue,
    diff: finalized.diff,
    commitMessage: finalized.commitMessage,
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
    baseBranch: repositoryConfig.baseBranch,
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

  return {
    branchName: context.branchName,
    runDir,
    prUrl: createdPullRequest.url,
  };
}

async function runIssueBatchCommand(issueNumbers: number[]): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const workspace = createIssueBatchWorkspace(repoRoot, issueNumbers);
  let state =
    loadIssueBatchState(repoRoot, issueNumbers) ??
    createInitialIssueBatchState(issueNumbers, workspace);
  state = updateIssueBatchState(repoRoot, issueNumbers, state, workspace, (currentState) => ({
    ...currentState,
    latestRunDir: toRepoRelativePath(repoRoot, workspace.runDir),
  }));

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

    const startMessage = `[${index + 1}/${issueNumbers.length}] Starting issue #${issueNumber}.`;
    console.log(startMessage);
    appendIssueBatchLog(workspace, startMessage);

    try {
      const result = await runUnattendedIssueCommand(issueNumber, {
        onPrepared: ({ branchName, runDir }) => {
          const now = new Date().toISOString();
          state = updateIssueBatchState(
            repoRoot,
            issueNumbers,
            state,
            workspace,
            (currentState) => ({
              ...currentState,
              stoppedIssueNumber: issueNumber,
              issues: currentState.issues.map((entry) =>
                entry.issueNumber !== issueNumber
                  ? entry
                  : {
                      ...entry,
                      status: "running",
                      branchName,
                      runDir,
                      error: undefined,
                      attempts: [
                        ...entry.attempts,
                        {
                          startedAt: now,
                          updatedAt: now,
                          status: "running",
                          branchName,
                          runDir,
                        },
                      ],
                    }
              ),
            })
          );
        },
      });

      const successMessage = result.prUrl
        ? `[${index + 1}/${issueNumbers.length}] Completed issue #${issueNumber}: ${result.prUrl}`
        : `[${index + 1}/${issueNumbers.length}] Completed issue #${issueNumber}.`;
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
                  branchName: result.branchName,
                  runDir: result.runDir,
                  prUrl: result.prUrl,
                  error: undefined,
                  attempts:
                    entry.attempts.length === 0
                      ? [
                          {
                            startedAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            status: "completed",
                            branchName: result.branchName,
                            runDir: result.runDir,
                            prUrl: result.prUrl,
                          },
                        ]
                      : entry.attempts.map((attempt, attemptIndex) =>
                          attemptIndex === entry.attempts.length - 1
                            ? {
                                ...attempt,
                                updatedAt: new Date().toISOString(),
                                status: "completed",
                                branchName: result.branchName,
                                runDir: result.runDir,
                                prUrl: result.prUrl,
                                error: undefined,
                              }
                            : attempt
                        ),
                }
          ),
        })
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const failureMessage = `[${index + 1}/${issueNumbers.length}] Stopping batch at issue #${issueNumber}: ${message}`;
      console.log(failureMessage);
      appendIssueBatchLog(workspace, failureMessage);
      state = updateIssueBatchState(
        repoRoot,
        issueNumbers,
        state,
        workspace,
        (currentState) => ({
          ...currentState,
          stoppedIssueNumber: issueNumber,
          issues: currentState.issues.map((entry) =>
            entry.issueNumber !== issueNumber
              ? entry
              : {
                  ...entry,
                  status: "failed",
                  error: message,
                  attempts:
                    entry.attempts.length === 0
                      ? [
                          {
                            startedAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            status: "failed",
                            error: message,
                          },
                        ]
                      : entry.attempts.map((attempt, attemptIndex) =>
                          attemptIndex === entry.attempts.length - 1
                            ? {
                                ...attempt,
                                updatedAt: new Date().toISOString(),
                                status: "failed",
                                error: message,
                              }
                            : attempt
                        ),
                }
          ),
        })
      );
      throw error;
    }
  }
}

async function runIssueCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const args = getCliArgs();
  const issueCommand = parseIssueCommandArgs(args);

  if (issueCommand.action === "draft") {
    await runIssueDraftCommand();
    return;
  }

  if (issueCommand.action === "plan") {
    await runIssuePlanCommand(issueCommand.issueNumber);
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

  console.log(
    context.runtime.invocation === "resume"
      ? `Resuming the saved interactive ${runtime.displayName} session in this terminal...`
      : `Opening an interactive ${runtime.displayName} session in this terminal...`
  );
  console.log(`Complete the issue work in ${runtime.displayName}.`);
  console.log(
    `When ${runtime.displayName} exits, git-ai will resume with build and commit steps.`
  );
  const runtimeLaunch = runtime.launch(repoRoot, context.workspace, {
    resumeSessionId: context.runtime.sessionId,
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
  const finalized = await finalizeIssueRun(
    repoRoot,
    context.issueNumber,
    provider,
    context.workspace.runDir
  );
  if (!finalized.committed) {
    console.log("Skipping pull request creation because no commit was created.");
    return;
  }

  const pullRequest = await generateIssuePullRequest(provider, {
    repoRoot,
    issueNumber: context.issueNumber,
    issue: context.issue,
    diff: finalized.diff,
    commitMessage: finalized.commitMessage,
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
      baseBranch: repositoryConfig.baseBranch,
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
    return;
  }

  if (forge.type === "github") {
    printManualPrInstructions(
      repoRoot,
      context.branchName,
      repositoryConfig.baseBranch,
      pullRequest.titleFilePath ?? resolve(context.workspace.runDir, "pull-request-title.txt"),
      pullRequest.bodyFilePath ?? resolve(context.workspace.runDir, "pull-request-body.md")
    );
    return;
  }

  console.log(
    "Pull request creation skipped because repository forge support is disabled by .git-ai/config.json."
  );
}

export async function run(): Promise<void> {
  const args = getCliArgs();
  const firstArg = args[0];

  if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
    process.stdout.write(`${TOP_LEVEL_HELP}\n`);
    return;
  }

  const command = args[0] ?? "commit";
  if (
    command !== "commit" &&
    command !== "diff" &&
    command !== "setup" &&
    command !== "issue" &&
    command !== "pr" &&
    command !== "review" &&
    command !== "test-backlog" &&
    command !== "feature-backlog"
  ) {
    throw new Error(`Unknown command: ${command}.\n\n${TOP_LEVEL_HELP}`);
  }

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
    parseSetupCommandArgs(args);
    await runSetupCommand({
      repoRoot: getDefaultRepoRoot(),
      promptForLine,
    });
    return;
  }

  if (command === "pr") {
    await runPrCommand();
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
