import { describe, expect, it, vi } from "vitest";
import { contextIssueTool } from "./issue-context-tool";

describe("contextIssueTool", () => {
  it("returns complete read-only issue context for the active repository", async () => {
    const tracker = {
      type: "github" as const,
      getIssueReference: (number: number) => ({provider: "github", scope: "DevwareUK/prs", key: String(number), url: `https://github.com/DevwareUK/prs/issues/${number}`}),
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
      fetchIssueParent: vi.fn(async () => ({
        id: 300,
        number: 300,
        url: "https://github.com/DevwareUK/prs/issues/300",
      })),
      fetchIssueChildren: vi.fn(async () => [{
        id: 325,
        number: 325,
        url: "https://github.com/DevwareUK/prs/issues/325",
      }]),
    };

    await expect(contextIssueTool({ issueNumber: 324, tracker, links: {findLinkedPullRequests: async () => ({status: "available", pullRequests: await tracker.fetchIssueLinkedPullRequests(324)}), formatClosingReference: () => "#324"} })).resolves.toEqual({
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
      linkedPullRequestsStatus: {status: "available"},
      linkedPullRequests: [
        {
          number: 400,
          title: "Implement workflow contract",
          url: "https://github.com/DevwareUK/prs/pull/400",
          state: "open",
        },
      ],
      hierarchy: {
        parent: {
          id: 300,
          number: 300,
          url: "https://github.com/DevwareUK/prs/issues/300",
        },
        children: [{
          id: 325,
          number: 325,
          url: "https://github.com/DevwareUK/prs/issues/325",
        }],
      },
    });

    expect(tracker.fetchIssueDetails).toHaveBeenCalledOnce();
    expect(tracker.fetchIssueComments).toHaveBeenCalledOnce();
    expect(tracker.fetchIssuePlanComment).toHaveBeenCalledOnce();
    expect(tracker.fetchIssueLinkedPullRequests).toHaveBeenCalledOnce();
    expect(tracker.fetchIssueParent).toHaveBeenCalledOnce();
    expect(tracker.fetchIssueChildren).toHaveBeenCalledOnce();
  });

  it("blocks before reads when repository tracker support is disabled", async () => {
    const tracker = {
      type: "none" as const,
      getIssueReference: (number: number) => ({provider: "github", scope: "DevwareUK/prs", key: String(number), url: `https://github.com/DevwareUK/prs/issues/${number}`}),
      getRepositoryIdentity: vi.fn(),
      fetchIssueDetails: vi.fn(),
      fetchIssueComments: vi.fn(),
      fetchIssuePlanComment: vi.fn(),
      fetchIssueLinkedPullRequests: vi.fn(),
      fetchIssueParent: vi.fn(),
      fetchIssueChildren: vi.fn(),
    };

    await expect(contextIssueTool({ issueNumber: 324, tracker, links: {findLinkedPullRequests: async () => ({status: "available", pullRequests: await tracker.fetchIssueLinkedPullRequests(324)}), formatClosingReference: () => "#324"} })).resolves.toEqual({
      status: "blocked",
      message: "Issue tracker support is disabled by .prs/config.json.",
      nextAction: "configure-issue-tracker",
    });
    expect(tracker.fetchIssueDetails).not.toHaveBeenCalled();
  });
});

it("returns tracker context with unavailable PR evidence when the forge is disabled", async () => {
  const tracker = {
    type: "github" as const,
    getRepositoryIdentity: () => ({owner: "DevwareUK", name: "prs", url: "https://github.com/DevwareUK/prs"}),
    getIssueReference: () => ({provider: "github", scope: "DevwareUK/prs", key: "373", url: "https://github.com/DevwareUK/prs/issues/373"}),
    fetchIssueDetails: async () => ({title: "Split", body: "Approved", url: "https://github.com/DevwareUK/prs/issues/373"}),
    fetchIssueComments: async () => [], fetchIssuePlanComment: async () => undefined,
    fetchIssueParent: async () => null, fetchIssueChildren: async () => [],
  };
  const links = {
    findLinkedPullRequests: async () => ({status: "unavailable" as const, reason: "forge-disabled"}),
    formatClosingReference: () => undefined,
  };
  expect(await contextIssueTool({issueNumber: 373, tracker, links})).toMatchObject({
    status: "ready", issue: {number: 373, title: "Split"}, linkedPullRequests: [],
    linkedPullRequestsStatus: {status: "unavailable", reason: "forge-disabled"},
  });
});

it("passes opaque provider-qualified references through the context linking boundary", async () => {
  const reference = {provider: "fake", scope: "project-a", key: "PROJ-123", url: "https://example.test/PROJ-123"};
  const tracker = {
    type: "github" as const,
    getRepositoryIdentity: () => ({owner: "test", name: "project-a", url: "https://example.test"}),
    getIssueReference: () => reference,
    fetchIssueDetails: async () => ({title: "External", body: "", url: reference.url}),
    fetchIssueComments: async () => [], fetchIssuePlanComment: async () => undefined,
    fetchIssueParent: async () => null, fetchIssueChildren: async () => [],
  };
  const links = {
    findLinkedPullRequests: async (actual: typeof reference) => {
      if (actual.provider !== "fake" || actual.scope !== "project-a" || actual.key !== "PROJ-123") throw new Error("Reference was changed");
      return {status: "available" as const, pullRequests: [{number: 7, title: "Implementation", url: "https://github.com/test/project/pull/7", state: "open" as const}]};
    }, formatClosingReference: () => undefined,
  };
  const result = await contextIssueTool({issueNumber: 123, tracker, links});
  expect(result).toMatchObject({status: "ready", linkedPullRequests: [{number: 7}], linkedPullRequestsStatus: {status: "available"}});
});
