import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepositoryForge } from "../../forge";
import { publishPullRequestLocalReview } from "./publish";

const cleanupTargets = new Set<string>();

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

function createForge(): RepositoryForge {
  return {
    type: "github",
    isAuthenticated: () => true,
    fetchIssueDetails: vi.fn(),
    fetchIssueComments: vi.fn(),
    fetchIssuePlanComment: vi.fn(),
    fetchAuditComment: vi.fn().mockResolvedValue(undefined),
    fetchPullRequestDetails: vi.fn().mockResolvedValue({
      number: 224,
      title: "Improve dashboard filters",
      body: "Adds filter controls.",
      url: "https://github.com/DevwareUK/prs/pull/224",
      baseRefName: "main",
      headRefName: "feature/dashboard-filters",
      headSha: "abc123head",
    }),
    fetchPullRequestChecks: vi.fn(),
    listOpenPullRequestChanges: vi.fn(),
    fetchPullRequestIssueComments: vi.fn(),
    fetchPullRequestReviewComments: vi.fn(),
    fetchPullRequestReviewThreads: vi.fn().mockResolvedValue([
      {
        threadId: 1,
        nodeId: "thread-1",
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            id: 10,
            body: [
              "Existing finding.",
              "",
              '<!-- prs:pr-review-inline {"source":"prs:pr-review","headSha":"abc123head","findingKey":"src-filter-ts:99:bug:existing-finding:existing-risk"} -->',
            ].join("\n"),
            path: "src/filter.ts",
            line: 12,
            url: "https://github.com/DevwareUK/prs/pull/224#discussion_r10",
            author: "github-actions[bot]",
            authorIsBot: true,
            createdAt: "2026-05-20T10:00:00Z",
            updatedAt: "2026-05-20T10:00:00Z",
          },
        ],
      },
    ]),
    createIssuePlanComment: vi.fn(),
    createAuditComment: vi.fn().mockResolvedValue({
      id: 100,
      body: "audit",
      url: "https://github.com/DevwareUK/prs/pull/224#issuecomment-100",
      createdAt: "2026-05-21T10:00:00Z",
      updatedAt: "2026-05-21T10:00:00Z",
      author: "prs-bot",
      isBot: true,
    }),
    updateIssuePlanComment: vi.fn(),
    updateIssueComment: vi.fn(),
    createDraftIssue: vi.fn(),
    updateIssue: vi.fn(),
    createOrReuseIssue: vi.fn(),
    createPullRequest: vi.fn(),
    createPullRequestReview: vi.fn().mockResolvedValue({
      id: 200,
      url: "https://github.com/DevwareUK/prs/pull/224#pullrequestreview-200",
    }),
  };
}

describe("publishPullRequestLocalReview", () => {
  it("publishes the audit report and new high-confidence inline review comments", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-pr-local-review-publish-"));
    cleanupTargets.add(repoRoot);
    const runDir = resolve(repoRoot, ".prs/runs/20260521T100000000Z-pr-224-review");
    mkdirSync(runDir, { recursive: true });
    const reportFilePath = resolve(runDir, "codex-pr-review.md");
    const commentsFilePath = resolve(runDir, "codex-pr-review-comments.json");
    writeFileSync(resolve(runDir, "pr-review-context.md"), [
      "## Diff",
      "",
      "```diff",
      "diff --git a/src/filter.ts b/src/filter.ts",
      "+++ b/src/filter.ts",
      "@@ -10,2 +10,3 @@",
      " context();",
      "+applyFilter();",
      "+renderEmptyFilters();",
      "```",
      "",
    ].join("\n"), "utf8");
    writeFileSync(reportFilePath, "# Codex PR Review\n\nFound one issue.\n", "utf8");
    writeFileSync(
      commentsFilePath,
      `${JSON.stringify(
        [
          {
            path: "src/filter.ts",
            line: 12,
            severity: "high",
            confidence: "high",
            category: "bug",
            affectedFile: "src/filter.ts",
            body: "Guard empty filters.",
            whyThisMatters: "Empty filters crash.",
            suggestedFix: "Return early when filters are empty.",
          },
          {
            path: "src/filter.ts",
            line: 13,
            severity: "medium",
            confidence: "medium",
            category: "testing",
            affectedFile: "src/filter.ts",
            body: "Add a test.",
            whyThisMatters: "Coverage is useful.",
          },
          {
            path: "src/filter.ts",
            line: 12,
            severity: "high",
            confidence: "high",
            category: "bug",
            affectedFile: "src/filter.ts",
            body: "Guard empty filters.",
            whyThisMatters: "Empty filters crash.",
          },
        ],
        null,
        2
      )}\n`,
      "utf8"
    );

    const forge = createForge();
    const result = await publishPullRequestLocalReview({
      repoRoot,
      prNumber: 224,
      reportFilePath,
      commentsFilePath,
      forge,
    });

    expect(forge.createAuditComment).toHaveBeenCalled();
    expect(forge.createPullRequestReview).toHaveBeenCalledWith({
      prNumber: 224,
      commitSha: "abc123head",
      body: "Local Codex PR review generated 1 high-confidence inline comment on changed lines.",
      comments: [
        expect.objectContaining({
          path: "src/filter.ts",
          line: 12,
          side: "RIGHT",
          body: expect.stringContaining("<!-- prs:pr-review-inline"),
        }),
      ],
    });
    expect(result).toMatchObject({
      status: "published",
      prNumber: 224,
      auditCommentUrl: "https://github.com/DevwareUK/prs/pull/224#issuecomment-100",
      inlineReviewUrl: "https://github.com/DevwareUK/prs/pull/224#pullrequestreview-200",
      inlineCommentsPublished: 1,
      skipped: {
        nonHighConfidence: 1,
        duplicate: 1,
      },
    });
  });
});
