import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { formatCommandForDisplay } from "./config";

type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

function runCommand(
  command: string,
  args: string[],
  cwd?: string
): SpawnResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function runGitCommand(repoRoot: string, args: string[]): SpawnResult {
  return runCommand("git", args, repoRoot);
}

function requireGitOutput(repoRoot: string, args: string[], message: string): string {
  const result = runGitCommand(repoRoot, args);
  const output = result.stdout.trim();
  if (result.error || result.status !== 0 || !output) {
    throw new Error(formatGitFailure(result, message));
  }

  return output;
}

function runPnpmVersionFallback(repoRoot: string): SpawnResult | undefined {
  const corepackCommand = resolve(dirname(process.execPath), "corepack");
  return runCommand(corepackCommand, ["pnpm", "--version"], repoRoot);
}

function formatGitFailure(
  result: SpawnResult,
  fallbackMessage: string
): string {
  const detail = result.error?.message || result.stderr.trim();
  return detail ? `${fallbackMessage} ${detail}` : fallbackMessage;
}

export function ensureVerificationCommandAvailable(
  repoRoot: string,
  buildCommand: string[],
  workflowLabel: string
): void {
  const command = buildCommand[0];
  const result = runCommand(command, ["--version"], repoRoot);
  if (!result.error && result.status === 0) {
    return;
  }

  if (command === "pnpm") {
    const fallbackResult = runPnpmVersionFallback(repoRoot);
    if (fallbackResult && !fallbackResult.error && fallbackResult.status === 0) {
      return;
    }
  }

  throw new Error(
    `${workflowLabel} cannot run the configured verification command \`${formatCommandForDisplay(
      buildCommand
    )}\` from the repository root. Install \`${command}\` or update \`.prs/config.json\` with \`prs setup\`.`
  );
}

export function branchContainsCommit(
  repoRoot: string,
  commitish: string,
  branchish: string
): boolean {
  const result = runGitCommand(repoRoot, [
    "merge-base",
    "--is-ancestor",
    commitish,
    branchish,
  ]);

  if (result.error) {
    throw new Error(
      `Failed to determine whether "${branchish}" already contains ${commitish}. ${result.error.message}`
    );
  }

  if (result.status === 0) {
    return true;
  }

  if (result.status === 1) {
    return false;
  }

  const detail = result.stderr.trim();
  throw new Error(
    detail
      ? `Failed to determine whether "${branchish}" already contains ${commitish}. ${detail}`
      : `Failed to determine whether "${branchish}" already contains ${commitish}.`
  );
}

export function ensureGuidedCheckoutReady(repoRoot: string, baseBranch: string): void {
  const currentBranch = requireGitOutput(
    repoRoot,
    ["branch", "--show-current"],
    "Failed to determine the current branch before starting a guided prs workflow."
  );
  if (currentBranch !== baseBranch) {
    throw new Error(
      `Guided prs workflows must start from the configured base branch "${baseBranch}". Current branch is "${currentBranch}". Switch to "${baseBranch}" and pull the latest origin state before retrying.`
    );
  }

  const status = runGitCommand(repoRoot, ["status", "--porcelain"]);
  if (status.error || status.status !== 0) {
    throw new Error(
      formatGitFailure(
        status,
        "Failed to inspect the working tree before starting a guided prs workflow."
      )
    );
  }
  if (status.stdout.trim()) {
    throw new Error(
      "Guided prs workflows require a clean working tree. Commit, stash, or discard uncommitted changes before retrying."
    );
  }

  const localTip = requireGitOutput(
    repoRoot,
    ["rev-parse", baseBranch],
    `Failed to resolve local base branch "${baseBranch}" before starting a guided prs workflow.`
  );
  const remoteRef = `origin/${baseBranch}`;
  const remoteTip = requireGitOutput(
    repoRoot,
    ["rev-parse", remoteRef],
    `Failed to resolve "${remoteRef}" before starting a guided prs workflow.`
  );
  if (localTip !== remoteTip) {
    throw new Error(
      `Guided prs workflows require "${baseBranch}" to be up to date with "${remoteRef}". Run \`git fetch origin ${baseBranch}\` and \`git pull --ff-only\` before retrying.`
    );
  }
}

export function preflightIssueBaseBranch(
  repoRoot: string,
  baseBranch: string
): { remoteRef: string; remoteTip: string } {
  const localBranchCheck = runGitCommand(repoRoot, [
    "rev-parse",
    "--verify",
    `refs/heads/${baseBranch}`,
  ]);
  if (localBranchCheck.error || localBranchCheck.status !== 0) {
    throw new Error(
      `Configured base branch "${baseBranch}" does not exist locally. Update \`.prs/config.json\` with \`prs setup\` or create the branch before running issue workflows.`
    );
  }

  return {
    ...preflightRemoteBranch(
      repoRoot,
      "origin",
      baseBranch,
      `Configured base branch "${baseBranch}"`,
      'update `.prs/config.json` with `prs setup`'
    ),
  };
}

export function preflightRemoteBranch(
  repoRoot: string,
  remoteName: string,
  branchName: string,
  branchLabel = `Branch "${branchName}"`,
  recoveryHint = "confirm the repository configuration"
): { remoteRef: string; remoteTip: string } {
  const fetchResult = runGitCommand(repoRoot, ["fetch", remoteName, branchName]);
  if (fetchResult.error || fetchResult.status !== 0) {
    throw new Error(
      formatGitFailure(
        fetchResult,
        `${branchLabel} could not be fetched from ${remoteName}. Ensure "${remoteName}/${branchName}" exists and is reachable, or ${recoveryHint}.`
      )
    );
  }

  const remoteRef = `${remoteName}/${branchName}`;
  const remoteBranchCheck = runGitCommand(repoRoot, [
    "rev-parse",
    "--verify",
    `refs/remotes/${remoteRef}`,
  ]);
  const remoteTip = remoteBranchCheck.stdout.trim();
  if (remoteBranchCheck.error || remoteBranchCheck.status !== 0 || !remoteTip) {
    throw new Error(
      `${branchLabel} was fetched, but "${remoteRef}" is still unavailable locally. Confirm the remote branch and ${recoveryHint}.`
    );
  }

  return {
    remoteRef,
    remoteTip,
  };
}
