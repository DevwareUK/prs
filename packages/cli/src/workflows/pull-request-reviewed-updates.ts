import { runTrackedCommand, runTrackedCommandAndCapture } from "./tracked-command";

function resolvePullRequestHeadRemoteRef(headRefName: string): string {
  return `origin/${headRefName}`;
}

function getAheadBehindCounts(
  repoRoot: string,
  outputLogPath: string,
  remoteRef: string
): { ahead: number; behind: number } {
  const counts = runTrackedCommand(
    repoRoot,
    outputLogPath,
    "git",
    ["rev-list", "--left-right", "--count", `${remoteRef}...HEAD`],
    `Failed to compare HEAD with "${remoteRef}".`,
    { echoOutput: false }
  ).trim();

  const [behindRaw, aheadRaw] = counts.split(/\s+/);
  const behind = Number.parseInt(behindRaw ?? "", 10);
  const ahead = Number.parseInt(aheadRaw ?? "", 10);

  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) {
    throw new Error(`Failed to compare HEAD with "${remoteRef}".`);
  }

  return {
    ahead,
    behind,
  };
}

export function pushReviewedPullRequestUpdates(
  repoRoot: string,
  outputLogPath: string,
  headRefName: string
): void {
  const remoteRef = resolvePullRequestHeadRemoteRef(headRefName);

  console.log(`Fetching latest ${remoteRef} before checking push status...`);
  const fetchResult = runTrackedCommandAndCapture(
    repoRoot,
    outputLogPath,
    "git",
    ["fetch", "origin", headRefName]
  );

  if (fetchResult.error) {
    throw new Error(
      `Failed to fetch PR head branch "${headRefName}" from origin before pushing reviewed updates. Local commits were kept. ${fetchResult.error.message}`
    );
  }

  if (fetchResult.status !== 0) {
    throw new Error(
      `Failed to fetch PR head branch "${headRefName}" from origin before pushing reviewed updates. This workflow only pushes PR branches that are available as ${remoteRef}. Local commits were kept.`
    );
  }

  runTrackedCommand(
    repoRoot,
    outputLogPath,
    "git",
    ["rev-parse", remoteRef],
    `Failed to resolve "${remoteRef}" after fetching the PR head branch. Reviewed updates were not pushed.`,
    { echoOutput: false }
  );

  const { ahead, behind } = getAheadBehindCounts(repoRoot, outputLogPath, remoteRef);
  if (ahead === 0) {
    console.log(`Reviewed updates already match ${remoteRef}; skipping push.`);
    return;
  }

  if (behind > 0) {
    throw new Error(
      `Cannot push reviewed updates to "${headRefName}" because HEAD diverged from ${remoteRef} (${ahead} ahead, ${behind} behind). Local commits were kept.`
    );
  }

  console.log(`Pushing reviewed updates to ${remoteRef}...`);
  const pushResult = runTrackedCommandAndCapture(
    repoRoot,
    outputLogPath,
    "git",
    ["push", "origin", `HEAD:${headRefName}`]
  );

  if (pushResult.error) {
    throw new Error(
      `Failed to push reviewed updates to ${remoteRef}. Local commits were kept. ${pushResult.error.message}`
    );
  }

  if (pushResult.status !== 0) {
    throw new Error(`Failed to push reviewed updates to ${remoteRef}. Local commits were kept.`);
  }
}
