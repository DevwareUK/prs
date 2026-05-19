import type {
  PullRequestReviewComment,
  PullRequestReviewThreadDetails,
} from "../../forge";
import type { PullRequestReviewTask, PullRequestReviewThread } from "./types";

const PRS_INLINE_REVIEW_METADATA_PATTERN =
  /<!--\s*prs:pr-review-inline\s+({[\s\S]*?})\s*-->/;

export type LatestSuccessfulPullRequestFix = {
  completedAt: string;
  commitSha?: string;
};

export type PullRequestReviewThreadFilterContext = {
  latestSuccessfulFix?: LatestSuccessfulPullRequestFix;
  currentHeadSha?: string;
};

export type PullRequestReviewThreadFilterResult = {
  threads: PullRequestReviewThread[];
  skipped: {
    resolved: number;
    outdated: number;
    stalePrsAuthored: number;
    duplicatePrsAuthored: number;
  };
};

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

function parsePrsInlineReviewMetadata(body: string): { findingKey?: string } | undefined {
  const match = body.match(PRS_INLINE_REVIEW_METADATA_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1]) as { findingKey?: unknown };
    return {
      findingKey:
        typeof parsed.findingKey === "string" && parsed.findingKey.trim()
          ? parsed.findingKey.trim()
          : undefined,
    };
  } catch {
    return undefined;
  }
}

function getPrsInlineReviewFindingKey(
  comment: PullRequestReviewComment
): string | undefined {
  return parsePrsInlineReviewMetadata(comment.body)?.findingKey;
}

function isLegacyPrsInlineReviewComment(comment: PullRequestReviewComment): boolean {
  if (!comment.authorIsBot) {
    return false;
  }

  return (
    /^\*\*(?:High|Medium|Low) severity, (?:High|Medium|Low) confidence /i.test(
      comment.body.trim()
    ) && comment.body.includes("Why this matters:")
  );
}

export function isPrsAuthoredReviewComment(
  comment: PullRequestReviewComment
): boolean {
  return (
    getPrsInlineReviewFindingKey(comment) !== undefined ||
    isLegacyPrsInlineReviewComment(comment)
  );
}

function getCommentTimestamp(comment: PullRequestReviewComment): number {
  return Math.max(Date.parse(comment.createdAt), Date.parse(comment.updatedAt));
}

function hasCommentAfter(
  thread: PullRequestReviewThread,
  timestamp: number
): boolean {
  return thread.comments.some((comment) => getCommentTimestamp(comment) > timestamp);
}

function isPrsAuthoredThread(thread: PullRequestReviewThread): boolean {
  return thread.actionableComments.length > 0
    ? thread.actionableComments.every(isPrsAuthoredReviewComment)
    : isPrsAuthoredReviewComment(thread.rootComment);
}

function getPrsInlineReviewThreadFindingKey(
  thread: PullRequestReviewThread
): string | undefined {
  return thread.actionableComments
    .map(getPrsInlineReviewFindingKey)
    .find((key): key is string => Boolean(key));
}

function isPrsAuthoredThreadFromOlderHead(
  thread: PullRequestReviewThread,
  currentHeadSha: string | undefined
): boolean {
  if (!currentHeadSha?.trim() || !isPrsAuthoredThread(thread)) {
    return false;
  }

  const comments =
    thread.actionableComments.length > 0 ? thread.actionableComments : [thread.rootComment];
  const commitOids = comments
    .map((comment) => comment.commitOid?.trim())
    .filter((commitOid): commitOid is string => Boolean(commitOid));

  return commitOids.length > 0 && !commitOids.includes(currentHeadSha);
}

export function filterActionablePullRequestReviewThreads(
  threads: PullRequestReviewThread[],
  context: PullRequestReviewThreadFilterContext = {}
): PullRequestReviewThreadFilterResult {
  const skipped = {
    resolved: 0,
    outdated: 0,
    stalePrsAuthored: 0,
    duplicatePrsAuthored: 0,
  };
  const latestFixTimestamp =
    context.latestSuccessfulFix === undefined
      ? undefined
      : Date.parse(context.latestSuccessfulFix.completedAt);
  const actionableThreads: PullRequestReviewThread[] = [];
  const seenPrsFindingKeys = new Set<string>();

  for (const thread of threads) {
    if (thread.isResolved) {
      skipped.resolved += 1;
      continue;
    }

    if (thread.isOutdated) {
      skipped.outdated += 1;
      continue;
    }

    if (isPrsAuthoredThreadFromOlderHead(thread, context.currentHeadSha)) {
      skipped.stalePrsAuthored += 1;
      continue;
    }

    if (
      latestFixTimestamp !== undefined &&
      Number.isFinite(latestFixTimestamp) &&
      isPrsAuthoredThread(thread) &&
      !hasCommentAfter(thread, latestFixTimestamp)
    ) {
      skipped.stalePrsAuthored += 1;
      continue;
    }

    const prsFindingKey = getPrsInlineReviewThreadFindingKey(thread);
    if (prsFindingKey) {
      if (seenPrsFindingKeys.has(prsFindingKey)) {
        skipped.duplicatePrsAuthored += 1;
        continue;
      }
      seenPrsFindingKeys.add(prsFindingKey);
    }

    actionableThreads.push(thread);
  }

  return {
    threads: actionableThreads,
    skipped,
  };
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

export function buildPullRequestReviewThreadsFromDetails(
  threadDetails: PullRequestReviewThreadDetails[]
): PullRequestReviewThread[] {
  const threads: PullRequestReviewThread[] = [];

  for (const threadDetail of threadDetails) {
    const builtThreads = buildPullRequestReviewThreads(threadDetail.comments);
    const thread = builtThreads[0];
    if (!thread) {
      continue;
    }

    threads.push({
      ...thread,
      threadId: threadDetail.threadId,
      nodeId: threadDetail.nodeId,
      isResolved: threadDetail.isResolved,
      isOutdated: threadDetail.isOutdated,
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

export function buildPullRequestReviewTasksFromThreads(
  threads: PullRequestReviewThread[]
): { groupTasks: PullRequestReviewTask[]; threadTasks: PullRequestReviewTask[] } {
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

export function buildPullRequestReviewTasks(
  comments: PullRequestReviewComment[],
  context: PullRequestReviewThreadFilterContext = {}
): { groupTasks: PullRequestReviewTask[]; threadTasks: PullRequestReviewTask[] } {
  return buildPullRequestReviewTasksFromThreads(
    filterActionablePullRequestReviewThreads(
      buildPullRequestReviewThreads(comments),
      context
    ).threads
  );
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
  if (!normalized || normalized === "all") {
    return Array.from({ length: threadCount }, (_, index) => ({
      kind: "thread" as const,
      index,
    }));
  }

  if (normalized === "none" || normalized === "n") {
    return [];
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
