import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  RepositoryLocalRuntimeConfigType,
  RepositoryPrReadinessConfigType,
} from "@prs/contracts";
import { TEST_SUGGESTIONS_COMMENT_MARKER } from "@prs/contracts";
import { formatRunTimestamp, toRepoRelativePath } from "./run-artifacts";
import type {
  PullRequestCheckSignal,
  PullRequestDetails,
  RepositoryComment,
  RepositoryForge,
} from "./forge";
import {
  buildPullRequestReviewThreads,
  buildPullRequestReviewThreadsFromDetails,
  filterActionablePullRequestReviewThreads,
  formatReviewCommentLineRange,
} from "./workflows/pr-fix-comments/selection";
import {
  findManagedTestSuggestionsComment,
  parseManagedTestSuggestionsComment,
} from "./workflows/pr-fix-tests/selection";

export type PrReadyRunCommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

export type PrReadyRuntime =
  | {
      kind: "command";
      status: "configured" | "not-started" | "running" | "failed";
      startCommand?: string[];
      statusCommand?: string[];
      url?: string;
      message?: string;
    }
  | {
      kind: "unknown";
      status: "not-detected";
      message: string;
    };

export type PrReadyBaseSync =
  | {
      status: "up-to-date";
      baseRefName: string;
      remoteRef: string;
      baseTip: string;
      summary: string;
    }
  | {
      status: "merged";
      baseRefName: string;
      remoteRef: string;
      baseTip: string;
      summary: string;
    }
  | {
      status: "blocked";
      baseRefName: string;
      remoteRef: string;
      baseTip: string;
      summary: string;
    };

export type PrReadyCommentSummaryCategory =
  | "test-coverage"
  | "code-review"
  | "ci-checks"
  | "requirements"
  | "general";

export type PrReadyCommentSummaryItem = {
  kind: "issue-comment" | "review-thread" | "managed-test-suggestions";
  summary: string;
  url: string;
  author: string;
  updatedAt: string;
  path?: string;
  lineRange?: string;
};

export type PrReadyCommentSummaryGroup = {
  category: PrReadyCommentSummaryCategory;
  title: string;
  count: number;
  items: PrReadyCommentSummaryItem[];
};

export type PrReadyPullRequestContext = {
  pullRequest: {
    draft: boolean | "unknown";
    mergeable: boolean | null | "unknown";
    mergeableState?: string;
  };
  checks:
    | {
        status: "available";
        totalCount: number;
        failed: Array<{ name: string; conclusion?: string; url?: string }>;
        pending: Array<{ name: string; status: string; url?: string }>;
      }
    | {
        status: "unavailable";
        warning: string;
      };
  testSuggestions:
    | {
        status: "available";
        commentUrl: string;
        totalCount: number;
        openCount: number;
        addressedCount: number;
        topOpenSuggestions: string[];
      }
    | {
        status: "not-found";
        markers: readonly string[];
      }
    | {
        status: "unavailable";
        warning: string;
      };
  reviewComments:
    | {
        status: "available";
        totalCount: number;
        totalThreadCount: number;
        actionableThreadCount: number;
        handledThreadCount: number;
        duplicateThreadCount: number;
        resolvedThreadCount: number;
        outdatedThreadCount: number;
        topThreads: Array<{
          path: string;
          lineRange: string;
          author: string;
          summary: string;
          url: string;
        }>;
      }
    | {
        status: "unavailable";
        warning: string;
      };
  commentSummary:
    | {
        status: "available";
        totalCount: number;
        groups: PrReadyCommentSummaryGroup[];
      }
    | {
        status: "unavailable";
        warning: string;
      };
  warnings: string[];
};

export type PrReadyLocalReadinessStepResult = {
  name: string;
  command: string[];
  status: "passed" | "failed";
  outputFilePath: string;
  summary?: string;
};

export type PrReadyLocalReadiness =
  | {
      status: "not-configured";
      message: string;
      steps: [];
    }
  | {
      status: "skipped";
      message: string;
      steps: [];
    }
  | {
      status: "passed";
      steps: PrReadyLocalReadinessStepResult[];
    }
  | {
      status: "failed";
      steps: PrReadyLocalReadinessStepResult[];
    };

