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
        profile: "standard",
        role: "implementer",
        model: "gpt-5.4-mini",
        thinking: "medium",
        source: "configured-role",
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
        profile: "standard",
        role: "implementer",
        model: "gpt-5.4-mini",
        thinking: "medium",
        source: "configured-role",
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
          profile: "standard",
          role: "implementer",
          model: "gpt-5.4-mini",
          thinking: "medium",
          source: "configured-role",
        },
        usage: {
          totalTokens: 12345,
          timeUsedSeconds: 367,
        },
      })
    ).toContain("Model/profile: standard (gpt-5.4-mini, medium thinking)");

    expect(
      formatIssueTokenUsageAuditSection({
        version: 1,
        status: "unavailable",
        issueNumber: 270,
        capturedAt: "2026-06-11T16:20:00.000Z",
        source: "codex-goal",
        model: {
          profile: "premium",
          role: "planner",
          model: "gpt-5.5",
          thinking: "high",
          source: "configured-role",
        },
        notes: ["Codex goal usage was not exposed in this session."],
      })
    ).toContain("Model/profile: premium (gpt-5.5, high thinking)");
  });
});
