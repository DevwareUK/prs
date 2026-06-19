import type { PullRequestCheckSignal } from "../../forge";

export type PullRequestCheckWaitResult =
  | {
      status: "success";
      summary: string;
      attempts: number;
    }
  | {
      status: "fix-needed";
      summary: string;
      attempts: number;
      failedChecks: Array<{ name: string; conclusion?: string; url?: string }>;
    }
  | {
      status: "blocked";
      summary: string;
      attempts: number;
      retryCommand: string;
    };

export async function waitForPullRequestChecks(input: {
  prNumber: number;
  issueNumber?: number;
  maxAttempts: number;
  intervalMs: number;
  fetchChecks(): Promise<PullRequestCheckSignal[]>;
  sleep(intervalMs: number): Promise<void>;
}): Promise<PullRequestCheckWaitResult> {
  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    let checks: PullRequestCheckSignal[];
    try {
      checks = await input.fetchChecks();
    } catch (error) {
      return {
        status: "blocked",
        summary: `GitHub checks unavailable for PR #${input.prNumber}: ${getErrorMessage(error)}`,
        attempts: attempt,
        retryCommand: buildRetryCommand(input),
      };
    }

    const failedChecks = checks.filter(isFailedCheck);
    if (failedChecks.length > 0) {
      return {
        status: "fix-needed",
        summary: `${failedChecks.length} check(s) failed: ${failedChecks.map(formatFailedCheck).join(", ")}`,
        attempts: attempt,
        failedChecks: failedChecks.map((check) => ({
          name: check.name,
          conclusion: check.conclusion,
          url: check.url,
        })),
      };
    }

    const pendingChecks = checks.filter(isPendingCheck);
    if (pendingChecks.length === 0) {
      return {
        status: "success",
        summary:
          checks.length === 0
            ? "No checks were reported for this pull request."
            : `All ${checks.length} reported check(s) passed.`,
        attempts: attempt,
      };
    }

    if (attempt < input.maxAttempts) {
      await input.sleep(input.intervalMs);
    } else {
      return {
        status: "blocked",
        summary: `Checks did not finish after ${attempt} attempt(s): ${pendingChecks.map(formatPendingCheck).join(", ")}`,
        attempts: attempt,
        retryCommand: buildRetryCommand(input),
      };
    }
  }

  return {
    status: "blocked",
    summary: "Check polling did not run.",
    attempts: 0,
    retryCommand: buildRetryCommand(input),
  };
}

function isFailedCheck(check: PullRequestCheckSignal): boolean {
  return (
    check.status === "completed" &&
    check.conclusion !== undefined &&
    check.conclusion !== "success" &&
    check.conclusion !== "neutral" &&
    check.conclusion !== "skipped"
  );
}

function isPendingCheck(check: PullRequestCheckSignal): boolean {
  return check.status !== "completed";
}

function formatFailedCheck(check: PullRequestCheckSignal): string {
  return `${check.name} (${check.conclusion ?? "unknown"})`;
}

function formatPendingCheck(check: PullRequestCheckSignal): string {
  return `${check.name} (${check.status})`;
}

function buildRetryCommand(input: { issueNumber?: number; prNumber: number }): string {
  return input.issueNumber
    ? `prs issue ${input.issueNumber} --jdi`
    : `prs pr ${input.prNumber} ready --jdi`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
