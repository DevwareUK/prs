import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatIssueTokenUsageAuditSection,
  formatIssueTokenUsageLedgerAuditSection,
  getIssueTokenUsageArtifactFilePath,
  issueTokenUsageArtifactToLedgerRow,
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

  it("writes lifecycle state for partially tracked goal usage", () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-token-usage-"));
    cleanupTargets.add(runDir);
    const artifactPath = getIssueTokenUsageArtifactFilePath(runDir);

    writeIssueTokenUsageArtifact(artifactPath, {
      version: 1,
      status: "partial",
      issueNumber: 270,
      capturedAt: "2026-06-11T16:20:00.000Z",
      source: "codex-goal",
      capturePhase: "pre-audit-publish",
      auditPublication: {
        status: "not-published",
        target: "issue",
        section: "token-usage",
      },
      goal: {
        objective: "Complete PRS issue #270",
        status: "complete",
      },
      notes: ["Codex goal was already complete before the final audit was published."],
    });

    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toMatchObject({
      capturePhase: "pre-audit-publish",
      auditPublication: {
        status: "not-published",
        target: "issue",
        section: "token-usage",
      },
    });
  });

  it("writes planner workflow identity for create and refine runs", () => {
    const runDir = mkdtempSync(resolve(tmpdir(), "prs-token-usage-"));
    cleanupTargets.add(runDir);
    const artifactPath = getIssueTokenUsageArtifactFilePath(runDir);

    writeIssueTokenUsageArtifact(artifactPath, {
      version: 1,
      status: "tracked",
      issueNumber: 285,
      capturedAt: "2026-06-12T18:00:00.000Z",
      source: "codex-goal",
      workflow: {
        name: "issue-create",
        role: "planner",
        runDir: ".prs/runs/20260612T180000000Z-issue-draft",
        targetIssueNumber: 285,
      },
      capturePhase: "post-audit-publish",
      auditPublication: {
        status: "published",
        target: "issue",
        section: "token-usage",
        publishedAt: "2026-06-12T18:01:00.000Z",
      },
      model: {
        profile: "premium",
        role: "planner",
        model: "gpt-5.5",
        thinking: "high",
        source: "configured-role",
      },
      usage: {
        totalTokens: 23456,
        timeUsedSeconds: 420,
      },
    });

    expect(JSON.parse(readFileSync(artifactPath, "utf8"))).toMatchObject({
      workflow: {
        name: "issue-create",
        role: "planner",
        targetIssueNumber: 285,
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

    expect(
      formatIssueTokenUsageAuditSection({
        version: 1,
        status: "partial",
        issueNumber: 270,
        capturedAt: "2026-06-11T16:20:00.000Z",
        source: "codex-goal",
        capturePhase: "pre-audit-publish",
        auditPublication: {
          status: "publish-failed",
          target: "issue",
          section: "token-usage",
          error: "GitHub authentication is required.",
        },
        notes: ["Codex goal was already complete before the final audit was published."],
      })
    ).toContain("Audit publication: publish-failed issue token-usage");

    expect(
      formatIssueTokenUsageAuditSection({
        version: 1,
        status: "tracked",
        issueNumber: 285,
        capturedAt: "2026-06-12T18:00:00.000Z",
        source: "codex-goal",
        workflow: {
          name: "issue-refine-complete",
          role: "planner",
          sourceIssueNumber: 285,
          runDir: ".prs/runs/20260612T180000000Z-issue-refine-285",
        },
        model: {
          profile: "premium",
          role: "planner",
          model: "gpt-5.5",
          thinking: "high",
          source: "configured-role",
        },
      })
    ).toContain("Workflow: issue-refine-complete");
  });

  it("renders a single issue-lifetime token usage ledger table", () => {
    const markdown = formatIssueTokenUsageLedgerAuditSection({
      issueNumber: 287,
      rows: [
        {
          phase: "issue-create",
          role: "planner",
          model: "gpt-5.5",
          modelSource: "actual",
          status: "tracked",
          totalTokens: 12000,
          inputTokens: 9000,
          outputTokens: 3000,
          elapsedSeconds: 420,
          capturedAt: "2026-06-12T18:00:00.000Z",
          runDir: ".prs/runs/20260612T180000000Z-issue-draft",
        },
        {
          phase: "issue-implementation",
          role: "implementer",
          model: "gpt-5.4-mini",
          modelSource: "actual",
          status: "partial",
          totalTokens: 50000,
          capturedAt: "2026-06-12T20:00:00.000Z",
          runDir: ".prs/runs/20260612T200000000Z-issue-287",
          notes: ["Output token count was unavailable."],
        },
      ],
    });

    expect(markdown).toContain("Codex token usage ledger for issue #287.");
    expect(markdown).toContain(
      "| Phase | Role | Model | Model source | Status | Total tokens | Input | Output | Elapsed | Captured | Run | Notes |"
    );
    expect(markdown).toContain(
      "| issue-create | planner | gpt-5.5 | actual | tracked | 12,000 | 9,000 | 3,000 | 7m 0s | 2026-06-12T18:00:00.000Z | .prs/runs/20260612T180000000Z-issue-draft |  |"
    );
    expect(markdown).toContain(
      "| issue-implementation | implementer | gpt-5.4-mini | actual | partial | 50,000 |  |  |  | 2026-06-12T20:00:00.000Z | .prs/runs/20260612T200000000Z-issue-287 | Output token count was unavailable. |"
    );
    expect(markdown).toContain(
      "This ledger reports available Codex run telemetry, not exact billing."
    );
  });

  it("prefers the actual active model over configured fallback metadata", () => {
    const markdown = formatIssueTokenUsageLedgerAuditSection({
      issueNumber: 287,
      rows: [
        {
          phase: "issue-create",
          role: "planner",
          model: "gpt-5.5",
          modelSource: "actual",
          configuredModel: "gpt-5.4-mini",
          configuredProfile: "standard",
          status: "tracked",
          totalTokens: 12000,
          capturedAt: "2026-06-12T18:00:00.000Z",
        },
      ],
    });

    expect(markdown).toContain("| issue-create | planner | gpt-5.5 | actual |");
    expect(markdown).not.toContain("gpt-5.4-mini");
  });

  it("converts token usage artifacts into ledger rows", () => {
    expect(
      issueTokenUsageArtifactToLedgerRow({
        version: 1,
        status: "tracked",
        issueNumber: 287,
        capturedAt: "2026-06-12T18:00:00.000Z",
        source: "codex-goal",
        workflow: {
          name: "issue-create",
          role: "planner",
          runDir: ".prs/runs/20260612T180000000Z-issue-draft",
        },
        model: {
          profile: "premium",
          role: "planner",
          model: "gpt-5.5",
          thinking: "high",
          source: "codex-session",
          configuredModel: "gpt-5.4-mini",
        },
        usage: {
          inputTokens: 9000,
          outputTokens: 3000,
          totalTokens: 12000,
          timeUsedSeconds: 420,
        },
        auditPublication: {
          status: "published",
          target: "issue",
          section: "token-usage",
        },
      })
    ).toEqual({
      phase: "issue-create",
      role: "planner",
      model: "gpt-5.5",
      modelSource: "actual",
      configuredModel: "gpt-5.4-mini",
      status: "tracked",
      totalTokens: 12000,
      inputTokens: 9000,
      outputTokens: 3000,
      elapsedSeconds: 420,
      capturedAt: "2026-06-12T18:00:00.000Z",
      runDir: ".prs/runs/20260612T180000000Z-issue-draft",
      notes: ["Audit publication: published issue token-usage"],
    });
  });
});
