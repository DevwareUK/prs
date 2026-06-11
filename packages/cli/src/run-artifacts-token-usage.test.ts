import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatIssueTokenUsageAuditSection,
  getIssueTokenUsageArtifactFilePath,
  writeIssueTokenUsageArtifact,
} from "./run-artifacts";

const cleanupTargets = new Set<string>();

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

describe("issue token usage artifacts", () => {
  it("writes structured Codex goal usage under the issue run directory", () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-token-usage-"));
    cleanupTargets.add(runDir);
    const artifactPath = getIssueTokenUsageArtifactFilePath(runDir);

    writeIssueTokenUsageArtifact(artifactPath, {
      version: 1,
      status: "tracked",
      issueNumber: 270,
      capturedAt: "2026-06-11T16:20:00.000Z",
      source: "codex-goal",
      goal: {
        threadId: "thread-123",
        objective: "Complete PRS issue #270",
        status: "active",
      },
      model: {
        id: "gpt-5",
        source: "codex-session",
      },
      usage: {
        totalTokens: 12345,
        timeUsedSeconds: 367,
      },
    });

    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toEqual({
      version: 1,
      status: "tracked",
      issueNumber: 270,
      capturedAt: "2026-06-11T16:20:00.000Z",
      source: "codex-goal",
      goal: {
        threadId: "thread-123",
        objective: "Complete PRS issue #270",
        status: "active",
      },
      model: {
        id: "gpt-5",
        source: "codex-session",
      },
      usage: {
        totalTokens: 12345,
        timeUsedSeconds: 367,
      },
    });
  });

  it("renders concise audit markdown for tracked and unavailable token usage", () => {
    expect(
      formatIssueTokenUsageAuditSection({
        version: 1,
        status: "tracked",
        issueNumber: 270,
        capturedAt: "2026-06-11T16:20:00.000Z",
        source: "codex-goal",
        model: {
          id: "gpt-5",
          source: "codex-session",
        },
        usage: {
          totalTokens: 12345,
          timeUsedSeconds: 367,
        },
      })
    ).toContain("Model: gpt-5");

    expect(
      formatIssueTokenUsageAuditSection({
        version: 1,
        status: "unavailable",
        issueNumber: 270,
        capturedAt: "2026-06-11T16:20:00.000Z",
        source: "codex-goal",
        model: {
          id: "gpt-5",
          source: "manual",
        },
        notes: ["Codex goal usage was not exposed in this session."],
      })
    ).toContain("Model: gpt-5");
  });
});
