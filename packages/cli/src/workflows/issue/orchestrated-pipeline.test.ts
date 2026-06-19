import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getNextIssueOrchestrationStage, loadIssueOrchestrationState } from "./orchestration-state";
import { runIssueOrchestratedPipeline } from "./orchestrated-pipeline";

describe("runIssueOrchestratedPipeline", () => {
  it("runs the full PR lifecycle after issue implementation opens a pull request", async () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestrated-pipeline-"));
    const calls: string[] = [];

    const result = await runIssueOrchestratedPipeline({
      runDir,
      issueNumber: 311,
      branchName: "codex/issue-311",
      committed: true,
      pullRequest: {
        status: "created",
        title: "Make /prs issue --jdi orchestrated",
        url: "https://github.com/DevwareUK/prs/pull/411",
      },
      now: "2026-06-19T10:00:00.000Z",
      hooks: {
        readyPullRequest: async (prNumber) => {
          calls.push(`ready:${prNumber}`);
          return { status: "ready", summary: "PR readiness passed." };
        },
        reviewPullRequest: async (prNumber) => {
          calls.push(`review:${prNumber}`);
          return { status: "complete", summary: "Review artifacts written." };
        },
        publishReview: async (prNumber) => {
          calls.push(`publish:${prNumber}`);
          return { status: "complete", summary: "Review published." };
        },
        addressComments: async (prNumber) => {
          calls.push(`comments:${prNumber}`);
          return { status: "skipped", summary: "No actionable review comments." };
        },
        waitForCi: async (prNumber) => {
          calls.push(`wait-ci:${prNumber}`);
          return { status: "success", summary: "CI passed." };
        },
        fixCi: async () => {
          throw new Error("CI fix should not run when CI is already passing");
        },
        finalAudit: async (prNumber) => {
          calls.push(`audit:${prNumber}`);
          return { status: "complete", summary: "Final audit published." };
        },
      },
    });

    expect(calls).toEqual([
      "ready:411",
      "review:411",
      "publish:411",
      "comments:411",
      "wait-ci:411",
      "audit:411",
    ]);
    expect(result).toMatchObject({ status: "complete", prNumber: 411 });
    const state = loadIssueOrchestrationState(runDir);
    expect(state.stages.map((stage) => [stage.name, stage.status])).toEqual([
      ["prepare", "complete"],
      ["implement", "complete"],
      ["local-verify", "complete"],
      ["open-pr", "complete"],
      ["pr-ready", "complete"],
      ["pr-review", "complete"],
      ["publish-review", "complete"],
      ["address-comments", "skipped"],
      ["wait-ci", "complete"],
      ["fix-ci", "skipped"],
      ["final-audit", "complete"],
    ]);
    expect(getNextIssueOrchestrationStage(state)).toBeUndefined();
  });

  it("blocks with retry guidance when PR readiness is blocked", async () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestrated-pipeline-"));

    const result = await runIssueOrchestratedPipeline({
      runDir,
      issueNumber: 311,
      branchName: "codex/issue-311",
      committed: true,
      pullRequest: {
        status: "created",
        title: "Make /prs issue --jdi orchestrated",
        url: "https://github.com/DevwareUK/prs/pull/411",
      },
      now: "2026-06-19T10:00:00.000Z",
      hooks: {
        readyPullRequest: async () => ({
          status: "blocked",
          summary: "Base sync hit merge conflicts.",
          retryCommand: "prs pr 411 resolve-conflicts",
        }),
        reviewPullRequest: async () => {
          throw new Error("review should not run when readiness is blocked");
        },
        publishReview: async () => {
          throw new Error("publish should not run when readiness is blocked");
        },
        addressComments: async () => {
          throw new Error("comments should not run when readiness is blocked");
        },
        waitForCi: async () => {
          throw new Error("CI wait should not run when readiness is blocked");
        },
        fixCi: async () => {
          throw new Error("CI fix should not run when readiness is blocked");
        },
        finalAudit: async () => {
          throw new Error("audit should not run when readiness is blocked");
        },
      },
    });

    expect(result).toEqual({
      status: "blocked",
      stage: "pr-ready",
      prNumber: 411,
      retryCommand: "prs pr 411 resolve-conflicts",
    });
    expect(getNextIssueOrchestrationStage(loadIssueOrchestrationState(runDir))).toMatchObject({
      name: "pr-ready",
      status: "blocked",
      retryCommand: "prs pr 411 resolve-conflicts",
    });
  });

  it("skips PR lifecycle stages when no pull request was created", async () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestrated-pipeline-"));

    const result = await runIssueOrchestratedPipeline({
      runDir,
      issueNumber: 311,
      branchName: "codex/issue-311",
      committed: false,
      pullRequest: { status: "skipped", reason: "no-changes" },
      now: "2026-06-19T10:00:00.000Z",
      hooks: {
        readyPullRequest: async () => {
          throw new Error("readiness should not run without a PR");
        },
        reviewPullRequest: async () => {
          throw new Error("review should not run without a PR");
        },
        publishReview: async () => {
          throw new Error("publish should not run without a PR");
        },
        addressComments: async () => {
          throw new Error("comments should not run without a PR");
        },
        waitForCi: async () => {
          throw new Error("CI wait should not run without a PR");
        },
        fixCi: async () => {
          throw new Error("CI fix should not run without a PR");
        },
        finalAudit: async () => {
          throw new Error("audit should not run without a PR");
        },
      },
    });

    expect(result).toEqual({ status: "skipped", reason: "no-pull-request" });
    const state = loadIssueOrchestrationState(runDir);
    expect(state.stages.find((stage) => stage.name === "open-pr")).toMatchObject({
      status: "skipped",
      summary: "Pull request was not created: no-changes.",
    });
    expect(state.stages.find((stage) => stage.name === "pr-ready")).toMatchObject({
      status: "skipped",
    });
    expect(getNextIssueOrchestrationStage(state)).toBeUndefined();
  });

  it("runs a bounded CI fix loop before final audit", async () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestrated-pipeline-"));
    const calls: string[] = [];
    let ciAttempts = 0;

    const result = await runIssueOrchestratedPipeline({
      runDir,
      issueNumber: 311,
      branchName: "codex/issue-311",
      committed: true,
      pullRequest: {
        status: "created",
        title: "Make /prs issue --jdi orchestrated",
        url: "https://github.com/DevwareUK/prs/pull/411",
      },
      now: "2026-06-19T10:00:00.000Z",
      maxCiFixAttempts: 1,
      hooks: {
        readyPullRequest: async () => ({ status: "ready", summary: "Ready." }),
        reviewPullRequest: async () => ({ status: "complete", summary: "Reviewed." }),
        publishReview: async () => ({ status: "complete", summary: "Published." }),
        addressComments: async () => ({ status: "skipped", summary: "No comments." }),
        waitForCi: async () => {
          ciAttempts += 1;
          calls.push(`wait:${ciAttempts}`);
          return ciAttempts === 1
            ? { status: "fix-needed", summary: "Build failed." }
            : { status: "success", summary: "CI passed after fix." };
        },
        fixCi: async () => {
          calls.push("fix-ci");
          return { status: "complete", summary: "Pushed CI fix." };
        },
        finalAudit: async () => {
          calls.push("audit");
          return { status: "complete", summary: "Final audit published." };
        },
      },
    });

    expect(result).toMatchObject({ status: "complete", prNumber: 411 });
    expect(calls).toEqual(["wait:1", "fix-ci", "wait:2", "audit"]);
    expect(loadIssueOrchestrationState(runDir).stages.find((stage) => stage.name === "fix-ci")).toMatchObject({
      status: "complete",
      summary: "Pushed CI fix.",
    });
  });

  it("blocks before completion when final audit publication fails", async () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestrated-pipeline-"));

    const result = await runIssueOrchestratedPipeline({
      runDir,
      issueNumber: 311,
      branchName: "codex/issue-311",
      committed: true,
      pullRequest: {
        status: "created",
        title: "Make /prs issue --jdi orchestrated",
        url: "https://github.com/DevwareUK/prs/pull/411",
      },
      now: "2026-06-19T10:00:00.000Z",
      hooks: {
        readyPullRequest: async () => ({ status: "ready", summary: "Ready." }),
        reviewPullRequest: async () => ({ status: "complete", summary: "Reviewed." }),
        publishReview: async () => ({ status: "complete", summary: "Published." }),
        addressComments: async () => ({ status: "skipped", summary: "No comments." }),
        waitForCi: async () => ({ status: "success", summary: "CI passed." }),
        fixCi: async () => ({ status: "skipped", summary: "CI fix was not needed." }),
        finalAudit: async () => ({
          status: "blocked",
          summary: "GitHub audit publication failed.",
          retryCommand: "prs audit publish --issue 311 --file .prs/runs/final.md --section completion",
        }),
      },
    });

    expect(result).toEqual({
      status: "blocked",
      stage: "final-audit",
      prNumber: 411,
      retryCommand: "prs audit publish --issue 311 --file .prs/runs/final.md --section completion",
    });
    expect(getNextIssueOrchestrationStage(loadIssueOrchestrationState(runDir))).toMatchObject({
      name: "final-audit",
      status: "blocked",
    });
  });
});
