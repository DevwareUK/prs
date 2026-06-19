import { describe, expect, it } from "vitest";
import { waitForPullRequestChecks } from "./check-waiter";

describe("waitForPullRequestChecks", () => {
  it("polls pending checks until they succeed", async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    const result = await waitForPullRequestChecks({
      prNumber: 411,
      maxAttempts: 3,
      intervalMs: 25,
      sleep: async (intervalMs) => {
        sleeps.push(intervalMs);
      },
      fetchChecks: async () => {
        attempts += 1;
        return attempts === 1
          ? [{ name: "build", status: "in-progress" }]
          : [{ name: "build", status: "completed", conclusion: "success" }];
      },
    });

    expect(result).toEqual({
      status: "success",
      summary: "All 1 reported check(s) passed.",
      attempts: 2,
    });
    expect(sleeps).toEqual([25]);
  });

  it("returns fix-needed when any check fails", async () => {
    const result = await waitForPullRequestChecks({
      prNumber: 411,
      maxAttempts: 3,
      intervalMs: 25,
      sleep: async () => {},
      fetchChecks: async () => [
        { name: "build", status: "completed", conclusion: "failure", url: "https://ci.test/build" },
      ],
    });

    expect(result).toEqual({
      status: "fix-needed",
      summary: "1 check(s) failed: build (failure)",
      attempts: 1,
      failedChecks: [{ name: "build", conclusion: "failure", url: "https://ci.test/build" }],
    });
  });

  it("blocks after bounded polling when checks remain pending", async () => {
    const result = await waitForPullRequestChecks({
      prNumber: 411,
      issueNumber: 311,
      maxAttempts: 2,
      intervalMs: 25,
      sleep: async () => {},
      fetchChecks: async () => [{ name: "build", status: "queued" }],
    });

    expect(result).toEqual({
      status: "blocked",
      summary: "Checks did not finish after 2 attempt(s): build (queued)",
      attempts: 2,
      retryCommand: "prs issue 311 --jdi",
    });
  });

  it("blocks when check data is unavailable", async () => {
    const result = await waitForPullRequestChecks({
      prNumber: 411,
      issueNumber: 311,
      maxAttempts: 2,
      intervalMs: 25,
      sleep: async () => {},
      fetchChecks: async () => {
        throw new Error("GitHub unavailable");
      },
    });

    expect(result).toEqual({
      status: "blocked",
      summary: "GitHub checks unavailable for PR #411: GitHub unavailable",
      attempts: 1,
      retryCommand: "prs issue 311 --jdi",
    });
  });
});
