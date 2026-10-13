import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readyIssueTool } from "./issue-ready-tool";

describe("issue ready tool", () => {
  it("writes issue readiness metadata and the verified GitHub update", async () => {
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
      startIssueWork: vi.fn().mockResolvedValue({
        assignee: { status: "updated", value: "james" },
        issueStatus: { status: "updated", value: "In Progress" },
      }),
    };

    const result = await readyIssueTool({
      unattended: false,
      issueNumber: 151,
      repoRoot,
      forge,
      now: () => new Date("2026-05-12T09:30:00.000Z"),
    });
    if (result.status !== "ready") throw new Error("Expected issue readiness");

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
      suggestedBranchName: "prs/issue-151-tighten-create-route",
      runDir: ".prs/runs/20260512T093000000Z-issue-151-ready",
      nextAction: "start-superpowers-worktree",
      githubUpdate: {
        assignee: { status: "updated", value: "james" },
        issueStatus: { status: "updated", value: "In Progress" },
      },
    });
    expect(forge.fetchIssueDetails).toHaveBeenCalledWith(151);
    expect(forge.fetchIssueComments).toHaveBeenCalledWith(151);
    expect(forge.fetchIssuePlanComment).toHaveBeenCalledWith(151);
    expect(forge.startIssueWork).toHaveBeenCalledWith(151);

    const metadata = JSON.parse(readFileSync(join(repoRoot, result.metadataFilePath), "utf8"));
    expect(metadata).toMatchObject({
      flow: "issue-ready",
      issueNumber: 151,
      suggestedBranchName: "prs/issue-151-tighten-create-route",
      unattended: false,
      githubUpdate: {
        assignee: { status: "updated", value: "james" },
        issueStatus: { status: "updated", value: "In Progress" },
      },
    });

    forge.startIssueWork.mockResolvedValueOnce({
      assignee: { status: "already-set", value: "james" },
      issueStatus: { status: "unavailable", reason: "Status issue field is not configured" },
    });
    const partial = await readyIssueTool({
      issueNumber: 151, repoRoot, forge,
      now: () => new Date("2026-05-12T09:31:00.000Z"),
    });
    if (partial.status !== "ready") throw new Error("Expected issue readiness");
    expect(partial.githubUpdate.issueStatus).toEqual({ status: "unavailable", reason: "Status issue field is not configured" });
    expect(JSON.parse(readFileSync(join(repoRoot, partial.metadataFilePath), "utf8")).githubUpdate).toEqual(partial.githubUpdate);

    forge.startIssueWork.mockRejectedValueOnce(new Error("credential-store-secret"));
    const setupFailure = await readyIssueTool({
      issueNumber: 151, repoRoot, forge,
      now: () => new Date("2026-05-12T09:32:00.000Z"),
    });
    if (setupFailure.status !== "ready") throw new Error("Expected issue readiness");
    expect(setupFailure.githubUpdate).toEqual({
      assignee: { status: "unavailable", reason: "Could not start GitHub issue work (request setup failed)" },
      issueStatus: { status: "unavailable", reason: "Could not start GitHub issue work (request setup failed)" },
    });
    expect(JSON.parse(readFileSync(join(repoRoot, setupFailure.metadataFilePath), "utf8")).githubUpdate).toEqual(setupFailure.githubUpdate);
    expect(JSON.stringify(setupFailure)).not.toContain("credential-store-secret");
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
      startIssueWork: vi.fn().mockResolvedValue({
        assignee: { status: "updated", value: "james" },
        issueStatus: { status: "unavailable", reason: "Status issue field is not configured" },
      }),
    };

    const result = await readyIssueTool({
      unattended: true,
      issueNumber: 233,
      repoRoot,
      forge,
      now: () => new Date("2026-05-12T09:30:00.000Z"),
    });
    if (result.status !== "ready") throw new Error("Expected issue readiness");

    expect(result).toMatchObject({
      status: "ready",
      issueNumber: 233,
      spec: { status: "missing" },
      plan: { status: "missing" },
      nextAction: "start-superpowers-worktree",
      githubUpdate: {
        assignee: { status: "unavailable", reason: "Managed specification and plan are required before starting GitHub issue work" },
        issueStatus: { status: "unavailable", reason: "Managed specification and plan are required before starting GitHub issue work" },
      },
    });
    expect(result.message).toContain(
      "Missing managed refinement artifacts will be generated and published during issue preparation"
    );
    expect(forge.startIssueWork).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(repoRoot, result.metadataFilePath), "utf8")).githubUpdate).toEqual(result.githubUpdate);
  });

  it("ignores issue specifications nested inside audit comments", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-issue-ready-audit-spec-"));
    const forge = {
      type: "github" as const,
      isAuthenticated: vi.fn(() => true),
      fetchIssueDetails: vi.fn().mockResolvedValue({
        title: "Detect audit-wrapped spec",
        body: "Read managed spec markers inside audit comments.",
        url: "https://github.com/DevwareUK/prs/issues/255",
      }),
      fetchIssueComments: vi.fn().mockResolvedValue([
        {
          id: 1,
          body: [
            "<!-- prs:audit -->",
            "",
            "# Issue #255 audit",
            "",
            "<!-- prs:audit:spec:start -->",
            "## spec",
            "",
            "<!-- prs:issue-spec -->",
            "# Settled specification",
            "<!-- prs:audit:spec:end -->",
          ].join("\n"),
          url: "https://github.com/DevwareUK/prs/issues/255#issuecomment-1",
          createdAt: "2026-05-28T19:00:00Z",
          updatedAt: "2026-05-28T19:05:00Z",
          author: "james",
          isBot: false,
        },
      ]),
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 2,
        body: "<!-- prs:issue-plan -->\nPlan",
        url: "https://github.com/DevwareUK/prs/issues/255#issuecomment-2",
        updatedAt: "2026-05-28T19:06:00Z",
      }),
      startIssueWork: vi.fn().mockResolvedValue({
        assignee: { status: "already-set", value: "james" },
        issueStatus: { status: "already-set", value: "In Progress" },
      }),
    };

    const result = await readyIssueTool({
      unattended: true,
      issueNumber: 255,
      repoRoot,
      forge,
      now: () => new Date("2026-05-28T19:30:00.000Z"),
    });
    if (result.status !== "ready") throw new Error("Expected issue readiness");

    expect(result).toMatchObject({
      status: "ready",
      issueNumber: 255,
      spec: {
        status: "missing",
      },
    });

    const metadata = JSON.parse(readFileSync(join(repoRoot, result.metadataFilePath), "utf8"));
    expect(metadata).toMatchObject({
      spec: {
        status: "missing",
      },
    });
  });
});
