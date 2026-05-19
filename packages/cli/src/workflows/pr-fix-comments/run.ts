import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  PullRequestDetails,
  PullRequestReviewComment,
  RepositoryForge,
} from "../../forge";
import type { ReviewedGeneratedText } from "../../generated-text-review";
import { finalizeRuntimeChanges } from "../../runtime-change-review";
import { ensureVerificationCommandAvailable } from "../../workflow-preflights";
import { pushReviewedPullRequestUpdates } from "../pull-request-reviewed-updates";
import {
  buildPullRequestReviewTasksFromThreads,
  buildPullRequestReviewThreads,
  buildPullRequestReviewThreadsFromDetails,
  filterActionablePullRequestReviewThreads,
  formatPullRequestReviewTaskLocation,
  getReviewCommentDisplayLine,
  isPrsAuthoredReviewComment,
  parsePullRequestReviewSelection,
  shouldRetainPullRequestReviewCommentInThread,
} from "./selection";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import {
  createPullRequestFixWorkspace,
  writePullRequestFixWorkspaceFiles,
} from "./workspace";
import type {
  PullRequestFixWorkspace,
  PullRequestReviewTask,
  PullRequestReviewThread,
} from "./types";

type RunPrFixCommentsCommandOptions = {
  mode?: "legacy-launch" | "prepare";
  selection?: string;
  prNumber: number;
  repoRoot: string;
  buildCommand: string[];
  ensureVerificationCommandAvailable?(
    repoRoot: string,
    buildCommand: string[],
    workflowLabel: string
  ): void;
  runtime: {
    resolve(): {
      displayName: string;
      launch(
        repoRoot: string,
        workspace: Pick<PullRequestFixWorkspace, "promptFilePath" | "outputLogPath">
      ): void;
    };
  };
  forge: RepositoryForge;
  ensureCleanWorkingTree(repoRoot: string): void;
  promptForLine(prompt: string): Promise<string>;
  verifyBuild(repoRoot: string, buildCommand: string[], outputLogPath: string): void;
  hasChanges(repoRoot: string): boolean;
  commitGeneratedChanges(repoRoot: string, commitMessage: ReviewedGeneratedText): void;
};

export type PullRequestFixCommentsPreparationResult = {
  status: "ready";
  flow: "pr-fix-comments";
  prNumber: number;
  runDir: string;
  snapshotFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
  selectedCount: number;
  nextAction: "continue-in-current-codex-session";
};

type AddressedReviewCommentsRun = {
  prNumber: number;
  completedAt: string;
  commitSha?: string;
  verification?: {
    status?: string;
  };
  push?: {
    status?: string;
  };
};

function parseAddressedReviewCommentsRun(
  raw: string
): AddressedReviewCommentsRun | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<AddressedReviewCommentsRun>;
    if (
      typeof parsed.prNumber !== "number" ||
      typeof parsed.completedAt !== "string"
    ) {
      return undefined;
    }

    return {
      prNumber: parsed.prNumber,
      completedAt: parsed.completedAt,
      commitSha:
        typeof parsed.commitSha === "string" ? parsed.commitSha : undefined,
      verification:
        parsed.verification && typeof parsed.verification === "object"
          ? parsed.verification
          : undefined,
      push: parsed.push && typeof parsed.push === "object" ? parsed.push : undefined,
    };
  } catch {
    return undefined;
  }
}

function findLatestSuccessfulFixCommentsRun(
  repoRoot: string,
  prNumber: number
): AddressedReviewCommentsRun | undefined {
  const runsDir = resolve(repoRoot, ".prs", "runs");
  if (!existsSync(runsDir)) {
    return undefined;
  }

  return readdirSync(runsDir)
    .filter((entry) => entry.endsWith(`-pr-${prNumber}-fix-comments`))
    .map((entry) => resolve(runsDir, entry, "addressed-review-comments.json"))
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => parseAddressedReviewCommentsRun(readFileSync(filePath, "utf8")))
    .filter((run): run is AddressedReviewCommentsRun => {
      return (
        run !== undefined &&
        run.prNumber === prNumber &&
        run.verification?.status === "passed" &&
        (run.push?.status === "pushed" || run.push?.status === "already-up-to-date")
      );
    })
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))[0];
}

