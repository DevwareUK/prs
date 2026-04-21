import { spawnSync } from "node:child_process";
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

  throw new Error(
    `${workflowLabel} cannot run the configured verification command \`${formatCommandForDisplay(
      buildCommand
    )}\` from the repository root. Install \`${command}\` or update \`.git-ai/config.json\` with \`git-ai setup\`.`
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
      `Configured base branch "${baseBranch}" does not exist locally. Update \`.git-ai/config.json\` with \`git-ai setup\` or create the branch before running issue workflows.`
    );
  }

  return {
    ...preflightRemoteBranch(
      repoRoot,
      "origin",
      baseBranch,
      `Configured base branch "${baseBranch}"`,
      'update `.git-ai/config.json` with `git-ai setup`'
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
