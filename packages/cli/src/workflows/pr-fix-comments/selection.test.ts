import { describe, expect, it } from "vitest";

import {
  buildPullRequestReviewTasks,
  filterActionablePullRequestReviewThreads,
  parsePullRequestReviewSelection,
} from "./selection";
import type { PullRequestReviewComment } from "../../forge";
import type { PullRequestReviewThread } from "./types";

function createComment(
  overrides: Partial<PullRequestReviewComment> = {}
): PullRequestReviewComment {
  return {
    id: 501,
    body:
      "**High severity, High confidence Migration**\n\nHandle lookup failures.\n\nWhy this matters: Missing entities break migration imports.",
    path: "src/migrate.ts",
    line: 42,
    url: "https://github.com/DevwareUK/prs/pull/1#discussion_r501",
    author: "github-actions[bot]",
    authorIsBot: true,
    createdAt: "2026-05-14T10:00:00.000Z",
    updatedAt: "2026-05-14T10:00:00.000Z",
    ...overrides,
  };
}

function createThread(
  overrides: Partial<PullRequestReviewThread> = {}
): PullRequestReviewThread {
  const rootComment = createComment();
  return {
    threadId: 501,
    nodeId: "PRRT_kwDO",
    path: rootComment.path,
    startLine: 42,
    endLine: 42,
    anchorLine: 42,
    rootComment,
    comments: [rootComment],
    actionableComments: [rootComment],
    summary: "Handle lookup failures.",
    ...overrides,
  };
}

