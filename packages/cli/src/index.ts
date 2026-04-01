#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
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
import { OpenAIProvider } from "@git-ai/providers";
import dotenv from "dotenv";
import {
  formatCommandForDisplay,
  loadResolvedRepositoryConfig,
} from "./config";
import { buildCodexDoneStateInstructions } from "./codex-done-state";
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
import { resolveRuntimeRepoRoot } from "./repo-root";
import { formatRunTimestamp, toRepoRelativePath } from "./run-artifacts";
import { parseSetupCommandArgs, runSetupCommand } from "./setup";
import { runPrFixCommentsCommand } from "./workflows/pr-fix-comments/run";
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

type IssueExecutionMode = "local" | "github-action";
type IssueDraftWorkspace = {
  runDir: string;
  draftFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
};

type IssueCommandOptions =
  | {
      action: "run" | "prepare" | "finalize" | "plan";
      issueNumber: number;
      mode: IssueExecutionMode;
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
  mode: IssueExecutionMode;
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

const ISSUE_PLAN_COMMENT_MARKER = "<!-- git-ai:issue-plan -->";

const ISSUE_USAGE = [
  "Usage:",
  "  git-ai issue <number>",
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

function getCliArgs(): string[] {
  return process.argv.slice(2).filter((arg) => arg !== "--");
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    if (name === "OPENAI_API_KEY") {
      throw new Error(
        "OPENAI_API_KEY is required. Set it in your environment or in a .env file."
      );
    }

    throw new Error(`${name} is required.`);
  }

  return value;
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
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
    "Codex completed without producing any file changes to commit.",
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
      "Working tree is not clean. Commit or stash existing changes before running interactive git-ai workflows."
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

function parseIssueMode(rawArgs: string[]): IssueExecutionMode {
  if (rawArgs.length === 0) {
    return "local";
  }

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

  if (mode !== "local" && mode !== "github-action") {
    throw new Error(
      `Invalid issue mode "${mode ?? ""}". Expected "local" or "github-action".`
    );
  }

  return mode;
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

  if (subcommand === "prepare") {
    return {
      action: "prepare",
      issueNumber: parseIssueNumber(issueArgs[1]),
      mode: parseIssueMode(issueArgs.slice(2)),
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
    mode: parseIssueMode(issueArgs.slice(1)),
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

function buildIssueDraftCodexPrompt(
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
    "Instructions to Codex:",
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
  workspace: IssueDraftWorkspace
): void {
  const createdAt = new Date().toISOString();
  const prompt = buildIssueDraftCodexPrompt(repoRoot, workspace, featureIdea);

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
      `Draft file: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      "",
    ].join("\n"),
    "utf8"
  );
}

function createIssueWorkspace(
  repoRoot: string,
  issueNumber: number,
  issue: IssueDetails
): IssueWorkspace {
  const slug = slugifyIssueTitle(issue.title) || `issue-${issueNumber}`;
  const issueDir = resolve(repoRoot, ".git-ai", "issues", `${issueNumber}-${slug}`);
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

function ensureBranchDoesNotExist(repoRoot: string, branchName: string): void {
  const result = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", branchName], {
    stdio: "ignore",
  });

  if (!result.error && result.status === 0) {
    throw new Error(`Branch "${branchName}" already exists.`);
  }
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

function buildCodexPrompt(
  repoRoot: string,
  workspace: IssueWorkspace,
  mode: IssueExecutionMode,
  buildCommand: string[]
): string {
  const issueFile = toRepoRelativePath(repoRoot, workspace.issueFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);
  const modeSpecificInstructions =
    mode === "github-action"
      ? [
          "You are running inside a GitHub Actions workflow via Codex.",
          "Do not wait for interactive user input.",
        ]
      : [];
  const doneStateInstructions = buildCodexDoneStateInstructions({
    mode: mode === "github-action" ? "non-interactive" : "interactive",
    readyLabel:
      mode === "github-action" ? "Ready for the next automation step" : "Ready to commit",
  });

  return [
    "You are working in the current repository.",
    ...modeSpecificInstructions,
    "",
    `Read the issue snapshot at \`${issueFile}\` before making changes.`,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to Codex:",
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
  mode: IssueExecutionMode,
  buildCommand: string[]
): void {
  const createdAt = new Date().toISOString();
  const prompt = buildCodexPrompt(repoRoot, workspace, mode, buildCommand);

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

function runCodex(
  repoRoot: string,
  workspace: {
    promptFilePath: string;
    outputLogPath: string;
  }
): void {
  if (!canRunCommand("codex")) {
    throw new Error(
      "The `codex` CLI is not available on PATH. Install it before running interactive git-ai Codex workflows."
    );
  }

  const args = [
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "on-request",
    "--cd",
    repoRoot,
    `Read and follow the instructions in ${toRepoRelativePath(
      repoRoot,
      workspace.promptFilePath
    )}.`,
  ];

  appendRunLog(
    workspace.outputLogPath,
    "codex",
    args,
    "[interactive Codex session opened in current terminal]",
    ""
  );

  const result = spawnSync("codex", args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(
      `Failed to start the interactive Codex session. ${result.error.message}`
    );
  }

  if (result.status !== 0) {
    throw new Error(
      "The interactive Codex session did not complete successfully."
    );
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
    throw new Error("Codex completed without producing any file changes to commit.");
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

async function reviewCommitMessage(
  repoRoot: string,
  issueNumber: number,
  prompt: string,
  initialMessage: string,
  runDir?: string
): Promise<ReviewedGeneratedText | null> {
  const reviewRunDir = runDir ?? createStandaloneIssueFinalizeRunDir(repoRoot, issueNumber);
  return reviewGeneratedText({
    filePath: resolve(reviewRunDir, "commit-message.txt"),
    initialContent: initialMessage,
    previewHeading: "Proposed commit message",
    prompt,
    emptyContentMessage: "Commit message cannot be empty.",
    editorDescription: "commit message",
    promptForLine,
    validate: validateCommitMessage,
  });
}

async function generateIssueCommitProposal(
  repoRoot: string,
  provider: OpenAIProvider
): Promise<{ diff: string; initialMessage: string }> {
  const diff = readIssueWorkflowDiff(repoRoot);
  const result = await generateCommitMessage(provider, diff);

  return {
    diff,
    initialMessage: formatCommitMessage(result.title, result.body),
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
  provider: OpenAIProvider,
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

function createProvider(): OpenAIProvider {
  loadRepoEnv(getDefaultRepoRoot());
  return new OpenAIProvider({
    apiKey: getRequiredEnv("OPENAI_API_KEY"),
    model: getOptionalEnv("OPENAI_MODEL"),
    baseUrl: getOptionalEnv("OPENAI_BASE_URL"),
  });
}

async function runReviewCommand(): Promise<void> {
  const options = parseReviewCommandArgs(getCliArgs());
  const diff = readReviewDiff(options.base, options.head);
  const provider = createProvider();
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

  if (prCommand.action === "fix-comments") {
    await runPrFixCommentsCommand({
      prNumber: prCommand.prNumber,
      repoRoot,
      buildCommand: repositoryConfig.buildCommand,
      forge: getRepositoryForge(repoRoot),
      ensureCleanWorkingTree,
      promptForLine,
      runCodex,
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
    forge: getRepositoryForge(repoRoot),
    ensureCleanWorkingTree,
    promptForLine,
    runCodex,
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
  const featureIdea = await promptForRequiredLine("Rough idea: ");
  const workspace = createIssueDraftWorkspace(repoRoot);
  writeIssueDraftWorkspaceFiles(repoRoot, featureIdea, workspace);

  runCodex(repoRoot, {
    promptFilePath: workspace.promptFilePath,
    outputLogPath: workspace.outputLogPath,
  });

  if (!existsSync(workspace.draftFilePath)) {
    throw new Error(
      `Codex did not write the issue draft to ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }

  const draftContents = readFileSync(workspace.draftFilePath, "utf8").trim();
  if (!draftContents) {
    throw new Error(
      `Codex wrote an empty issue draft at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
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

  const provider = createProvider();
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
  mode: IssueExecutionMode
): Promise<IssueRunContext> {
  const repoRoot = getDefaultRepoRoot();
  const forge = getRepositoryForge(repoRoot);
  const repositoryConfig = getRepositoryConfig(repoRoot);
  if (forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable issue workflows."
    );
  }
  ensureCleanWorkingTree(repoRoot);
  console.log(`Fetching issue #${issueNumber}...`);
  const issue = await forge.fetchIssueDetails(issueNumber);
  const planComment = await forge.fetchIssuePlanComment(issueNumber);

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
    repositoryConfig.buildCommand
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
  };
}

async function finalizeIssueRun(
  repoRoot: string,
  issueNumber: number,
  provider: OpenAIProvider,
  runDir?: string
): Promise<FinalizeIssueRunResult> {
  const proposal = await generateIssueCommitProposal(repoRoot, provider);
  const reviewedCommitMessage = await reviewCommitMessage(
    repoRoot,
    issueNumber,
    "Commit generated changes with this message? [Y/n/m]: ",
    proposal.initialMessage,
    runDir
  );

  if (!reviewedCommitMessage) {
    console.log("Leaving the generated changes uncommitted.");
    return {
      committed: false,
    };
  }

  console.log("Committing generated changes...");
  commitGeneratedChanges(repoRoot, reviewedCommitMessage);
  return {
    committed: true,
    diff: proposal.diff,
    commitMessage: reviewedCommitMessage,
  };
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
    const provider = createProvider();
    await finalizeIssueRun(repoRoot, issueCommand.issueNumber, provider);
    return;
  }

  if (issueCommand.mode !== "local") {
    throw new Error(
      'Full issue runs only support local mode. Use `git-ai issue prepare <number> --mode github-action` in workflows.'
    );
  }

  const context = await prepareIssueRun(issueCommand.issueNumber, issueCommand.mode);
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const forge = getRepositoryForge(repoRoot);

  console.log("Opening an interactive Codex session in this terminal...");
  console.log("Complete the issue work in Codex.");
  console.log("When Codex exits, git-ai will resume with build and commit steps.");
  runCodex(repoRoot, context.workspace);

  console.log("Verifying build...");
  verifyBuild(repoRoot, repositoryConfig.buildCommand, context.workspace.outputLogPath);

  const provider = createProvider();
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

  if (forge.isAuthenticated()) {
    console.log("Pushing branch and opening a pull request...");
    await forge.createPullRequest({
      branchName: context.branchName,
      baseBranch: repositoryConfig.baseBranch,
      title: pullRequest.title,
      body: pullRequest.body,
      outputLogPath: context.workspace.outputLogPath,
    });
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
    throw new Error(
      `Unknown command: ${command}. Supported commands: "commit", "diff", "setup", "issue", "pr", "review", "test-backlog", "feature-backlog".`
    );
  }

  if (command === "commit") {
    const diff = readStagedDiff();
    const provider = createProvider();
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
  const provider = createProvider();
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
