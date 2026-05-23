import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readyIssueTool } from "./issue-ready-tool";

describe("issue ready tool", () => {
  it("writes issue readiness metadata without mutating git or GitHub", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-issue-ready-"));
    const forge = {
      type: "github" as const,
      isAuthenticated: vi.fn(() => true),
      fetchIssueDetails: vi.fn().mockResolvedValue({
        title: "Tighten create route",
        body: "Separate create from issue work.",
        url: "https://github.com/DevwareUK/prs/issues/151",
      }),
      fetchIssueComments: vi.fn().mockResolvedValue([
        {
          id: 1,
          body: "<!-- prs:issue-spec -->\nSpec",
          url: "https://github.com/DevwareUK/prs/issues/151#issuecomment-1",
          createdAt: "2026-05-12T08:00:00Z",
          updatedAt: "2026-05-12T08:00:00Z",
          author: "james",
          isBot: false,
        },
      ]),
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 2,
        body: "<!-- prs:issue-plan -->\nPlan",
        url: "https://github.com/DevwareUK/prs/issues/151#issuecomment-2",
        updatedAt: "2026-05-12T09:00:00Z",
      }),
    };

    const result = await readyIssueTool({
      all: false,
      issueNumber: 151,
      repoRoot,
      forge,
      now: () => new Date("2026-05-12T09:30:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      issueNumber: 151,
      issueTitle: "Tighten create route",
      issueUrl: "https://github.com/DevwareUK/prs/issues/151",
      spec: {
        status: "present",
        url: "https://github.com/DevwareUK/prs/issues/151#issuecomment-1",
      },
      plan: {
        status: "present",
        url: "https://github.com/DevwareUK/prs/issues/151#issuecomment-2",
      },
      comments: {
        count: 1,
      },
      suggestedBranchName: "codex/issue-151-tighten-create-route",
      runDir: ".prs/runs/20260512T093000000Z-issue-151-ready",
      nextAction: "start-superpowers-worktree",
    });
    expect(forge.fetchIssueDetails).toHaveBeenCalledWith(151);
    expect(forge.fetchIssueComments).toHaveBeenCalledWith(151);
    expect(forge.fetchIssuePlanComment).toHaveBeenCalledWith(151);

    const metadata = JSON.parse(readFileSync(join(repoRoot, result.metadataFilePath), "utf8"));
    expect(metadata).toMatchObject({
      flow: "issue-ready",
      issueNumber: 151,
      suggestedBranchName: "codex/issue-151-tighten-create-route",
      all: false,
    });
  });

  it("keeps issue readiness ready when managed specification and plan comments are missing", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-issue-ready-missing-artifacts-"));
    const forge = {
      type: "github" as const,
      isAuthenticated: vi.fn(() => true),
      fetchIssueDetails: vi.fn().mockResolvedValue({
        title: "Clarify order metadata",
        body: "Capture extra order information.",
        url: "https://github.com/DevwareUK/prs/issues/233",
      }),
      fetchIssueComments: vi.fn().mockResolvedValue([
        {
          id: 1,
          body: "Should this affect emails?",
          url: "https://github.com/DevwareUK/prs/issues/233#issuecomment-1",
          createdAt: "2026-05-12T08:00:00Z",
          updatedAt: "2026-05-12T08:00:00Z",
          author: "james",
          isBot: false,
        },
      ]),
      fetchIssuePlanComment: vi.fn().mockResolvedValue(undefined),
    };

    const result = await readyIssueTool({
      all: true,
      issueNumber: 233,
      repoRoot,
      forge,
      now: () => new Date("2026-05-12T09:30:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "ready",
      issueNumber: 233,
      spec: { status: "missing" },
      plan: { status: "missing" },
      nextAction: "start-superpowers-worktree",
    });
    expect(result.message).toContain(
      "Missing managed refinement artifacts will be generated and published during issue preparation"
    );
  });
});
