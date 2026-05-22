import { describe, expect, it } from "vitest";
import {
  filterActionableIssuesForUser,
  filterActionablePullRequestsForUser,
  type ActionableIssue,
  type ActionablePullRequest,
} from "./actionable-github";

describe("actionable GitHub filters", () => {
  it("keeps issues assigned to me, authored by me, ready-labelled, or planned", () => {
    const issues: ActionableIssue[] = [
      {
        number: 1,
        title: "Assigned",
        url: "https://github.com/DevwareUK/prs/issues/1",
        author: "alice",
        assignees: ["me"],
        labels: [],
        updatedAt: "2026-05-01T10:00:00Z",
        hasLinkedOpenPullRequest: false,
        hasPrsPlan: false,
      },
      {
        number: 2,
        title: "Mine",
        url: "https://github.com/DevwareUK/prs/issues/2",
        author: "me",
        assignees: [],
        labels: [],
        updatedAt: "2026-05-02T10:00:00Z",
        hasLinkedOpenPullRequest: false,
        hasPrsPlan: false,
      },
      {
        number: 3,
        title: "Ready",
        url: "https://github.com/DevwareUK/prs/issues/3",
        author: "alice",
        assignees: [],
        labels: ["ready"],
        updatedAt: "2026-05-03T10:00:00Z",
        hasLinkedOpenPullRequest: false,
        hasPrsPlan: false,
      },
      {
        number: 4,
        title: "Planned",
        url: "https://github.com/DevwareUK/prs/issues/4",
        author: "alice",
        assignees: [],
        labels: [],
        updatedAt: "2026-05-04T10:00:00Z",
        hasLinkedOpenPullRequest: false,
        hasPrsPlan: true,
      },
      {
        number: 5,
        title: "Already has PR",
        url: "https://github.com/DevwareUK/prs/issues/5",
        author: "me",
        assignees: ["me"],
        labels: ["ready"],
        updatedAt: "2026-05-05T10:00:00Z",
        hasLinkedOpenPullRequest: true,
        hasPrsPlan: true,
      },
      {
        number: 6,
        title: "Not actionable",
        url: "https://github.com/DevwareUK/prs/issues/6",
        author: "alice",
        assignees: [],
        labels: [],
        updatedAt: "2026-05-06T10:00:00Z",
        hasLinkedOpenPullRequest: false,
        hasPrsPlan: false,
      },
    ];

    expect(filterActionableIssuesForUser(issues, "me").map((issue) => issue.number)).toEqual([
      1,
      4,
      2,
      3,
    ]);
  });

  it("sorts assigned and planned issues before only-recent issues", () => {
    const issues: ActionableIssue[] = [
      {
        number: 1,
        title: "Ready recent",
        url: "https://github.com/DevwareUK/prs/issues/1",
        author: "alice",
        assignees: [],
        labels: ["ready"],
        updatedAt: "2026-05-05T10:00:00Z",
        hasLinkedOpenPullRequest: false,
        hasPrsPlan: false,
      },
      {
        number: 2,
        title: "Assigned older",
        url: "https://github.com/DevwareUK/prs/issues/2",
        author: "alice",
        assignees: ["me"],
        labels: [],
        updatedAt: "2026-05-01T10:00:00Z",
        hasLinkedOpenPullRequest: false,
        hasPrsPlan: false,
      },
      {
        number: 3,
        title: "Planned",
        url: "https://github.com/DevwareUK/prs/issues/3",
        author: "alice",
        assignees: [],
        labels: [],
        updatedAt: "2026-05-02T10:00:00Z",
        hasLinkedOpenPullRequest: false,
        hasPrsPlan: true,
      },
    ];

    expect(filterActionableIssuesForUser(issues, "me").map((issue) => issue.number)).toEqual([
      2,
      3,
      1,
    ]);
  });

  it("keeps PRs that involve me or have clear action signals", () => {
    const pullRequests: ActionablePullRequest[] = [
      {
        number: 10,
        title: "Mine",
        url: "https://github.com/DevwareUK/prs/pull/10",
        author: "me",
        assignees: [],
        reviewRequestedFrom: [],
        headRefName: "feat/mine",
        labels: [],
        updatedAt: "2026-05-01T10:00:00Z",
        hasConflicts: false,
        hasFailedChecks: false,
        hasUnresolvedReviewComments: false,
        hasPrsTestSuggestions: false,
      },
      {
        number: 11,
        title: "Review request",
        url: "https://github.com/DevwareUK/prs/pull/11",
        author: "alice",
        assignees: [],
        reviewRequestedFrom: ["me"],
        headRefName: "feat/review",
        labels: [],
        updatedAt: "2026-05-02T10:00:00Z",
        hasConflicts: false,
        hasFailedChecks: false,
        hasUnresolvedReviewComments: false,
        hasPrsTestSuggestions: false,
      },
      {
        number: 12,
        title: "Conflicts",
        url: "https://github.com/DevwareUK/prs/pull/12",
        author: "alice",
        assignees: [],
        reviewRequestedFrom: [],
        headRefName: "feat/conflicts",
        labels: [],
        updatedAt: "2026-05-03T10:00:00Z",
        hasConflicts: true,
        hasFailedChecks: false,
        hasUnresolvedReviewComments: false,
        hasPrsTestSuggestions: false,
      },
      {
        number: 13,
        title: "Not actionable",
        url: "https://github.com/DevwareUK/prs/pull/13",
        author: "alice",
        assignees: [],
        reviewRequestedFrom: [],
        headRefName: "feat/other",
        labels: [],
        updatedAt: "2026-05-04T10:00:00Z",
        hasConflicts: false,
        hasFailedChecks: false,
        hasUnresolvedReviewComments: false,
        hasPrsTestSuggestions: false,
      },
    ];

    expect(
      filterActionablePullRequestsForUser(pullRequests, "me").map((pr) => pr.number)
    ).toEqual([12, 11, 10]);
  });
});