describe("pr-fix-comments selection helpers", () => {
  it("defaults blank review selection to every individual thread", () => {
    expect(parsePullRequestReviewSelection("", 3, 2)).toEqual([
      { kind: "thread", index: 0 },
      { kind: "thread", index: 1 },
      { kind: "thread", index: 2 },
    ]);
    expect(parsePullRequestReviewSelection("   ", 2, 0)).toEqual([
      { kind: "thread", index: 0 },
      { kind: "thread", index: 1 },
    ]);
  });

  it("keeps explicit review skip and selection inputs unchanged", () => {
    expect(parsePullRequestReviewSelection("none", 3, 1)).toEqual([]);
    expect(parsePullRequestReviewSelection("n", 3, 1)).toEqual([]);
    expect(parsePullRequestReviewSelection("all", 2, 1)).toEqual([
      { kind: "thread", index: 0 },
      { kind: "thread", index: 1 },
    ]);
    expect(parsePullRequestReviewSelection("g1,2", 3, 1)).toEqual([
      { kind: "group", index: 0 },
      { kind: "thread", index: 1 },
    ]);
  });

  it("filters resolved and outdated review threads before task selection", () => {
    const openThread = createThread({ threadId: 1 });
    const { threads, skipped } = filterActionablePullRequestReviewThreads([
      createThread({ threadId: 2, isResolved: true }),
      createThread({ threadId: 3, isOutdated: true }),
      openThread,
    ]);

    expect(threads.map((thread) => thread.threadId)).toEqual([1]);
    expect(skipped.resolved).toBe(1);
    expect(skipped.outdated).toBe(1);
  });

  it("suppresses stale PRS-authored bot threads from older pull request heads", () => {
    const staleBotThread = createThread({
      threadId: 1,
      rootComment: createComment({ commitOid: "old-head" }),
      comments: [createComment({ commitOid: "old-head" })],
      actionableComments: [createComment({ commitOid: "old-head" })],
    });
    const currentBotThread = createThread({
      threadId: 2,
      rootComment: createComment({ id: 502, commitOid: "current-head" }),
      comments: [createComment({ id: 502, commitOid: "current-head" })],
      actionableComments: [createComment({ id: 502, commitOid: "current-head" })],
    });
    const oldHumanThread = createThread({
      threadId: 3,
      rootComment: createComment({
        id: 503,
        body: "Please handle the migration lookup failure.",
        author: "human-reviewer",
        authorIsBot: false,
        commitOid: "old-head",
      }),
      comments: [
        createComment({
          id: 503,
          body: "Please handle the migration lookup failure.",
          author: "human-reviewer",
          authorIsBot: false,
          commitOid: "old-head",
        }),
      ],
      actionableComments: [
        createComment({
          id: 503,
          body: "Please handle the migration lookup failure.",
          author: "human-reviewer",
          authorIsBot: false,
          commitOid: "old-head",
        }),
      ],
    });

    const { threads, skipped } = filterActionablePullRequestReviewThreads(
      [staleBotThread, currentBotThread, oldHumanThread],
      { currentHeadSha: "current-head" }
    );

    expect(threads.map((thread) => thread.threadId)).toEqual([2, 3]);
    expect(skipped.stalePrsAuthored).toBe(1);
  });

  it("suppresses old PRS-authored bot threads after a successful fix run", () => {
    const oldPrsThread = createThread({ threadId: 1 });
    const newerPrsThread = createThread({
      threadId: 2,
      rootComment: createComment({
        id: 502,
        createdAt: "2026-05-14T13:00:00.000Z",
        updatedAt: "2026-05-14T13:00:00.000Z",
      }),
      comments: [
        createComment({
          id: 502,
          createdAt: "2026-05-14T13:00:00.000Z",
          updatedAt: "2026-05-14T13:00:00.000Z",
        }),
      ],
      actionableComments: [
        createComment({
          id: 502,
          createdAt: "2026-05-14T13:00:00.000Z",
          updatedAt: "2026-05-14T13:00:00.000Z",
        }),
      ],
    });
    const oldHumanThread = createThread({
      threadId: 3,
      rootComment: createComment({
        id: 503,
        body: "Please handle the migration lookup failure.",
        author: "human-reviewer",
        authorIsBot: false,
      }),
      comments: [
        createComment({
          id: 503,
          body: "Please handle the migration lookup failure.",
          author: "human-reviewer",
          authorIsBot: false,
        }),
      ],
      actionableComments: [
        createComment({
          id: 503,
          body: "Please handle the migration lookup failure.",
          author: "human-reviewer",
          authorIsBot: false,
        }),
      ],
    });
    const oldPrsThreadWithNewHumanReply = createThread({
      threadId: 4,
      comments: [
        createComment({ id: 504 }),
        createComment({
          id: 505,
          body: "This is still failing for paragraph media.",
          author: "human-reviewer",
          authorIsBot: false,
          createdAt: "2026-05-14T13:05:00.000Z",
          updatedAt: "2026-05-14T13:05:00.000Z",
          inReplyToId: 504,
        }),
      ],
      actionableComments: [
        createComment({ id: 504 }),
        createComment({
          id: 505,
          body: "This is still failing for paragraph media.",
          author: "human-reviewer",
          authorIsBot: false,
          createdAt: "2026-05-14T13:05:00.000Z",
          updatedAt: "2026-05-14T13:05:00.000Z",
          inReplyToId: 504,
        }),
      ],
    });

    const { threads, skipped } = filterActionablePullRequestReviewThreads(
      [oldPrsThread, newerPrsThread, oldHumanThread, oldPrsThreadWithNewHumanReply],
      {
        latestSuccessfulFix: {
          completedAt: "2026-05-14T12:00:00.000Z",
          commitSha: "929ffc0",
        },
      }
    );

    expect(threads.map((thread) => thread.threadId)).toEqual([2, 3, 4]);
    expect(skipped.stalePrsAuthored).toBe(1);
  });

  it("deduplicates repeated PRS-authored findings with the same metadata key", () => {
    const comments = [
      createComment({
        id: 1,
        body:
          "Handle product lookup failure.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->",
      }),
      createComment({
        id: 2,
        body:
          "Product entity lookup failures need handling.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->",
      }),
    ];

    const { threadTasks } = buildPullRequestReviewTasks(comments);

    expect(threadTasks).toHaveLength(1);
    expect(threadTasks[0]?.comments.map((comment) => comment.id)).toEqual([1]);
  });

  it("counts duplicate PRS-authored findings skipped by metadata key", () => {
    const firstThread = createThread({
      threadId: 1,
      rootComment: createComment({
        id: 1,
        body:
          "Handle product lookup failure.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->",
      }),
      comments: [
        createComment({
          id: 1,
          body:
            "Handle product lookup failure.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->",
        }),
      ],
      actionableComments: [
        createComment({
          id: 1,
          body:
            "Handle product lookup failure.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->",
        }),
      ],
    });
    const duplicateThread = createThread({
      threadId: 2,
      rootComment: createComment({
        id: 2,
        body:
          "Product entity lookup failures need handling.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->",
      }),
      comments: [
        createComment({
          id: 2,
          body:
            "Product entity lookup failures need handling.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->",
        }),
      ],
      actionableComments: [
        createComment({
          id: 2,
          body:
            "Product entity lookup failures need handling.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->",
        }),
      ],
    });

    const { threads, skipped } = filterActionablePullRequestReviewThreads([
      firstThread,
      duplicateThread,
    ]);

    expect(threads.map((thread) => thread.threadId)).toEqual([1]);
    expect(skipped.duplicatePrsAuthored).toBe(1);
  });
});
