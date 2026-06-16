import { describe, expect, it, vi } from "vitest";
import type { AuditTarget, RepositoryComment } from "./forge";
import {
  publishTokenUsageLedger,
  TOKEN_USAGE_COMMENT_MARKER,
} from "./token-usage-comments";

function comment(body: string): RepositoryComment {
  return {
    id: 1234,
    body,
    url: "https://github.com/DevwareUK/BOS/issues/239#issuecomment-1234",
    createdAt: "2026-06-15T14:47:09Z",
    updatedAt: "2026-06-15T14:54:29Z",
    author: {
      login: "prs-bot",
      type: "Bot",
    },
  };
}

describe("token usage comments", () => {
  it("preserves existing ledger rows when publishing a new artifact row", async () => {
    const existing = comment(
      [
        TOKEN_USAGE_COMMENT_MARKER,
        "",
        "# Issue #239 token usage",
        "",
        "Codex token usage ledger for issue #239.",
        "",
        "| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |",
        "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |",
        " | issue-implementation | implementer | gpt-5 | actual | tracked | 88,100 |  | 7m 3s | 2026-06-15T15:20:00+01:00 | ",
        "",
        "This ledger reports available Codex run telemetry, not exact billing.",
      ].join("\n")
    );
    const target: AuditTarget = { type: "issue", number: 239 };
    const updateIssueComment = vi.fn(async (_commentId: number, body: string) =>
      comment(body)
    );
    const forge = {
      isAuthenticated: () => true,
      fetchIssueComments: vi.fn(async () => [existing]),
      fetchPullRequestIssueComments: vi.fn(),
      createAuditComment: vi.fn(),
      updateIssueComment,
    };

    const result = await publishTokenUsageLedger(forge, {
      target,
      rows: [
        {
          phase: "issue-create",
          role: "planner",
          modelSource: "unavailable",
          status: "partial",
          totalTokens: 76253,
          elapsedSeconds: 152,
          capturedAt: "2026-06-15T14:33:00+01:00",
        },
      ],
    });

    expect(result.status).toBe("updated");
    const body = updateIssueComment.mock.calls[0]?.[1] as string;
    expect(body).toContain("| issue-create | planner |  | unavailable | partial | 76,253 |");
    expect(body).toContain(
      "| issue-implementation | implementer | gpt-5 | actual | tracked | 88,100 |"
    );
    expect(body.indexOf("issue-create")).toBeLessThan(
      body.indexOf("issue-implementation")
    );
  });

  it("upserts only matching entry IDs from the GitHub source-of-truth ledger", async () => {
    const existing = comment(
      [
        TOKEN_USAGE_COMMENT_MARKER,
        "",
        "# Issue #239 token usage",
        "",
        "Codex token usage ledger for issue #239.",
        "",
        "| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |",
        "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |",
        " | issue-create | planner |  | unavailable | partial | 1,000 |  | 10s | 2026-06-15T14:33:00+01:00 | ",
        " | issue-implementation | implementer | gpt-5 | actual | tracked | 88,100 |  | 7m 3s | 2026-06-15T15:20:00+01:00 | ",
        "",
        "This ledger reports available Codex run telemetry, not exact billing.",
        "",
        "<!-- prs:token-usage-data",
        JSON.stringify(
          {
            version: 1,
            rows: [
              {
                id: "create:239",
                phase: "issue-create",
                role: "planner",
                modelSource: "unavailable",
                status: "partial",
                totalTokens: 1000,
                elapsedSeconds: 10,
                capturedAt: "2026-06-15T14:33:00+01:00",
              },
              {
                id: "implementation:239",
                phase: "issue-implementation",
                role: "implementer",
                model: "gpt-5",
                modelSource: "actual",
                status: "tracked",
                totalTokens: 88100,
                elapsedSeconds: 423,
                capturedAt: "2026-06-15T15:20:00+01:00",
              },
            ],
          },
          null,
          2
        ),
        "-->",
      ].join("\n")
    );
    const updateIssueComment = vi.fn(async (_commentId: number, body: string) =>
      comment(body)
    );
    const forge = {
      isAuthenticated: () => true,
      fetchIssueComments: vi.fn(async () => [existing]),
      fetchPullRequestIssueComments: vi.fn(),
      createAuditComment: vi.fn(),
      updateIssueComment,
    };

    await publishTokenUsageLedger(forge, {
      target: { type: "issue", number: 239 },
      rows: [
        {
          id: "create:239",
          phase: "issue-create",
          role: "planner",
          modelSource: "unavailable",
          status: "partial",
          totalTokens: 76253,
          elapsedSeconds: 152,
          capturedAt: "2026-06-15T14:33:00+01:00",
        },
      ],
    });

    const body = updateIssueComment.mock.calls[0]?.[1] as string;
    expect(body).toContain("| issue-create | planner |  | unavailable | partial | 76,253 |");
    expect(body).not.toContain("| issue-create | planner |  | unavailable | partial | 1,000 |");
    expect(body).toContain(
      "| issue-implementation | implementer | gpt-5 | actual | tracked | 88,100 |"
    );
    expect(body).toContain('"id": "create:239"');
    expect(body).toContain('"id": "implementation:239"');
  });
});
