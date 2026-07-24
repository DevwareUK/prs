import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
import {
  createIssueEstimateContext,
  estimateIssueTool,
  publishAutomaticIssueEstimate,
  publishIssueEstimateAudit,
  publishIssueEstimateFile,
  renderIssueEstimate,
} from "./issue-estimate-tool";
import {
  TOKEN_USAGE_COMMENT_MARKER,
  parseTokenUsageRowsFromCommentBody,
} from "./token-usage-comments";

describe("issue estimate tool", () => {
  it("creates a plan-first Codex estimate context without scanning repository files", async () => {
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 10,
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-10",
        updatedAt: "2026-06-11T08:47:44Z",
        body: [
          "<!-- prs:issue-plan -->",
          "# Implementation Plan",
          "",
          "## Task 1: Update docs",
          "- [ ] Update the command reference.",
        ].join("\n"),
      }),
    };

    const context = await createIssueEstimateContext({
      issueNumber: 267,
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(context.status).toBe("ready");
    if (context.status === "ready") {
      expect(context.plan.body).toContain("## Task 1");
      expect(context.planSource.url).toBe(
        "https://github.com/DevwareUK/prs/issues/267#issuecomment-10"
      );
      expect(context.profiles).toEqual([]);
      expect(context.estimateInstructions).toContain("Use the managed issue plan");
      expect(JSON.stringify(context)).not.toContain("scanBudget");
      expect(JSON.stringify(context)).not.toContain("likelyFiles");
    }
  });

  it("publishes a Codex-authored estimate JSON artifact to the token telemetry comment", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-"));
    const estimatePath = resolve(repoRoot, "estimate.json");
    writeFileSync(
      estimatePath,
      JSON.stringify({
        status: "estimated",
        issueNumber: 267,
        planSource: {
          type: "managed-comment",
          url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-10",
          updatedAt: "2026-06-11T08:47:44Z",
        },
        confidence: "medium",
        profiles: [
          {
            name: "standard",
            role: "implementer, tester",
            model: "gpt-5.4-mini",
            thinking: "medium",
            range: { low: 30000, high: 54000 },
            confidence: "medium",
            notes: ["Codex-authored plan estimate."],
          },
        ],
        recommendation: "Start with standard.",
        drivers: ["Plan has explicit implementation tasks."],
        warnings: [],
        assumptions: ["No repository scan was used."],
      }),
      "utf8"
    );
    const createdComment = {
      id: 4101,
      body: "<!-- prs:token-usage -->\n# Issue #267 token usage\n",
      url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-4101",
      createdAt: "2026-06-11T09:00:00Z",
      updatedAt: "2026-06-11T09:00:00Z",
      author: "prs-bot",
      isBot: true,
    };
    const forge = {
      isAuthenticated: vi.fn(() => true),
      fetchIssueComments: vi.fn().mockResolvedValue([]),
      fetchPullRequestIssueComments: vi.fn(),
      createAuditComment: vi.fn().mockResolvedValue(createdComment),
      updateIssueComment: vi.fn(),
    };

    const publication = await publishIssueEstimateFile({
      issueNumber: 267,
      estimateFilePath: estimatePath,
      forge,
    });

    expect(publication).toEqual({
      status: "created",
      url: createdComment.url,
    });
    const body = forge.createAuditComment.mock.calls[0][1];
    expect(body).toContain(TOKEN_USAGE_COMMENT_MARKER);
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).toContain("Codex token telemetry ledger for issue #267.");
    const visibleBody = body.split("<!-- prs:token-usage-data")[0] ?? body;
    expect(visibleBody).toContain("## Estimates");
    expect(visibleBody).toContain(
      "| standard | implementer, tester | gpt-5.4-mini | medium | medium | 30,000-54,000 |"
    );
    expect(visibleBody).not.toContain("Estimate recommendations:");
    expect(visibleBody).not.toContain("No repository scan was used.");
    const rows = parseTokenUsageRowsFromCommentBody(body);
    expect(rows).toEqual([
      expect.objectContaining({
        id: "issue-estimate:267:standard",
        kind: "estimate",
        phase: "issue-estimate",
        status: "estimated",
        tokenRange: { low: 30000, high: 54000 },
      }),
    ]);
  });

  it("does not invent comparison profiles when repository config has none", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-"));
    writeFileSync(resolve(repoRoot, "README.md"), "# Test repository\n", "utf8");
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 1,
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-1",
        updatedAt: "2026-06-11T08:47:44Z",
        body: [
          "<!-- prs:issue-plan -->",
          "## Likely files",
          "",
          "- `README.md`",
          "",
          "## Steps",
          "",
          "1. Update docs.",
        ].join("\n"),
      }),
    };

    const result = await estimateIssueTool({
      issueNumber: 267,
      repoRoot,
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result.status).toBe("estimated");
    if (result.status === "estimated") {
      expect(result.cost).toMatchObject({
        currency: "USD",
        inputTokenRatio: 0.8,
        outputTokenRatio: 0.2,
      });
      expect(result.profiles).toEqual([]);
    }
  });

  it("returns a blocked JSON-safe result when the issue has no managed plan comment", async () => {
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue(undefined),
    };

    const result = await estimateIssueTool({
      issueNumber: 268,
      repoRoot: mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-")),
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result).toEqual({
      status: "blocked",
      issueNumber: 268,
      message:
        "Issue implementation token estimates require an issue comment containing `<!-- prs:issue-plan -->`. For estimate-ready issues, keep the companion source-of-truth specification in `<!-- prs:issue-spec -->`; the estimator reads the managed plan marker. Publish the managed plan comment or run `prs issue plan <number>` first.",
      nextAction: "create-issue-plan",
    });
    expect(renderIssueEstimate(result)).toContain(
      "Issue #268 implementation estimate is blocked."
    );
    expect(renderIssueEstimate(result)).toContain("<!-- prs:issue-plan -->");
    expect(renderIssueEstimate(result)).toContain("<!-- prs:issue-spec -->");
    expect(renderIssueEstimate(result)).toContain("prs issue plan <number>");
  });

  it("renders missing-file warnings and reached scan limits for human output", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-"));
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 2,
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-2",
        updatedAt: "2026-06-11T08:47:44Z",
        body: [
          "<!-- prs:issue-plan -->",
          "## Likely files",
          "",
          "- `packages/cli/src/missing-01.ts`",
          "- `packages/cli/src/missing-02.ts`",
          "- `packages/cli/src/missing-03.ts`",
          "- `packages/cli/src/missing-04.ts`",
          "- `packages/cli/src/missing-05.ts`",
          "- `packages/cli/src/missing-06.ts`",
          "- `packages/cli/src/missing-07.ts`",
          "- `packages/cli/src/missing-08.ts`",
          "- `packages/cli/src/missing-09.ts`",
          "- `packages/cli/src/missing-10.ts`",
          "- `packages/cli/src/missing-11.ts`",
          "- `packages/cli/src/missing-12.ts`",
          "- `packages/cli/src/missing-13.ts`",
          "",
          "## Steps",
          "",
          "1. Estimate the work.",
        ].join("\n"),
      }),
    };

    const result = await estimateIssueTool({
      issueNumber: 267,
      repoRoot,
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result.status).toBe("estimated");
    if (result.status === "estimated") {
      const rendered = renderIssueEstimate(result);

      expect(result.scanBudget.status).toBe("exhausted");
      expect(result.warnings).toContain("12 repository targets were not found locally.");
      expect(rendered).toContain(
        "| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |"
      );
      expect(rendered).not.toContain("gpt-5.4-mini");
      expect(rendered).not.toContain("$");
      expect(rendered).toContain("Costs are rough planning estimates, not exact billing.");
      expect(rendered).not.toContain("Model/profile estimates:");
      expect(rendered).not.toContain("Per-model blended rates come from PRS defaults");
      expect(rendered).not.toContain("priced from token range");
      expect(rendered).not.toContain("Repository context:");
    }
  });

  it("renders Codex-authored estimate artifacts with the shared table layout", () => {
    const rendered = renderIssueEstimate({
      status: "estimated",
      issueNumber: 267,
      planSource: {
        type: "managed-comment",
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-10",
        updatedAt: "2026-06-11T08:47:44Z",
      },
      confidence: "medium",
      profiles: [
        {
          name: "standard",
          role: "implementer, tester",
          model: "gpt-5.4-mini",
          thinking: "medium",
          range: { low: 30000, high: 54000 },
          confidence: "medium",
          notes: ["Codex-authored plan estimate."],
        },
      ],
      recommendation: "Start with standard.",
      drivers: ["Plan has explicit implementation tasks."],
      warnings: [],
      assumptions: ["No repository scan was used."],
    });

    expect(rendered).toContain(
      "| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |"
    );
    expect(rendered).toContain(
      "| standard | implementer, tester | gpt-5.4-mini | configured | medium | 30,000-54,000 |  |  |  |"
    );
    expect(rendered).not.toContain("Model/profile estimates:");
  });

  it("publishes successful estimates to issue token telemetry", async () => {
    const result = await estimateIssueTool({
      issueNumber: 267,
      repoRoot: mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-")),
      forge: {
        fetchIssuePlanComment: vi.fn().mockResolvedValue({
          id: 3,
          url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-3",
          updatedAt: "2026-06-11T08:47:44Z",
          body: [
            "<!-- prs:issue-plan -->",
            "## Likely files",
            "",
            "- `README.md`",
            "",
            "## Steps",
            "",
            "1. Update docs.",
          ].join("\n"),
        }),
      },
      repositoryConfig: resolveRepositoryConfig(),
    });
    const createdComment = {
      id: 4101,
      body: "<!-- prs:token-usage -->\n# Issue #267 token telemetry\n",
      url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-4101",
      createdAt: "2026-06-11T09:00:00Z",
      updatedAt: "2026-06-11T09:00:00Z",
      author: "prs-bot",
      isBot: true,
    };
    const forge = {
      isAuthenticated: vi.fn(() => true),
      fetchIssueComments: vi.fn().mockResolvedValue([]),
      fetchPullRequestIssueComments: vi.fn(),
      createAuditComment: vi.fn().mockResolvedValue(createdComment),
      updateIssueComment: vi.fn(),
    };

    const publication = await publishIssueEstimateAudit(forge, result);

    expect(publication).toEqual({
      status: "created",
      url: createdComment.url,
    });
    expect(forge.createAuditComment).toHaveBeenCalledWith(
      { type: "issue", number: 267 },
      expect.stringContaining(TOKEN_USAGE_COMMENT_MARKER)
    );
    const body = forge.createAuditComment.mock.calls[0][1];
    expect(body).toContain("Codex token telemetry ledger for issue #267.");
    expect(body).not.toContain("<!-- prs:audit -->");
    const visibleBody = body.split("<!-- prs:token-usage-data")[0] ?? body;
    expect(visibleBody).not.toContain("## Estimates");
    expect(visibleBody).not.toContain("Estimate notes:");
  });

  it("publishes Codex-authored estimate artifacts with fallback cost ranges", async () => {
    const createdComment = {
      id: 4101,
      body: "<!-- prs:token-usage -->\n# Issue #267 token telemetry\n",
      url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-4101",
      createdAt: "2026-06-11T09:00:00Z",
      updatedAt: "2026-06-11T09:00:00Z",
      author: "prs-bot",
      isBot: true,
    };
    const forge = {
      isAuthenticated: vi.fn(() => true),
      fetchIssueComments: vi.fn().mockResolvedValue([]),
      fetchPullRequestIssueComments: vi.fn(),
      createAuditComment: vi.fn().mockResolvedValue(createdComment),
      updateIssueComment: vi.fn(),
    };

    await publishIssueEstimateAudit(forge, {
      status: "estimated",
      issueNumber: 267,
      planSource: {
        type: "managed-comment",
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-10",
        updatedAt: "2026-06-11T08:47:44Z",
      },
      confidence: "medium",
      profiles: [
        {
          name: "future",
          role: "implementer",
          model: "gpt-6",
          thinking: "medium",
          range: { low: 30000, high: 54000 },
          confidence: "medium",
          notes: ["Codex-authored plan estimate."],
        },
      ],
      recommendation: "Start with future.",
      drivers: ["Plan has explicit implementation tasks."],
      warnings: [],
    });

    const body = forge.createAuditComment.mock.calls[0][1];
    expect(body).toContain(
      "| future | implementer | gpt-6 | medium | medium | 30,000-54,000 | $0.30-$0.54 |"
    );
  });

  it("publishes Codex-authored GPT-5.6 estimates with model-specific blended costs", async () => {
    const createdComment = {
      id: 4102,
      body: "<!-- prs:token-usage -->\n# Issue #319 token telemetry\n",
      url: "https://github.com/DevwareUK/prs/issues/319#issuecomment-4102",
      createdAt: "2026-07-24T09:00:00Z",
      updatedAt: "2026-07-24T09:00:00Z",
      author: "prs-bot",
      isBot: true,
    };
    const forge = {
      isAuthenticated: vi.fn(() => true),
      fetchIssueComments: vi.fn().mockResolvedValue([]),
      fetchPullRequestIssueComments: vi.fn(),
      createAuditComment: vi.fn().mockResolvedValue(createdComment),
      updateIssueComment: vi.fn(),
    };

    await publishIssueEstimateAudit(forge, {
      status: "estimated",
      issueNumber: 319,
      planSource: {
        type: "managed-comment",
        url: "https://github.com/DevwareUK/prs/issues/319#issuecomment-20",
        updatedAt: "2026-07-24T08:57:06Z",
      },
      confidence: "high",
      profiles: [
        {
          name: "sol-alias",
          model: "gpt-5.6",
          thinking: "high",
          range: { low: 30000, high: 54000 },
          confidence: "high",
          notes: [],
        },
        {
          name: "sol",
          model: "gpt-5.6-sol",
          thinking: "high",
          range: { low: 30000, high: 54000 },
          confidence: "high",
          notes: [],
        },
        {
          name: "terra",
          model: "gpt-5.6-terra",
          thinking: "medium",
          range: { low: 30000, high: 54000 },
          confidence: "high",
          notes: [],
        },
        {
          name: "luna",
          model: "gpt-5.6-luna",
          thinking: "medium",
          range: { low: 30000, high: 54000 },
          confidence: "high",
          notes: [],
        },
      ],
      recommendation: "Select the tier that matches the workload.",
      drivers: ["Plan has explicit implementation tasks."],
      warnings: [],
    });

    const body = forge.createAuditComment.mock.calls[0][1];
    expect(body).toContain(
      "| sol-alias |  | gpt-5.6 | high | high | 30,000-54,000 | $0.30-$0.54 |"
    );
    expect(body).toContain(
      "| sol |  | gpt-5.6-sol | high | high | 30,000-54,000 | $0.30-$0.54 |"
    );
    expect(body).toContain(
      "| terra |  | gpt-5.6-terra | medium | high | 30,000-54,000 | $0.15-$0.27 |"
    );
    expect(body).toContain(
      "| luna |  | gpt-5.6-luna | medium | high | 30,000-54,000 | $0.06-$0.11 |"
    );
  });

  it("skips direct publication when the estimate is blocked", async () => {
    const forge = {
      isAuthenticated: vi.fn(() => true),
      fetchIssueComments: vi.fn(),
      fetchPullRequestIssueComments: vi.fn(),
      createAuditComment: vi.fn(),
      updateIssueComment: vi.fn(),
    };

    const publication = await publishIssueEstimateAudit(forge, {
      status: "blocked",
      issueNumber: 268,
      message: "No managed plan.",
      nextAction: "create-issue-plan",
    });

    expect(publication).toEqual({
      status: "skipped",
      reason: "No managed plan.",
    });
    expect(forge.createAuditComment).not.toHaveBeenCalled();
  });

  it("publishes automatic deterministic estimates without throwing", async () => {
    const createdComment = {
      id: 4101,
      body: "<!-- prs:token-usage -->\n# Issue #267 token telemetry\n",
      url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-4101",
      createdAt: "2026-06-11T09:00:00Z",
      updatedAt: "2026-06-11T09:00:00Z",
      author: "prs-bot",
      isBot: true,
    };
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 3,
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-3",
        updatedAt: "2026-06-11T08:47:44Z",
        body: [
          "<!-- prs:issue-plan -->",
          "## Likely files",
          "",
          "- `README.md`",
          "",
          "## Steps",
          "",
          "1. Update docs.",
        ].join("\n"),
      }),
      isAuthenticated: vi.fn(() => true),
      fetchIssueComments: vi.fn().mockResolvedValue([]),
      fetchPullRequestIssueComments: vi.fn(),
      createAuditComment: vi.fn().mockResolvedValue(createdComment),
      updateIssueComment: vi.fn(),
    };

    const result = await publishAutomaticIssueEstimate({
      issueNumber: 267,
      repoRoot: mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-")),
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result).toEqual({
      status: "created",
      url: createdComment.url,
    });
  });

  it("skips automatic deterministic estimates when no managed plan exists", async () => {
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue(undefined),
      isAuthenticated: vi.fn(() => true),
      fetchAuditComment: vi.fn(),
      createAuditComment: vi.fn(),
      updateIssueComment: vi.fn(),
    };

    const result = await publishAutomaticIssueEstimate({
      issueNumber: 268,
      repoRoot: mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-")),
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result.status).toBe("skipped");
    if (result.status === "skipped") {
      expect(result.reason).toContain("<!-- prs:issue-plan -->");
    }
    expect(forge.createAuditComment).not.toHaveBeenCalled();
  });
});
