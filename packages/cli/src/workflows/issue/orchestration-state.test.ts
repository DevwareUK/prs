import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ISSUE_ORCHESTRATION_STAGES,
  createIssueOrchestrationState,
  getIssueOrchestrationStateFilePath,
  getNextIssueOrchestrationStage,
  loadIssueOrchestrationState,
  summarizeIssueOrchestrationState,
  updateIssueOrchestrationStage,
} from "./orchestration-state";

describe("issue orchestration state", () => {
  it("creates a resumable state file with every pipeline stage pending", () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestration-"));
    const state = createIssueOrchestrationState({
      runDir,
      issueNumber: 311,
      prNumber: 411,
      now: "2026-06-19T09:00:00.000Z",
    });

    expect(existsSync(getIssueOrchestrationStateFilePath(runDir))).toBe(true);
    expect(state).toMatchObject({
      version: 1,
      issueNumber: 311,
      prNumber: 411,
      createdAt: "2026-06-19T09:00:00.000Z",
      updatedAt: "2026-06-19T09:00:00.000Z",
    });
    expect(state.stages.map((stage) => stage.name)).toEqual(ISSUE_ORCHESTRATION_STAGES);
    expect(state.stages.every((stage) => stage.status === "pending")).toBe(true);
    expect(getNextIssueOrchestrationStage(state)?.name).toBe("prepare");
  });

  it("updates stage results and resumes at the first incomplete stage", () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestration-"));
    createIssueOrchestrationState({
      runDir,
      issueNumber: 311,
      now: "2026-06-19T09:00:00.000Z",
    });

    updateIssueOrchestrationStage({
      runDir,
      stage: "prepare",
      status: "complete",
      summary: "Issue context and branch are ready.",
      now: "2026-06-19T09:01:00.000Z",
    });
    const state = updateIssueOrchestrationStage({
      runDir,
      stage: "implement",
      status: "blocked",
      summary: "Codex implementation paused for credentials.",
      retryCommand: "prs issue 311 --jdi",
      now: "2026-06-19T09:02:00.000Z",
    });

    expect(state.updatedAt).toBe("2026-06-19T09:02:00.000Z");
    expect(getNextIssueOrchestrationStage(state)).toMatchObject({
      name: "implement",
      status: "blocked",
      retryCommand: "prs issue 311 --jdi",
    });
    expect(summarizeIssueOrchestrationState(state)).toEqual({
      complete: 1,
      skipped: 0,
      blocked: 1,
      failed: 0,
      pending: ISSUE_ORCHESTRATION_STAGES.length - 2,
      running: 0,
    });
  });

  it("rejects malformed state files with a useful recovery message", () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestration-"));
    writeFileSync(
      getIssueOrchestrationStateFilePath(runDir),
      JSON.stringify({ version: 1, issueNumber: 311, stages: [{ name: "made-up" }] }),
      "utf8"
    );

    expect(() => loadIssueOrchestrationState(runDir)).toThrow(
      /Issue orchestration state .* is malformed/
    );
  });

  it("rejects state files with reordered or duplicated stages", () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-issue-orchestration-"));
    const state = createIssueOrchestrationState({
      runDir,
      issueNumber: 311,
      now: "2026-06-19T09:00:00.000Z",
    });
    writeFileSync(
      getIssueOrchestrationStateFilePath(runDir),
      `${JSON.stringify(
        {
          ...state,
          stages: [
            state.stages[1],
            state.stages[0],
            ...state.stages.slice(2),
          ],
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(() => loadIssueOrchestrationState(runDir)).toThrow(
      /Issue orchestration state .* is malformed/
    );
  });
});
