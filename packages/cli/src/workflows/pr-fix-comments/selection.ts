import type { PullRequestReviewComment } from "../../forge";
import type { PullRequestReviewTask, PullRequestReviewThread } from "./types";

export function getReviewCommentDisplayLine(
  comment: PullRequestReviewComment
): number | undefined {
  return (
    comment.line ??
    comment.originalLine ??
    comment.startLine ??
    comment.originalStartLine
  );
}

function getReviewCommentLineRange(
  comment: PullRequestReviewComment
): { startLine?: number; endLine?: number } {
  const endLine =
    comment.line ?? comment.originalLine ?? getReviewCommentDisplayLine(comment);
  const startLine = comment.startLine ?? comment.originalStartLine ?? endLine;

  return {
    startLine,
    endLine,
  };
}

export function formatReviewCommentLineRange(
  startLine?: number,
  endLine?: number
): string {
  if (startLine === undefined && endLine === undefined) {
    return "Unknown";
  }

  if (startLine === undefined) {
    return String(endLine);
  }

  if (endLine === undefined || startLine === endLine) {
    return String(startLine);
  }

  return `${startLine}-${endLine}`;
}

function isTriviallyNonActionableReviewCommentBody(body: string): boolean {
  const normalizedBody = body.trim().toLowerCase();
  if (!normalizedBody) {
    return true;
  }

  return [
    /^\+1$/,
    /^lgtm[.!]?$/,
    /^looks good(?: to me)?[.!]?$/,
    /^nice work[.!]?$/,
    /^great work[.!]?$/,
    /^thanks[.!]?$/,
    /^thank you[.!]?$/,
    /^resolved[.!]?$/,
    /^done[.!]?$/,
    /^approved[.!]?$/,
  ].some((pattern) => pattern.test(normalizedBody));
}

function hasReviewCommentTaskContext(comment: PullRequestReviewComment): boolean {
  return Boolean(comment.path.trim()) && getReviewCommentDisplayLine(comment) !== undefined;
}

function isActionablePullRequestReviewComment(
  comment: PullRequestReviewComment
): boolean {
  if (!hasReviewCommentTaskContext(comment)) {
    return false;
  }

  return !isTriviallyNonActionableReviewCommentBody(comment.body);
}

export function shouldRetainPullRequestReviewCommentInThread(
  comment: PullRequestReviewComment
): boolean {
  if (!hasReviewCommentTaskContext(comment)) {
    return false;
  }

  return !isTriviallyNonActionableReviewCommentBody(comment.body);
}

