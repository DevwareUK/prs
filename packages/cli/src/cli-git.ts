import {
filterRepositoryPaths
} from "@prs/core";
import { execFileSync,spawnSync } from "node:child_process";
import {
appendFileSync
} from "node:fs";
import { getDefaultRepoRoot,getRepositoryConfig } from "./cli-context";
import { REVIEW_USAGE } from "./commands/review";
import {
type ReviewedGeneratedText
} from "./generated-text-review";
import {
loadMediaEvidenceManifest,
resolveRepositoryMediaEvidence
} from "./media-evidence";
import {
parseSetupCommandArgs
} from "./setup";
import {
ensureVerificationCommandAvailable
} from "./workflow-preflights";
import { ISSUE_RUN_NO_CHANGES_MESSAGE } from "./workflows/issue/types";
import type { VerificationFailure } from "./workflows/pr-fix-failing-tests/types";

export { parseAuditCommandArgs } from "./commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "./commands/backlog";
export { parseIssueCommandArgs } from "./commands/issue";
export { parseReviewCommandArgs } from "./commands/review";
export { parseSetupCommandArgs };

export function runGitOutput(repoRoot: string, args: string[], errorMessage: string): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
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

export function resolveGitHubOrigin(repoRoot: string): { owner: string; repo: string } {
  const remoteUrl = runGitOutput(
    repoRoot,
    ["remote", "get-url", "origin"],
    "Media rendering for tracked repository files requires a GitHub origin remote."
  );
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error("Media rendering for tracked repository files requires a GitHub origin remote.");
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

export function resolveCurrentBranchName(repoRoot: string): string {
  const branchName = runGitOutput(
    repoRoot,
    ["branch", "--show-current"],
    "Media rendering for tracked repository files requires a checked out branch."
  );
  if (!branchName) {
    throw new Error(
      "Media rendering for tracked repository files requires a checked out branch, not a detached HEAD."
    );
  }

  return branchName;
}

export function isGitTrackedPath(repoRoot: string, path: string): boolean {
  const result = spawnSync("git", ["-C", repoRoot, "ls-files", "--error-unmatch", "--", path], {
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

export function loadMediaEvidenceForPublication(
  repoRoot: string,
  manifestPath: string | undefined
): ReturnType<typeof loadMediaEvidenceManifest> {
  const evidence = manifestPath ? loadMediaEvidenceManifest(repoRoot, manifestPath) : [];
  const trackedPaths = evidence
    .filter((item) => item.source.type === "local")
    .map((item) => item.source.value)
    .filter((path) => isGitTrackedPath(repoRoot, path));

  if (trackedPaths.length === 0) {
    return evidence.filter((item) => item.source.type !== "local");
  }

  return resolveRepositoryMediaEvidence(evidence, {
    ...resolveGitHubOrigin(repoRoot),
    refName: resolveCurrentBranchName(repoRoot),
    trackedPaths,
  });
}

export function executeGitDiff(
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

export function buildNameOnlyDiffArgs(args: string[]): string[] {
  return args[0] === "diff" ? [args[0], "--name-only", ...args.slice(1)] : args;
}

export type ReadGitDiffOptions = {
  allowEmpty?: boolean;
  excludePaths?: string[];
  repoRoot?: string;
};

export function readGitDiff(
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

export function readStagedDiff(): string {
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

export function readHeadDiff(): string {
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

export function readIncludedUntrackedFiles(repoRoot: string, excludePaths: string[]): string[] {
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

export function readUntrackedFileDiff(repoRoot: string, filePath: string): string {
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

export function readUntrackedFileDiffs(repoRoot: string, paths: string[]): string {
  return paths
    .map((filePath) => readUntrackedFileDiff(repoRoot, filePath))
    .filter((diff) => diff.trim().length > 0)
    .join("\n");
}

export function readIssueWorkflowDiff(repoRoot: string): string {
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

export function runCommand(
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

export function runInteractiveCommand(
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

export function hasChanges(repoRoot: string): boolean {
  return runCommand(
    "git",
    ["-C", repoRoot, "status", "--porcelain"],
    "Failed to inspect the working tree."
  ).length > 0;
}

export function ensureCleanWorkingTree(repoRoot: string): void {
  if (hasChanges(repoRoot)) {
    throw new Error(
      "Working tree is not clean. Commit or stash existing changes before running prs issue workflows."
    );
  }
}

export function appendRunLog(
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

export function runTrackedCommand(
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

export function verifyBuild(repoRoot: string, buildCommand: string[], outputLogPath: string): void {
  ensureVerificationCommandAvailable(repoRoot, buildCommand, "prs");

  runTrackedCommand(
    buildCommand[0],
    buildCommand.slice(1),
    "Build failed. Changes were not committed.",
    outputLogPath,
    repoRoot
  );
}

export function captureVerificationFailure(
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

export function commitGeneratedChanges(
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
