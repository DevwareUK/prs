import { describe, expect, it, vi } from "vitest";
import { contextIssueTool } from "./issue-context-tool";

describe("contextIssueTool", () => {
  it("returns complete read-only issue context for the active repository", async () => {
    const forge = {
      type: "github" as const,
      getRepositoryIdentity: vi.fn(() => ({
        owner: "DevwareUK",
        name: "prs",
        url: "https://github.com/DevwareUK/prs",
      })),
      fetchIssueDetails: vi.fn(async () => ({
        title: "Define the workflow contract",
        body: "Keep reasoning in the active agent.",
        url: "https://github.com/DevwareUK/prs/issues/324",
      })),
      fetchIssueComments: vi.fn(async () => [
        {
          id: 10,
          body: "<!-- prs:issue-spec -->\nApproved spec.",
          url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-10",
          createdAt: "2026-08-27T10:00:00Z",
          updatedAt: "2026-08-27T10:00:00Z",
          author: "JamesDevware",
          isBot: false,
        },
      ]),
      fetchIssuePlanComment: vi.fn(async () => ({
        id: 11,
        body: "<!-- prs:issue-plan -->\nApproved plan.",
        url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-11",
        updatedAt: "2026-08-27T10:01:00Z",
      })),
      fetchIssueLinkedPullRequests: vi.fn(async () => [
        {
          number: 400,
          title: "Implement workflow contract",
          url: "https://github.com/DevwareUK/prs/pull/400",
          state: "open" as const,
        },
      ]),
    };

    await expect(contextIssueTool({ issueNumber: 324, forge })).resolves.toEqual({
      status: "ready",
      repository: {
        owner: "DevwareUK",
        name: "prs",
        url: "https://github.com/DevwareUK/prs",
      },
      issue: {
        number: 324,
        title: "Define the workflow contract",
        body: "Keep reasoning in the active agent.",
        url: "https://github.com/DevwareUK/prs/issues/324",
      },
      comments: [
        {
          id: 10,
          body: "<!-- prs:issue-spec -->\nApproved spec.",
          url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-10",
          createdAt: "2026-08-27T10:00:00Z",
          updatedAt: "2026-08-27T10:00:00Z",
          author: "JamesDevware",
          isBot: false,
        },
      ],
      managed: { spec: "present", plan: "present" },
      linkedPullRequests: [
        {
          number: 400,
          title: "Implement workflow contract",
          url: "https://github.com/DevwareUK/prs/pull/400",
          state: "open",
        },
      ],
    });

    expect(forge.fetchIssueDetails).toHaveBeenCalledOnce();
    expect(forge.fetchIssueComments).toHaveBeenCalledOnce();
    expect(forge.fetchIssuePlanComment).toHaveBeenCalledOnce();
    expect(forge.fetchIssueLinkedPullRequests).toHaveBeenCalledOnce();
  });

  it("blocks before reads when repository forge support is disabled", async () => {
    const forge = {
      type: "none" as const,
      getRepositoryIdentity: vi.fn(),
      fetchIssueDetails: vi.fn(),
      fetchIssueComments: vi.fn(),
      fetchIssuePlanComment: vi.fn(),
      fetchIssueLinkedPullRequests: vi.fn(),
    };

    await expect(contextIssueTool({ issueNumber: 324, forge })).resolves.toEqual({
      status: "blocked",
      message: "Repository forge support is disabled by .prs/config.json.",
      nextAction: "configure-forge",
    });
    expect(forge.fetchIssueDetails).not.toHaveBeenCalled();
  });
});