function summarizeReviewCommentBody(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137)}...`;
}

function resolvePullRequestReviewThreadId(
  comment: PullRequestReviewComment,
  commentsById: Map<number, PullRequestReviewComment>
): number {
  let current = comment;
  const visited = new Set<number>();

  while (current.inReplyToId !== undefined && !visited.has(current.inReplyToId)) {
    const parent = commentsById.get(current.inReplyToId);
    if (!parent) {
      break;
    }

    visited.add(current.id);
    current = parent;
  }

  return current.id;
}

function formatPullRequestReviewThreadSummary(
  thread: PullRequestReviewThread
): string {
  const summaries = [
    ...new Set(
      thread.actionableComments.map((comment) =>
        summarizeReviewCommentBody(comment.body)
      )
    ),
  ];
  if (summaries.length === 0) {
    return summarizeReviewCommentBody(thread.rootComment.body);
  }

  if (summaries.length === 1) {
    return summaries[0];
  }

  const visibleSummaries = summaries.slice(0, 2);
  const suffix =
    summaries.length > visibleSummaries.length
      ? ` (+${summaries.length - visibleSummaries.length} more)`
      : "";
  return `${visibleSummaries.join(" / ")}${suffix}`;
}

export function buildPullRequestReviewThreads(
  comments: PullRequestReviewComment[]
): PullRequestReviewThread[] {
  const retainedComments = comments.filter(shouldRetainPullRequestReviewCommentInThread);
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const commentsByThreadId = new Map<number, PullRequestReviewComment[]>();

  for (const comment of retainedComments) {
    const threadId = resolvePullRequestReviewThreadId(comment, commentsById);
    const existing = commentsByThreadId.get(threadId);
    if (existing) {
      existing.push(comment);
    } else {
      commentsByThreadId.set(threadId, [comment]);
    }
  }

  const threads: PullRequestReviewThread[] = [];

  for (const [threadId, threadComments] of commentsByThreadId.entries()) {
    const sortedComments = [...threadComments].sort((left, right) => {
      const createdAtComparison =
        Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (createdAtComparison !== 0) {
        return createdAtComparison;
      }

      return left.id - right.id;
    });
    const actionableComments = sortedComments.filter(
      isActionablePullRequestReviewComment
    );
    if (actionableComments.length === 0) {
      continue;
    }

    const rootComment =
      sortedComments.find((comment) => comment.id === threadId) ?? sortedComments[0];
    const ranges = sortedComments.map(getReviewCommentLineRange);
    const lineNumbers = ranges.flatMap(({ startLine, endLine }) =>
      [startLine, endLine].filter((line): line is number => line !== undefined)
    );
    const anchorLine = getReviewCommentDisplayLine(rootComment);
    const baseThread = {
      threadId,
      path: rootComment.path,
      startLine: lineNumbers.length > 0 ? Math.min(...lineNumbers) : anchorLine,
      endLine: lineNumbers.length > 0 ? Math.max(...lineNumbers) : anchorLine,
      anchorLine,
      rootComment,
      comments: sortedComments,
      actionableComments,
    };

    threads.push({
      ...baseThread,
      summary: formatPullRequestReviewThreadSummary({ ...baseThread, summary: "" }),
    });
  }

  return threads.sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path);
    if (pathComparison !== 0) {
      return pathComparison;
    }

    const lineComparison =
      (left.startLine ?? Number.MAX_SAFE_INTEGER) -
      (right.startLine ?? Number.MAX_SAFE_INTEGER);
    if (lineComparison !== 0) {
      return lineComparison;
    }

    return left.threadId - right.threadId;
  });
}

function shouldGroupPullRequestReviewThreads(
  currentGroup: PullRequestReviewThread[],
  nextThread: PullRequestReviewThread
): boolean {
  const previousThread = currentGroup[currentGroup.length - 1];
  if (previousThread.path !== nextThread.path) {
    return false;
  }

  const previousEndLine = previousThread.endLine ?? previousThread.startLine;
  const nextStartLine = nextThread.startLine ?? nextThread.endLine;
  if (previousEndLine !== undefined && nextStartLine !== undefined) {
    return nextStartLine <= previousEndLine + 12;
  }

  const previousDiffHunks = new Set(
    previousThread.comments
      .map((comment) => comment.diffHunk?.trim())
      .filter((diffHunk): diffHunk is string => Boolean(diffHunk))
  );
  return nextThread.comments.some(
    (comment) =>
      comment.diffHunk?.trim() && previousDiffHunks.has(comment.diffHunk.trim())
  );
}

function formatPullRequestReviewTaskSummary(
  threads: PullRequestReviewThread[]
): string {
  const summaries = [...new Set(threads.map((thread) => thread.summary))];
  if (summaries.length === 1) {
    return summaries[0];
  }

  const visibleSummaries = summaries.slice(0, 2);
  const suffix =
    summaries.length > visibleSummaries.length
      ? ` (+${summaries.length - visibleSummaries.length} more)`
      : "";
  return `${visibleSummaries.join(" / ")}${suffix}`;
}

function createPullRequestReviewTask(
  kind: "group" | "thread",
  taskId: string,
  threads: PullRequestReviewThread[]
): PullRequestReviewTask {
  const lineNumbers = threads.flatMap((thread) =>
    [thread.startLine, thread.endLine].filter(
      (line): line is number => line !== undefined
    )
  );
  const commentsById = new Map<number, PullRequestReviewComment>();
  for (const thread of threads) {
    for (const comment of thread.comments) {
      commentsById.set(comment.id, comment);
    }
  }

  return {
    taskId,
    kind,
    path: threads[0]?.path ?? "",
    startLine: lineNumbers.length > 0 ? Math.min(...lineNumbers) : undefined,
    endLine: lineNumbers.length > 0 ? Math.max(...lineNumbers) : undefined,
    summary: formatPullRequestReviewTaskSummary(threads),
    comments: [...commentsById.values()].sort((left, right) => left.id - right.id),
    threads,
  };
}

export function buildPullRequestReviewTasks(
  comments: PullRequestReviewComment[]
): { groupTasks: PullRequestReviewTask[]; threadTasks: PullRequestReviewTask[] } {
  const threads = buildPullRequestReviewThreads(comments);
  const threadTasks = threads.map((thread) =>
    createPullRequestReviewTask("thread", `thread-${thread.threadId}`, [thread])
  );
  const groupTasks: PullRequestReviewTask[] = [];

  let currentGroup: PullRequestReviewThread[] = [];
  for (const thread of threads) {
    if (
      currentGroup.length === 0 ||
      shouldGroupPullRequestReviewThreads(currentGroup, thread)
    ) {
      currentGroup.push(thread);
      continue;
    }

    if (currentGroup.length > 1) {
      groupTasks.push(
        createPullRequestReviewTask(
          "group",
          `group-${groupTasks.length + 1}`,
          currentGroup
        )
      );
    }
    currentGroup = [thread];
  }

  if (currentGroup.length > 1) {
    groupTasks.push(
      createPullRequestReviewTask(
        "group",
        `group-${groupTasks.length + 1}`,
        currentGroup
      )
    );
  }

  return {
    groupTasks,
    threadTasks,
  };
}

export function formatPullRequestReviewTaskLocation(
  task: PullRequestReviewTask
): string {
  const lineRange = formatReviewCommentLineRange(task.startLine, task.endLine);
  return lineRange === "Unknown" ? task.path : `${task.path}:${lineRange}`;
}

export function parsePullRequestReviewSelection(
  response: string,
  threadCount: number,
  groupCount: number
): Array<{ kind: "group" | "thread"; index: number }> {
  const normalized = response.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "n") {
    return [];
  }

  if (normalized === "all") {
    return Array.from({ length: threadCount }, (_, index) => ({
      kind: "thread" as const,
      index,
    }));
  }

  const selectedEntries: Array<{ kind: "group" | "thread"; index: number }> = [];
  const seenEntries = new Set<string>();

  for (const part of normalized.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    if (/^g\d+$/.test(trimmed)) {
      if (groupCount === 0) {
        throw new Error(
          'Invalid selection. No grouped review tasks are available for this pull request.'
        );
      }

      const parsed = Number.parseInt(trimmed.slice(1), 10);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > groupCount) {
        throw new Error(
          `Invalid selection "${trimmed}". Choose group values between g1 and g${groupCount}.`
        );
      }

      const key = `group:${parsed - 1}`;
      if (!seenEntries.has(key)) {
        selectedEntries.push({ kind: "group", index: parsed - 1 });
        seenEntries.add(key);
      }
      continue;
    }

    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        'Invalid selection. Use comma-separated thread numbers, optional group values like "g1", "all", or "none".'
      );
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > threadCount) {
      throw new Error(
        `Invalid selection "${trimmed}". Choose thread values between 1 and ${threadCount}.`
      );
    }

    const key = `thread:${parsed - 1}`;
    if (!seenEntries.has(key)) {
      selectedEntries.push({ kind: "thread", index: parsed - 1 });
      seenEntries.add(key);
    }
  }

  return selectedEntries;
}