export type PrReadyToolResult =
  | {
      status: "ready";
      prNumber: number;
      title: string;
      url: string;
      branchName: string;
      runDir: string;
      metadataFilePath: string;
      baseSync: PrReadyBaseSync;
      runtime: PrReadyRuntime;
      localReadiness: PrReadyLocalReadiness;
      prContext: PrReadyPullRequestContext;
      nextAction: "browse-local-app";
    }
  | {
      status: "needs-action";
      prNumber: number;
      title: string;
      url: string;
      branchName: string;
      runDir: string;
      metadataFilePath: string;
      baseSync: PrReadyBaseSync;
      runtime: PrReadyRuntime;
      localReadiness: PrReadyLocalReadiness;
      prContext: PrReadyPullRequestContext;
      nextAction: "start-runtime";
    }
  | {
      status: "blocked";
      reason: "merge-conflicts" | "runtime-start-failed" | "local-readiness-failed";
      prNumber: number;
      title: string;
      url: string;
      branchName: string;
      runDir: string;
      metadataFilePath: string;
      baseSync: PrReadyBaseSync;
      runtime: PrReadyRuntime;
      localReadiness: PrReadyLocalReadiness;
      prContext: PrReadyPullRequestContext;
      nextAction:
        | "resolve-conflicts"
        | "start-runtime-manually"
        | "inspect-local-readiness";
    };

type PrReadyToolOptions = {
  unattended?: boolean;
  buildCommand: string[];
  ensureCleanWorkingTree: (repoRoot: string) => void;
  ensureVerificationCommandAvailable: (
    repoRoot: string,
    buildCommand: string[],
    workflowName: string
  ) => void;
  forge: RepositoryForge;
  prNumber: number;
  repoRoot: string;
  runCommand?: (
    command: string,
    args: string[],
    cwd?: string
  ) => PrReadyRunCommandResult;
  localRuntime?: RepositoryLocalRuntimeConfigType;
  prReadiness?: RepositoryPrReadinessConfigType;
};

function defaultRunCommand(
  command: string,
  args: string[],
  cwd?: string
): PrReadyRunCommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function createRunDir(repoRoot: string, prNumber: number): string {
  const runDir = resolve(
    repoRoot,
    ".prs",
    "runs",
    `${formatRunTimestamp()}-pr-${prNumber}-ready`
  );
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

function git(
  runCommand: (command: string, args: string[]) => PrReadyRunCommandResult,
  repoRoot: string,
  args: string[]
): PrReadyRunCommandResult {
  return runCommand("git", ["-C", repoRoot, ...args]);
}

function ensureSuccess(result: PrReadyRunCommandResult, message: string): void {
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(detail ? `${message} ${detail}` : message);
  }
}

function isBranchCheckedOutInAnotherWorktree(result: PrReadyRunCommandResult): boolean {
  const output = `${result.stderr}\n${result.stdout}`;
  return /already checked out at|is already used by worktree/i.test(output);
}

function extractCheckedOutWorktreePath(result: PrReadyRunCommandResult): string | undefined {
  const output = `${result.stderr}\n${result.stdout}`;
  return output.match(/already checked out at '([^']+)'/i)?.[1];
}

function removeCleanBlockingWorktree(
  runCommand: (command: string, args: string[]) => PrReadyRunCommandResult,
  repoRoot: string,
  branchName: string,
  worktreePath: string
): void {
  const statusResult = runCommand("git", ["-C", worktreePath, "status", "--porcelain"]);
  ensureSuccess(
    statusResult,
    `Failed to inspect worktree ${worktreePath} before checking out PR branch "${branchName}".`
  );

  if (statusResult.stdout.trim()) {
    throw new Error(
      `PR branch "${branchName}" is checked out in another worktree at ${worktreePath}, and that worktree has uncommitted changes. Commit, stash, or clear that worktree before preparing this PR in the main checkout.`
    );
  }

  ensureSuccess(
    git(runCommand, repoRoot, ["worktree", "remove", worktreePath]),
    `Failed to remove clean worktree ${worktreePath} before checking out PR branch "${branchName}".`
  );
}

