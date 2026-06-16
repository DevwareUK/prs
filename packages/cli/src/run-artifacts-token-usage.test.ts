import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatIssueTokenUsageAuditSection,
  formatIssueTokenUsageLedgerAuditSection,
  formatTokenUsageLedgerAuditSection,
  getIssueTokenUsageArtifactFilePath,
  issueTokenUsageArtifactToLedgerRow,
  writeIssueTokenUsageArtifact,
} from "./run-artifacts";
import {
  parseTokenUsageLedgerRowFromContent,
  parseTokenUsageLedgerRowsFromContent,
} from "./token-audit";

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
          totalTokens: 60000,
          capturedAt: "2026-06-12T20:00:00.000Z",
          runDir: ".prs/runs/20260612T200000000Z-issue-287",
          notes: ["Output token count was unavailable."],
        },
      ],
    });

    expect(markdown).toContain("Codex token telemetry ledger for issue #287.");
    expect(markdown).toContain(
      "| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |"
    );
    expect(markdown).toContain(
      "| issue-create | planner | gpt-5.5 | actual | tracked | 12,000 | $0.12 | 7m 0s | 2026-06-12T18:00:00.000Z |"
    );
    expect(markdown).toContain(
      "| issue-implementation | implementer | gpt-5.4-mini | actual | partial | 60,000 | $0.09 |  | 2026-06-12T20:00:00.000Z |"
    );
    expect(markdown).not.toContain("Input");
    expect(markdown).not.toContain("Output");
    expect(markdown).not.toContain("Run");
    expect(markdown).not.toContain("Notes");
    expect(markdown).not.toContain(".prs/runs/20260612T180000000Z-issue-draft");
    expect(markdown).not.toContain("Output token count was unavailable.");
    expect(markdown).toContain(
      "This ledger reports available Codex run telemetry and planning forecasts, not exact billing."
    );
  });

  it("renders a single PR-lifetime token usage ledger table", () => {
    const markdown = formatTokenUsageLedgerAuditSection({
      target: {
        type: "pull-request",
        number: 88,
      },
      rows: [
        {
          phase: "pr-review",
          role: "reviewer",
          model: "gpt-5.5",
          modelSource: "actual",
          status: "tracked",
          totalTokens: 32100,
          elapsedSeconds: 255,
          capturedAt: "2026-06-14T08:00:00.000Z",
        },
      ],
    });

    expect(markdown).toContain("Codex token telemetry ledger for PR #88.");
    expect(markdown).toContain(
      "| pr-review | reviewer | gpt-5.5 | actual | tracked | 32,100 |"
    );
    expect(markdown).toContain(
      "This ledger reports available Codex run telemetry and planning forecasts, not exact billing."
    );
  });

  it("leaves ledger estimated cost blank when token or model data is unavailable", () => {
    const markdown = formatIssueTokenUsageLedgerAuditSection({
      issueNumber: 287,
      rows: [
        {
          phase: "issue-create",
          role: "planner",
          modelSource: "unavailable",
          status: "unavailable",
          capturedAt: "2026-06-12T18:00:00.000Z",
        },
      ],
    });

    expect(markdown).toContain(
      "| issue-create | planner |  | unavailable | unavailable |  |  |  | 2026-06-12T18:00:00.000Z |"
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
        id: "issue-287:issue-create:thread-287",
        status: "tracked",
        issueNumber: 287,
        capturedAt: "2026-06-12T18:00:00.000Z",
        source: "codex-goal",
        goal: {
          threadId: "thread-287",
        },
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
      id: "issue-287:issue-create:thread-287",
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
      sessionId: "thread-287",
      notes: ["Audit publication: published issue token-usage"],
    });
  });

  it("extracts goal-reported token totals from partial continuation notes", () => {
    expect(
      parseTokenUsageLedgerRowFromContent(
        JSON.stringify({
          status: "partial",
          capturedAt: "2026-06-15T14:33:00+01:00",
          objective: "Draft GitHub Issue: Faro transport fetch failures on staging",
          note:
            "Planner token usage was captured from the active Codex app goal after the approved prs create draft. Goal tool reported 76253 tokens used and 152 seconds elapsed before later approval edits; exact create-run scoped usage is not available.",
        })
      )
    ).toMatchObject({
      phase: "issue-create",
      role: "planner",
      status: "partial",
      totalTokens: 76253,
      elapsedSeconds: 152,
      capturedAt: "2026-06-15T14:33:00+01:00",
    });
  });

  it("parses append-only token usage ledger entries from one artifact", () => {
    expect(
      parseTokenUsageLedgerRowsFromContent(
        JSON.stringify({
          version: 1,
          kind: "token-usage-ledger",
          target: { type: "issue", number: 239 },
          entries: [
            {
              version: 1,
              status: "partial",
              target: { type: "issue", number: 239 },
              capturedAt: "2026-06-15T14:33:00+01:00",
              source: "codex-goal",
              workflow: {
                name: "issue-create",
                role: "planner",
                runDir: ".prs/runs/create",
              },
              usage: {
                totalTokens: 76253,
                timeUsedSeconds: 152,
              },
            },
            {
              version: 1,
              status: "tracked",
              target: { type: "issue", number: 239 },
              capturedAt: "2026-06-15T15:20:00+01:00",
              source: "codex-goal",
              workflow: {
                name: "issue-implementation",
                role: "implementer",
                runDir: ".prs/runs/issue-239",
              },
              usage: {
                totalTokens: 88100,
                timeUsedSeconds: 423,
              },
            },
          ],
        })
      )
    ).toMatchObject([
      {
        phase: "issue-create",
        role: "planner",
        totalTokens: 76253,
        elapsedSeconds: 152,
      },
      {
        phase: "issue-implementation",
        role: "implementer",
        totalTokens: 88100,
        elapsedSeconds: 423,
      },
    ]);
  });

  it("parses prs create ledger entries with top-level goal usage fields", () => {
    expect(
      parseTokenUsageLedgerRowsFromContent(
        JSON.stringify({
          version: 1,
          kind: "token-usage-ledger",
          entries: [
            {
              id: "issue-draft-20260615T164420Z-codex-app-session",
              phase: "issue-draft",
              recordedAt: "2026-06-15T16:44:20Z",
              status: "available",
              objective:
                "Draft GitHub Issue: Fix production asset build missing vendor CKEditor path",
              tokensUsed: 109535,
              timeUsedSeconds: 176,
              model: "unavailable",
              notes:
                "Usage recorded from the active Codex goal after local draft artifacts were generated.",
            },
          ],
        })
      )
    ).toMatchObject([
      {
        id: "issue-draft-20260615T164420Z-codex-app-session",
        phase: "issue-draft",
        role: "planner",
        modelSource: "unavailable",
        status: "tracked",
        totalTokens: 109535,
        elapsedSeconds: 176,
        capturedAt: "2026-06-15T16:44:20Z",
      },
    ]);
  });

  it("treats operator-provided active model metadata as actual provenance", () => {
    expect(
      issueTokenUsageArtifactToLedgerRow({
        version: 1,
        status: "tracked",
        issueNumber: 287,
        capturedAt: "2026-06-12T18:00:00.000Z",
        source: "codex-goal",
        workflow: {
          name: "issue-implementation",
          role: "implementer",
        },
        model: {
          profile: "premium",
          role: "implementer",
          model: "gpt-5.5",
          thinking: "high",
          source: "operator-provided",
          configuredModel: "gpt-5.4-mini",
        },
      })
    ).toMatchObject({
      model: "gpt-5.5",
      modelSource: "actual",
      configuredModel: "gpt-5.4-mini",
    });
  });
});
