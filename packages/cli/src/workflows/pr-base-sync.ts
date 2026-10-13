import type { PullRequestDetails } from "../integration-types";
import {
  runTrackedCommand as runTrackedCommandBase,
  runTrackedCommandAndCapture as runTrackedCommandAndCaptureBase,
  type TrackedCommandOptions,
  type TrackedCommandResult,
} from "./tracked-command";

export type PullRequestBaseSyncStatus = "up-to-date" | "merged" | "blocked";
export type PullRequestBaseSyncConflictResolution =
  | "not-needed"
  | "required"
  | "unresolved";

export type PullRequestBaseSyncState = {
  baseRefName: string;
  remoteRef: string;
  baseTip: string;
  status: PullRequestBaseSyncStatus;
  conflictResolution: PullRequestBaseSyncConflictResolution;
  summary: string;
  warnings: string[];
  recoveryMessage?: string;
};

export type PullRequestBaseSyncWorkspace = {
  outputLogPath: string;
};

export function resolveBaseSyncRemoteRef(baseRefName: string): string {
  return `origin/${baseRefName}`;
}

export function runBaseSyncTrackedCommandAndCapture(
  repoRoot: string,
  workspace: PullRequestBaseSyncWorkspace,
  command: string,
  args: string[],
  options: TrackedCommandOptions = {}
): TrackedCommandResult {
  return runTrackedCommandAndCaptureBase(
    repoRoot,
    workspace.outputLogPath,
    command,
    args,
    options
  );
}

export function runBaseSyncTrackedCommand(
  repoRoot: string,
  workspace: PullRequestBaseSyncWorkspace,
  command: string,
  args: string[],
  errorMessage: string,
  options: TrackedCommandOptions = {}
): string {
  return runTrackedCommandBase(
    repoRoot,
    workspace.outputLogPath,
    command,
    args,
    errorMessage,
    options
  );
}

export function getBaseSyncTip(
  repoRoot: string,
  workspace: PullRequestBaseSyncWorkspace,
  remoteRef: string
): string {
  const baseTip = runBaseSyncTrackedCommand(
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

export function branchContainsCommit(
  repoRoot: string,
  workspace: PullRequestBaseSyncWorkspace,
  commitish: string,
  branchish: string
): boolean {
  const result = runBaseSyncTrackedCommandAndCapture(
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

export function isMergeInProgress(
  repoRoot: string,
  workspace: PullRequestBaseSyncWorkspace
): boolean {
  const result = runBaseSyncTrackedCommandAndCapture(
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

export function listUnmergedPaths(
  repoRoot: string,
  workspace: PullRequestBaseSyncWorkspace
): string[] {
  const result = runBaseSyncTrackedCommandAndCapture(
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

export function buildIncompleteBaseSyncRecoveryMessage(input: {
  branchName: string;
  pullRequest: Pick<PullRequestDetails, "number">;
  remoteRef: string;
  baseTip: string;
  mergeStillInProgress: boolean;
  remainingUnmergedPaths: string[];
  nowContainsBaseTip: boolean;
  rerunCommand: string;
}): string {
  const recoveryParts: string[] = [];
  if (input.remainingUnmergedPaths.length > 0) {
    recoveryParts.push(
      `Remaining conflicted files: ${input.remainingUnmergedPaths.join(", ")}.`
    );
  }
  if (input.mergeStillInProgress) {
    recoveryParts.push(`Finish the in-progress merge on "${input.branchName}".`);
  }
  if (!input.nowContainsBaseTip) {
    recoveryParts.push(
      `Make sure "${input.branchName}" contains ${input.remoteRef} tip ${input.baseTip}.`
    );
  }

  return [
    `Base-branch sync is still incomplete for "${input.branchName}".`,
    ...recoveryParts,
    `After fixing the branch state, rerun \`${input.rerunCommand}\`.`,
  ].join(" ");
}