function areChecksGreen(checks: Awaited<ReturnType<RepositoryForge["fetchPullRequestChecks"]>>): boolean {
  if (checks.length === 0) {
    return false;
  }

  return checks.every((check) => {
    if (check.status !== "completed") {
      return false;
    }

    return (
      check.conclusion === "success" ||
      check.conclusion === "neutral" ||
      check.conclusion === "skipped"
    );
  });
}

function getHeadCommitSha(repoRoot: string): string | undefined {
  let result;
  try {
    result = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return undefined;
  }

  return result.status === 0 && !result.error ? result.stdout.trim() || undefined : undefined;
}

function writeAddressedReviewCommentsRun(input: {
  workspace: PullRequestFixWorkspace;
  pullRequest: PullRequestDetails;
  selectedTasks: PullRequestReviewTask[];
  commitSha?: string;
  pushStatus: "pushed" | "already-up-to-date";
}): void {
  const selectedThreads = input.selectedTasks.flatMap((task) => task.threads);
  const selectedComments = input.selectedTasks.flatMap((task) => task.comments);
  const completedAt = new Date().toISOString();

  writeFileSync(
    resolve(input.workspace.runDir, "addressed-review-comments.json"),
    `${JSON.stringify(
      {
        prNumber: input.pullRequest.number,
        completedAt,
        commitSha: input.commitSha,
        verification: {
          status: "passed",
        },
        push: {
          status: input.pushStatus,
        },
        selectedThreads: selectedThreads.map((thread) => ({
          threadId: thread.threadId,
          nodeId: thread.nodeId,
          path: thread.path,
          summary: thread.summary,
        })),
        selectedComments: selectedComments.map((comment) => ({
          id: comment.id,
          path: comment.path,
          url: comment.url,
        })),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function isPrsAuthoredReviewThread(thread: PullRequestReviewTask["threads"][number]): boolean {
  return thread.actionableComments.length > 0
    ? thread.actionableComments.every(isPrsAuthoredReviewComment)
    : isPrsAuthoredReviewComment(thread.rootComment);
}

async function acknowledgeAddressedReviewThreads(input: {
  forge: RepositoryForge;
  selectedTasks: PullRequestReviewTask[];
  commitSha?: string;
}): Promise<void> {
  const reply = input.forge.replyToPullRequestReviewThread;
  const resolveThread = input.forge.resolvePullRequestReviewThread;
  if (!reply && !resolveThread) {
    return;
  }

  const threadsByNodeId = new Map(
    input.selectedTasks
      .flatMap((task) => task.threads)
      .filter((thread) => thread.nodeId && isPrsAuthoredReviewThread(thread))
      .map((thread) => [thread.nodeId as string, thread])
  );
  const commitLabel = input.commitSha ? `\`${input.commitSha.slice(0, 12)}\`` : "the latest fix commit";
  const body = `Addressed by ${commitLabel} after \`prs pr fix-comments\` verification passed.`;

  for (const nodeId of threadsByNodeId.keys()) {
    try {
      await reply?.call(input.forge, nodeId, body);
    } catch (error) {
      console.log(
        `Could not reply to addressed review thread ${nodeId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    try {
      await resolveThread?.call(input.forge, nodeId);
    } catch (error) {
      console.log(
        `Could not resolve addressed review thread ${nodeId}; resolve it manually if needed. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

function sortPullRequestReviewComments(
  left: PullRequestReviewComment,
  right: PullRequestReviewComment
): number {
  const pathComparison = left.path.localeCompare(right.path);
  if (pathComparison !== 0) {
    return pathComparison;
  }

  const lineComparison =
    (getReviewCommentDisplayLine(left) ?? Number.MAX_SAFE_INTEGER) -
    (getReviewCommentDisplayLine(right) ?? Number.MAX_SAFE_INTEGER);
  if (lineComparison !== 0) {
    return lineComparison;
  }

  return left.id - right.id;
}

function printPullRequestReviewTasks(
  pullRequest: PullRequestDetails,
  groupTasks: PullRequestReviewTask[],
  threadTasks: PullRequestReviewTask[]
): void {
  console.log(`Actionable review tasks for PR #${pullRequest.number}: ${pullRequest.title}`);
  const paths = [...new Set(threadTasks.map((task) => task.path))];

  for (const path of paths) {
    const fileGroupTasks = groupTasks.filter((task) => task.path === path);
    const fileThreadTasks = threadTasks.filter((task) => task.path === path);

    console.log("");
    console.log(path);

    for (const groupTask of fileGroupTasks) {
      const groupNumber =
        groupTasks.findIndex((task) => task.taskId === groupTask.taskId) + 1;
      console.log(
        `  g${groupNumber}. ${formatPullRequestReviewTaskLocation(groupTask)} (${groupTask.threads.length} threads, ${groupTask.comments.length} comments)`
      );
      console.log(`      ${groupTask.summary}`);
    }

    for (const threadTask of fileThreadTasks) {
      const threadNumber =
        threadTasks.findIndex((task) => task.taskId === threadTask.taskId) + 1;
      const thread = threadTask.threads[0];
      const commentLabel = thread.comments.length === 1 ? "comment" : "comments";

      console.log(
        `  ${threadNumber}. ${formatPullRequestReviewTaskLocation(threadTask)} by ${thread.rootComment.author} (${thread.comments.length} ${commentLabel})`
      );
      console.log(`      ${threadTask.summary}`);
      if (thread.comments.length > 1) {
        const replyAuthors = [
          ...new Set(thread.comments.slice(1).map((comment) => comment.author)),
        ];
        if (replyAuthors.length > 0) {
          console.log(`      Thread context from: ${replyAuthors.join(", ")}`);
        }
      }
    }
  }
}

async function selectPullRequestReviewComments(
  pullRequest: PullRequestDetails,
  threadTasks: PullRequestReviewTask[],
  groupTasks: PullRequestReviewTask[],
  promptForLine: (prompt: string) => Promise<string>,
  selectionOverride?: string
): Promise<PullRequestReviewTask[]> {
  printPullRequestReviewTasks(pullRequest, groupTasks, threadTasks);

  const selectionPrompt =
    groupTasks.length > 0
      ? "Select tasks to address [All|none|g1,2,...] (default: All; `all` selects every individual thread): "
      : "Select tasks to address [All|none|1,2,...] (default: All): ";
  const selection = selectionOverride ?? (await promptForLine(selectionPrompt));
  const selectedEntries = parsePullRequestReviewSelection(
    selection,
    threadTasks.length,
    groupTasks.length
  );
  const selectedGroupIndexes = new Set(
    selectedEntries
      .filter((entry) => entry.kind === "group")
      .map((entry) => entry.index)
  );
  const coveredThreadIds = new Set(
    [...selectedGroupIndexes].flatMap(
      (groupIndex) =>
        groupTasks[groupIndex]?.threads.map((thread) => thread.threadId) ?? []
    )
  );
  const selectedTasks: PullRequestReviewTask[] = [];
  const addedTaskIds = new Set<string>();

  for (const entry of selectedEntries) {
    if (entry.kind === "group") {
      const task = groupTasks[entry.index];
      if (!task || addedTaskIds.has(task.taskId)) {
        continue;
      }

      selectedTasks.push(task);
      addedTaskIds.add(task.taskId);
      continue;
    }

    const task = threadTasks[entry.index];
    if (!task || addedTaskIds.has(task.taskId)) {
      continue;
    }

    const thread = task.threads[0];
    if (coveredThreadIds.has(thread.threadId)) {
      continue;
    }

    selectedTasks.push(task);
    addedTaskIds.add(task.taskId);
  }

  return selectedTasks;
}

export async function runPrFixCommentsCommand(
  options: RunPrFixCommentsCommandOptions
): Promise<void | PullRequestFixCommentsPreparationResult> {
  if (options.forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  options.ensureCleanWorkingTree(options.repoRoot);
  (options.ensureVerificationCommandAvailable ?? ensureVerificationCommandAvailable)(
    options.repoRoot,
    options.buildCommand,
    "prs pr fix-comments"
  );

  console.log(`Fetching pull request #${options.prNumber}...`);
  const pullRequest = await options.forge.fetchPullRequestDetails(options.prNumber);
  const linkedIssues = await fetchLinkedIssuesForPullRequest(options.forge, pullRequest);
  const latestSuccessfulFix = findLatestSuccessfulFixCommentsRun(
    options.repoRoot,
    pullRequest.number
  );
  let comments: PullRequestReviewComment[] = [];
  let reviewThreads: PullRequestReviewThread[];
  if (options.forge.fetchPullRequestReviewThreads) {
    try {
      reviewThreads = buildPullRequestReviewThreadsFromDetails(
        await options.forge.fetchPullRequestReviewThreads(options.prNumber)
      );
    } catch {
      comments = (
        await options.forge.fetchPullRequestReviewComments(options.prNumber)
      )
        .filter(shouldRetainPullRequestReviewCommentInThread)
        .sort(sortPullRequestReviewComments);
      reviewThreads = buildPullRequestReviewThreads(comments);
    }
  } else {
    comments = (
      await options.forge.fetchPullRequestReviewComments(options.prNumber)
    )
      .filter(shouldRetainPullRequestReviewCommentInThread)
      .sort(sortPullRequestReviewComments);
    reviewThreads = buildPullRequestReviewThreads(comments);
  }
  const filteredThreads = filterActionablePullRequestReviewThreads(reviewThreads, {
    latestSuccessfulFix,
  });

  if (filteredThreads.threads.length === 0) {
    if (latestSuccessfulFix && filteredThreads.skipped.stalePrsAuthored > 0) {
      try {
        const checks = await options.forge.fetchPullRequestChecks(pullRequest.number);
        if (areChecksGreen(checks)) {
          throw new Error(
            `No new actionable review comments were found for PR #${options.prNumber}; previous PRS comments may need resolving.`
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("No new actionable review comments")
        ) {
          throw error;
        }
      }
    }

    throw new Error(
      `No actionable pull request review comments were found for PR #${options.prNumber}.`
    );
  }

  const { groupTasks, threadTasks } = buildPullRequestReviewTasksFromThreads(
    filteredThreads.threads
  );
  const selectedTasks = await selectPullRequestReviewComments(
    pullRequest,
    threadTasks,
    groupTasks,
    options.promptForLine,
    options.selection
  );
  if (selectedTasks.length === 0) {
    console.log("No review tasks selected. Exiting without changes.");
    return;
  }

  const workspace = createPullRequestFixWorkspace(
    options.repoRoot,
    pullRequest.number
  );
  writePullRequestFixWorkspaceFiles(
    options.repoRoot,
    pullRequest,
    selectedTasks,
    workspace,
    options.buildCommand,
    linkedIssues
  );

  if (options.mode === "prepare") {
    return {
      status: "ready",
      flow: "pr-fix-comments",
      prNumber: pullRequest.number,
      runDir: workspace.runDir,
      snapshotFilePath: workspace.snapshotFilePath,
      promptFilePath: workspace.promptFilePath,
      metadataFilePath: workspace.metadataFilePath,
      outputLogPath: workspace.outputLogPath,
      selectedCount: selectedTasks.length,
      nextAction: "continue-in-current-codex-session",
    };
  }

  const runtime = options.runtime.resolve();
  console.log(
    `Opening an interactive ${runtime.displayName} session in this terminal...`
  );
  console.log(`Complete the selected review task fixes in ${runtime.displayName}.`);
  console.log(
    `When ${runtime.displayName} exits, prs will resume with build and commit steps.`
  );
  runtime.launch(options.repoRoot, workspace);

  console.log("Verifying build...");
  options.verifyBuild(
    options.repoRoot,
    options.buildCommand,
    workspace.outputLogPath
  );

  if (!options.hasChanges(options.repoRoot)) {
    throw new Error(
      `${runtime.displayName} completed without producing any file changes to commit.`
    );
  }

  const finalizeResult = await finalizeRuntimeChanges({
    repoRoot: options.repoRoot,
    runDir: workspace.runDir,
    commitPrompt: "Commit fixes with this message? [Y/n/m]: ",
    promptForLine: options.promptForLine,
    hasChanges: options.hasChanges,
    commitGeneratedChanges: options.commitGeneratedChanges,
    resolveInitialCommitMessage: async () =>
      `fix: address PR review comments for #${pullRequest.number}\n`,
    noChangesMessage: `${runtime.displayName} completed without producing any file changes to commit.`,
  });

  if (!finalizeResult.committed) {
    return;
  }

  const pushResult = pushReviewedPullRequestUpdates(
    options.repoRoot,
    workspace.outputLogPath,
    pullRequest.headRefName
  );
  const commitSha = getHeadCommitSha(options.repoRoot);
  writeAddressedReviewCommentsRun({
    workspace,
    pullRequest,
    selectedTasks,
    commitSha,
    pushStatus: pushResult.status,
  });
  await acknowledgeAddressedReviewThreads({
    forge: options.forge,
    selectedTasks,
    commitSha,
  });
}