function checkoutPullRequestBranch(
  runCommand: (command: string, args: string[]) => PrReadyRunCommandResult,
  repoRoot: string,
  pullRequest: PullRequestDetails
): string {
  const branchExists = git(runCommand, repoRoot, [
    "rev-parse",
    "--verify",
    `refs/heads/${pullRequest.headRefName}`,
  ]);

  if (branchExists.status !== 0) {
    ensureSuccess(
      git(runCommand, repoRoot, [
        "fetch",
        "origin",
        `refs/pull/${pullRequest.number}/head:refs/heads/${pullRequest.headRefName}`,
      ]),
      `Failed to fetch PR #${pullRequest.number} into local branch "${pullRequest.headRefName}".`
    );
  }

  const checkoutResult = git(runCommand, repoRoot, ["checkout", pullRequest.headRefName]);
  if (checkoutResult.status !== 0) {
    if (isBranchCheckedOutInAnotherWorktree(checkoutResult)) {
      const worktreePath = extractCheckedOutWorktreePath(checkoutResult);
      if (!worktreePath) {
        ensureSuccess(
          checkoutResult,
          `Failed to check out PR branch "${pullRequest.headRefName}".`
        );
      }
      removeCleanBlockingWorktree(
        runCommand,
        repoRoot,
        pullRequest.headRefName,
        worktreePath
      );
      ensureSuccess(
        git(runCommand, repoRoot, ["checkout", pullRequest.headRefName]),
        `Failed to check out PR branch "${pullRequest.headRefName}" after removing clean worktree ${worktreePath}.`
      );
      return pullRequest.headRefName;
    }
    ensureSuccess(
      checkoutResult,
      `Failed to check out PR branch "${pullRequest.headRefName}".`
    );
  }
  return pullRequest.headRefName;
}

function detectRuntime(localRuntime?: RepositoryLocalRuntimeConfigType): PrReadyRuntime {
  if (!localRuntime) {
    return {
      kind: "unknown",
      status: "not-detected",
      message:
        "No local runtime readiness config is set. Start the app with the repository's normal local runtime.",
    };
  }

  return {
    kind: "command",
    status: "configured",
    startCommand: localRuntime.startCommand,
    statusCommand: localRuntime.statusCommand,
    url: localRuntime.url,
  };
}

function startRuntime(
  runCommand: (command: string, args: string[]) => PrReadyRunCommandResult,
  runtime: PrReadyRuntime
): PrReadyRuntime {
  if (runtime.kind !== "command") {
    return runtime;
  }

  if (runtime.statusCommand) {
    const [command, ...args] = runtime.statusCommand;
    const statusResult = runCommand(command, args);
    if (statusResult.status === 0) {
      return {
        ...runtime,
        status: "running",
        message: "Local runtime is already running.",
      };
    }
  }

  if (!runtime.startCommand) {
    return {
      ...runtime,
      status: "failed",
      message:
        "Local runtime status check did not pass, and no startCommand is configured.",
    };
  }

  const [command, ...args] = runtime.startCommand;
  const result = runCommand(command, args);
  if (result.status !== 0) {
    return {
      ...runtime,
      status: "failed",
      message: result.stderr.trim() || result.stdout.trim() || "ddev start failed.",
    };
  }

  return {
    ...runtime,
    status: "running",
  };
}

function noConfiguredLocalReadiness(): PrReadyLocalReadiness {
  return {
    status: "not-configured",
    message: "No PR local readiness commands are configured.",
    steps: [],
  };
}

function skippedLocalReadiness(message: string): PrReadyLocalReadiness {
  return {
    status: "skipped",
    message,
    steps: [],
  };
}

function summarizeReadinessFailure(result: PrReadyRunCommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  if (!detail) {
    return "Command exited with a non-zero status.";
  }

  return detail.split(/\r?\n/)[0] ?? detail;
}

function writeReadinessStepOutput(input: {
  repoRoot: string;
  runDir: string;
  index: number;
  name: string;
  command: string[];
  result: PrReadyRunCommandResult;
}): string {
  const fileName = `local-readiness-${String(input.index + 1).padStart(2, "0")}.log`;
  const outputFilePath = resolve(input.runDir, fileName);
  writeFileSync(
    outputFilePath,
    [
      `# ${input.name}`,
      "",
      `$ ${input.command.join(" ")}`,
      "",
      `exit_status=${input.result.status}`,
      "",
      "## stdout",
      input.result.stdout.trimEnd(),
      "",
      "## stderr",
      input.result.stderr.trimEnd(),
      "",
    ].join("\n"),
    "utf8"
  );

  return toRepoRelativePath(input.repoRoot, outputFilePath);
}

function runLocalReadinessCommands(
  runCommand: (
    command: string,
    args: string[],
    cwd?: string
  ) => PrReadyRunCommandResult,
  repoRoot: string,
  runDir: string,
  prReadiness?: RepositoryPrReadinessConfigType
): PrReadyLocalReadiness {
  const commands = prReadiness?.commands ?? [];
  if (commands.length === 0) {
    return noConfiguredLocalReadiness();
  }

  const steps: PrReadyLocalReadinessStepResult[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    const step = commands[index];
    const [command, ...args] = step.command;
    const result = runCommand(command, args, repoRoot);
    const outputFilePath = writeReadinessStepOutput({
      repoRoot,
      runDir,
      index,
      name: step.name,
      command: step.command,
      result,
    });

    const stepResult: PrReadyLocalReadinessStepResult = {
      name: step.name,
      command: step.command,
      status: result.status === 0 ? "passed" : "failed",
      outputFilePath,
      ...(result.status === 0 ? {} : { summary: summarizeReadinessFailure(result) }),
    };
    steps.push(stepResult);

    if (stepResult.status === "failed") {
      return {
        status: "failed",
        steps,
      };
    }
  }

  return {
    status: "passed",
    steps,
  };
}

function fetchBaseState(
  runCommand: (command: string, args: string[]) => PrReadyRunCommandResult,
  repoRoot: string,
  pullRequest: PullRequestDetails,
  branchName: string
): PrReadyBaseSync {
  const remoteRef = `origin/${pullRequest.baseRefName}`;
  ensureSuccess(
    git(runCommand, repoRoot, ["fetch", "origin", pullRequest.baseRefName]),
    `Failed to fetch latest ${remoteRef}.`
  );

  const baseTipResult = git(runCommand, repoRoot, ["rev-parse", remoteRef]);
  ensureSuccess(baseTipResult, `Failed to resolve ${remoteRef}.`);
  const baseTip = baseTipResult.stdout.trim();

  const containsBase = git(runCommand, repoRoot, [
    "merge-base",
    "--is-ancestor",
    baseTip,
    "HEAD",
  ]);

  if (containsBase.status === 0) {
    return {
      status: "up-to-date",
      baseRefName: pullRequest.baseRefName,
      remoteRef,
      baseTip,
      summary: `"${branchName}" already contains ${remoteRef} tip ${baseTip}.`,
    };
  }

  const mergeResult = git(runCommand, repoRoot, ["merge", "--no-edit", "--no-ff", remoteRef]);
  if (mergeResult.status !== 0) {
    return {
      status: "blocked",
      baseRefName: pullRequest.baseRefName,
      remoteRef,
      baseTip,
      summary: `Merging ${remoteRef} into "${branchName}" produced conflicts.`,
    };
  }

  return {
    status: "merged",
    baseRefName: pullRequest.baseRefName,
    remoteRef,
    baseTip,
    summary: `Merged ${remoteRef} tip ${baseTip} into "${branchName}".`,
  };
}

function isFailedCheck(check: PullRequestCheckSignal): boolean {
  return (
    check.conclusion === "failure" ||
    check.conclusion === "timed-out" ||
    check.conclusion === "action-required" ||
    check.conclusion === "cancelled"
  );
}

function isPendingCheck(check: PullRequestCheckSignal): boolean {
  return (
    check.status === "queued" ||
    check.status === "in-progress" ||
    check.status === "pending" ||
    (check.status !== "completed" && check.conclusion !== "success")
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeCommentBody(body: string): string {
  const normalized = body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "(No comment body provided.)";
  }
  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 137)}...`;
}

function classifyIssueComment(body: string): PrReadyCommentSummaryCategory {
  const normalized = body.toLowerCase();
  if (
    /\b(ci|check|checks|build|smoke|workflow|action|pending|failing|failed|failure)\b/.test(
      normalized
    )
  ) {
    return "ci-checks";
  }
  if (/\b(test|tests|testing|coverage|spec|assert|regression)\b/.test(normalized)) {
    return "test-coverage";
  }
  if (
    /\b(requirement|requirements|acceptance|scope|product|ux|behavior|behaviour|expected)\b/.test(
      normalized
    )
  ) {
    return "requirements";
  }

  return "general";
}

function createGroupTitle(category: PrReadyCommentSummaryCategory): string {
  switch (category) {
    case "test-coverage":
      return "Test coverage";
    case "code-review":
      return "Code review";
    case "ci-checks":
      return "CI and checks";
    case "requirements":
      return "Requirements";
    case "general":
      return "General discussion";
  }
}

function hasManagedTestSuggestionsMarker(comment: RepositoryComment): boolean {
  return comment.body.includes(TEST_SUGGESTIONS_COMMENT_MARKER);
}

function buildManagedTestSuggestionsSummary(
  comment: RepositoryComment,
  topOpenSuggestions: string[]
): PrReadyCommentSummaryItem {
  return {
    kind: "managed-test-suggestions",
    summary:
      topOpenSuggestions.length > 0
        ? `Open suggestions: ${topOpenSuggestions.join(", ")}`
        : "All managed AI test suggestions addressed.",
    url: comment.url,
    author: comment.author,
    updatedAt: comment.updatedAt,
  };
}

function buildPullRequestCommentSummary(input: {
  issueComments?: RepositoryComment[];
  managedTestSuggestionsComment?: RepositoryComment;
  topOpenTestSuggestions: string[];
  reviewThreads?: ReturnType<typeof buildPullRequestReviewThreads>;
}): PrReadyPullRequestContext["commentSummary"] {
  if (input.issueComments === undefined && input.reviewThreads === undefined) {
    return {
      status: "unavailable",
      warning: "Pull request comment context is unavailable.",
    };
  }

  const groups = new Map<PrReadyCommentSummaryCategory, PrReadyCommentSummaryItem[]>();
  const addItem = (
    category: PrReadyCommentSummaryCategory,
    item: PrReadyCommentSummaryItem
  ) => {
    const existing = groups.get(category);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(category, [item]);
    }
  };

  if (input.managedTestSuggestionsComment) {
    addItem(
      "test-coverage",
      buildManagedTestSuggestionsSummary(
        input.managedTestSuggestionsComment,
        input.topOpenTestSuggestions
      )
    );
  }

  for (const comment of input.issueComments ?? []) {
    if (
      input.managedTestSuggestionsComment?.id === comment.id ||
      hasManagedTestSuggestionsMarker(comment)
    ) {
      continue;
    }

    addItem(classifyIssueComment(comment.body), {
      kind: "issue-comment",
      summary: summarizeCommentBody(comment.body),
      url: comment.url,
      author: comment.author,
      updatedAt: comment.updatedAt,
    });
  }

  for (const thread of input.reviewThreads ?? []) {
    addItem("code-review", {
      kind: "review-thread",
      summary: thread.summary,
      url: thread.rootComment.url,
      author: thread.rootComment.author,
      updatedAt: thread.rootComment.updatedAt,
      path: thread.path,
      lineRange: formatReviewCommentLineRange(thread.startLine, thread.endLine),
    });
  }

  const orderedCategories: PrReadyCommentSummaryCategory[] = [
    "test-coverage",
    "code-review",
    "ci-checks",
    "requirements",
    "general",
  ];
  const renderedGroups = orderedCategories
    .map((category) => {
      const items = groups.get(category) ?? [];
      return {
        category,
        title: createGroupTitle(category),
        count: items.length,
        items,
      };
    })
    .filter((group) => group.count > 0);

  return {
    status: "available",
    totalCount: renderedGroups.reduce((total, group) => total + group.count, 0),
    groups: renderedGroups,
  };
}

async function collectPullRequestContext(
  forge: RepositoryForge,
  pullRequest: PullRequestDetails
): Promise<PrReadyPullRequestContext> {
  const warnings: string[] = [];
  let issueCommentsForSummary: RepositoryComment[] | undefined;
  let managedTestSuggestionsComment: RepositoryComment | undefined;
  let topOpenTestSuggestions: string[] = [];
  let reviewThreadsForSummary:
    | ReturnType<typeof buildPullRequestReviewThreads>
    | undefined;
  const context: PrReadyPullRequestContext = {
    pullRequest: {
      draft: pullRequest.isDraft ?? "unknown",
      mergeable: pullRequest.mergeable ?? "unknown",
      mergeableState: pullRequest.mergeableState ?? undefined,
    },
    checks: {
      status: "unavailable",
      warning: "GitHub check context has not been fetched yet.",
    },
    testSuggestions: {
      status: "unavailable",
      warning: "Managed AI test suggestion context has not been fetched yet.",
    },
    reviewComments: {
      status: "unavailable",
      warning: "Pull request review comment context has not been fetched yet.",
    },
    commentSummary: {
      status: "unavailable",
      warning: "Pull request comment context has not been fetched yet.",
    },
    warnings,
  };

  try {
    const checks = await forge.fetchPullRequestChecks(pullRequest.number);
    context.checks = {
      status: "available",
      totalCount: checks.length,
      failed: checks
        .filter(isFailedCheck)
        .map((check) => ({
          name: check.name,
          conclusion: check.conclusion,
          url: check.url,
        })),
      pending: checks
        .filter(isPendingCheck)
        .map((check) => ({
          name: check.name,
          status: check.status,
          url: check.url,
        })),
    };
  } catch (error) {
    const warning = `GitHub checks unavailable: ${getErrorMessage(error)}`;
    warnings.push(warning);
    context.checks = {
      status: "unavailable",
      warning,
    };
  }

  try {
    const comments = await forge.fetchPullRequestIssueComments(pullRequest.number);
    issueCommentsForSummary = comments;
    const comment = findManagedTestSuggestionsComment(comments);
    if (!comment) {
      context.testSuggestions = {
        status: "not-found",
        markers: [TEST_SUGGESTIONS_COMMENT_MARKER],
      };
    } else {
      const suggestionsComment = parseManagedTestSuggestionsComment(comment);
      const openSuggestions = suggestionsComment.suggestions.filter(
        (suggestion) => !suggestion.addressed
      );
      topOpenTestSuggestions = openSuggestions
        .slice(0, 3)
        .map((suggestion) => suggestion.area);
      managedTestSuggestionsComment = comment;
      context.testSuggestions = {
        status: "available",
        commentUrl: comment.url,
        totalCount: suggestionsComment.suggestions.length,
        openCount: openSuggestions.length,
        addressedCount: suggestionsComment.suggestions.length - openSuggestions.length,
        topOpenSuggestions: topOpenTestSuggestions,
      };
    }
  } catch (error) {
    const warning = `Managed AI test suggestions unavailable: ${getErrorMessage(error)}`;
    warnings.push(warning);
    context.testSuggestions = {
      status: "unavailable",
      warning,
    };
  }

  try {
    const threadDetails = forge.fetchPullRequestReviewThreads
      ? await forge.fetchPullRequestReviewThreads(pullRequest.number)
      : undefined;
    const comments =
      threadDetails === undefined
        ? await forge.fetchPullRequestReviewComments(pullRequest.number)
        : threadDetails.flatMap((thread) => thread.comments);
    const reviewThreads =
      threadDetails === undefined
        ? buildPullRequestReviewThreads(comments)
        : buildPullRequestReviewThreadsFromDetails(threadDetails);
    const filteredThreads = filterActionablePullRequestReviewThreads(reviewThreads, {
      currentHeadSha: pullRequest.headSha,
    });
    const threads = filteredThreads.threads;
    reviewThreadsForSummary = threads;
    context.reviewComments = {
      status: "available",
      totalCount: comments.length,
      totalThreadCount: reviewThreads.length,
      actionableThreadCount: threads.length,
      handledThreadCount: filteredThreads.skipped.stalePrsAuthored,
      duplicateThreadCount: filteredThreads.skipped.duplicatePrsAuthored,
      resolvedThreadCount: filteredThreads.skipped.resolved,
      outdatedThreadCount: filteredThreads.skipped.outdated,
      topThreads: threads.slice(0, 5).map((thread) => ({
        path: thread.path,
        lineRange: formatReviewCommentLineRange(thread.startLine, thread.endLine),
        author: thread.rootComment.author,
        summary: thread.summary,
        url: thread.rootComment.url,
      })),
    };
  } catch (error) {
    const warning = `Review comments unavailable: ${getErrorMessage(error)}`;
    warnings.push(warning);
    context.reviewComments = {
      status: "unavailable",
      warning,
    };
  }

  context.commentSummary = buildPullRequestCommentSummary({
    issueComments: issueCommentsForSummary,
    managedTestSuggestionsComment,
    topOpenTestSuggestions,
    reviewThreads: reviewThreadsForSummary,
  });

  return context;
}

function writeMetadata(
  repoRoot: string,
  metadataFilePath: string,
  result: PrReadyToolResult
): void {
  writeFileSync(
    metadataFilePath,
    `${JSON.stringify(
      {
        ...result,
        runDir: toRepoRelativePath(repoRoot, result.runDir),
        metadataFilePath: toRepoRelativePath(repoRoot, result.metadataFilePath),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function readyPullRequestTool(
  options: PrReadyToolOptions
): Promise<PrReadyToolResult> {
  if (options.forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  options.ensureCleanWorkingTree(options.repoRoot);
  options.ensureVerificationCommandAvailable(
    options.repoRoot,
    options.buildCommand,
    "prs tool pr ready"
  );

  const runCommand = options.runCommand ?? defaultRunCommand;
  const pullRequest = await options.forge.fetchPullRequestDetails(options.prNumber);
  const runDir = createRunDir(options.repoRoot, pullRequest.number);
  const metadataFilePath = resolve(runDir, "metadata.json");
  const branchName = checkoutPullRequestBranch(runCommand, options.repoRoot, pullRequest);
  const runtime = detectRuntime(options.localRuntime);
  const baseSync = fetchBaseState(
    runCommand,
    options.repoRoot,
    pullRequest,
    branchName
  );
  const prContext = await collectPullRequestContext(options.forge, pullRequest);
  const skippedReadiness = skippedLocalReadiness(
    "Local readiness commands were skipped because base sync is blocked."
  );

  let result: PrReadyToolResult;
  if (baseSync.status === "blocked") {
    result = {
      status: "blocked",
      reason: "merge-conflicts",
      prNumber: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      branchName,
      runDir,
      metadataFilePath,
      baseSync,
      runtime:
        runtime.kind === "command" ? { ...runtime, status: "not-started" } : runtime,
      localReadiness:
        (options.prReadiness?.commands ?? []).length > 0
          ? skippedReadiness
          : noConfiguredLocalReadiness(),
      prContext,
      nextAction: "resolve-conflicts",
    };
    writeMetadata(options.repoRoot, metadataFilePath, result);
    return result;
  }

  const localReadiness = runLocalReadinessCommands(
    runCommand,
    options.repoRoot,
    runDir,
    options.prReadiness
  );
  if (localReadiness.status === "failed") {
    result = {
      status: "blocked",
      reason: "local-readiness-failed",
      prNumber: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      branchName,
      runDir,
      metadataFilePath,
      baseSync,
      runtime:
        runtime.kind === "command" ? { ...runtime, status: "not-started" } : runtime,
      localReadiness,
      prContext,
      nextAction: "inspect-local-readiness",
    };
    writeMetadata(options.repoRoot, metadataFilePath, result);
    return result;
  }

  const unattended = options.unattended ?? false;
  const startedRuntime = unattended ? startRuntime(runCommand, runtime) : runtime;
  if (startedRuntime.kind === "command" && startedRuntime.status === "failed") {
    result = {
      status: "blocked",
      reason: "runtime-start-failed",
      prNumber: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      branchName,
      runDir,
      metadataFilePath,
      baseSync,
      runtime: startedRuntime,
      localReadiness,
      prContext,
      nextAction: "start-runtime-manually",
    };
    writeMetadata(options.repoRoot, metadataFilePath, result);
    return result;
  }

  if (!unattended && startedRuntime.kind === "command") {
    result = {
      status: "needs-action",
      prNumber: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      branchName,
      runDir,
      metadataFilePath,
      baseSync,
      runtime: startedRuntime,
      localReadiness,
      prContext,
      nextAction: "start-runtime",
    };
    writeMetadata(options.repoRoot, metadataFilePath, result);
    return result;
  }

  result = {
    status: "ready",
    prNumber: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    branchName,
    runDir,
    metadataFilePath,
    baseSync,
    runtime: startedRuntime,
    localReadiness,
    prContext,
    nextAction: "browse-local-app",
  };
  writeMetadata(options.repoRoot, metadataFilePath, result);
  return result;
}
