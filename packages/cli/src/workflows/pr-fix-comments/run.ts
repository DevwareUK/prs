import type {
  PullRequestDetails,
  PullRequestReviewComment,
  RepositoryForge,
} from "../../forge";
import {
  buildPullRequestReviewTasks,
  buildPullRequestReviewThreads,
  formatPullRequestReviewTaskLocation,
  getReviewCommentDisplayLine,
  parsePullRequestReviewSelection,
  shouldRetainPullRequestReviewCommentInThread,
} from "./selection";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import {
  createPullRequestFixWorkspace,
  writePullRequestFixWorkspaceFiles,
} from "./workspace";
import type { PullRequestFixWorkspace, PullRequestReviewTask } from "./types";

type RunPrFixCommentsCommandOptions = {
  prNumber: number;
  repoRoot: string;
  buildCommand: string[];
  forge: RepositoryForge;
  ensureCleanWorkingTree(repoRoot: string): void;
  promptForLine(prompt: string): Promise<string>;
  runCodex(
    repoRoot: string,
    workspace: Pick<
      PullRequestFixWorkspace,
      "promptFilePath" | "outputLogPath" | "finalMessageFilePath"
    >
  ): void;
  verifyBuild(repoRoot: string, buildCommand: string[], outputLogPath: string): void;
  hasChanges(repoRoot: string): boolean;
  commitGeneratedChanges(repoRoot: string, commitMessage: string): void;
};

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

function shouldCommitGeneratedChanges(response: string): boolean {
  const normalized = response.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return ["y", "yes"].includes(normalized);
}

async function selectPullRequestReviewComments(
  pullRequest: PullRequestDetails,
  comments: PullRequestReviewComment[],
  promptForLine: (prompt: string) => Promise<string>
): Promise<PullRequestReviewTask[]> {
  const { groupTasks, threadTasks } = buildPullRequestReviewTasks(comments);
  printPullRequestReviewTasks(pullRequest, groupTasks, threadTasks);

  const selectionPrompt =
    groupTasks.length > 0
      ? "Select tasks to address [all|none|g1,2,...] (`all` selects every individual thread): "
      : "Select tasks to address [all|none|1,2,...]: ";
  const selection = await promptForLine(selectionPrompt);
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
): Promise<void> {
  if (options.forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  options.ensureCleanWorkingTree(options.repoRoot);

  console.log(`Fetching pull request #${options.prNumber}...`);
  const pullRequest = await options.forge.fetchPullRequestDetails(options.prNumber);
  const linkedIssues = await fetchLinkedIssuesForPullRequest(options.forge, pullRequest);
  const comments = (
    await options.forge.fetchPullRequestReviewComments(options.prNumber)
  )
    .filter(shouldRetainPullRequestReviewCommentInThread)
    .sort(sortPullRequestReviewComments);

  if (buildPullRequestReviewThreads(comments).length === 0) {
    throw new Error(
      `No actionable pull request review comments were found for PR #${options.prNumber}.`
    );
  }

  const selectedTasks = await selectPullRequestReviewComments(
    pullRequest,
    comments,
    options.promptForLine
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

  console.log("Running Codex non-interactively for the selected review tasks...");
  options.runCodex(options.repoRoot, workspace);
  console.log("Codex phase completed. Resuming build and commit steps.");

  console.log("Verifying build...");
  options.verifyBuild(
    options.repoRoot,
    options.buildCommand,
    workspace.outputLogPath
  );

  if (!options.hasChanges(options.repoRoot)) {
    throw new Error("Codex completed without producing any file changes to commit.");
  }

  const commitNow = shouldCommitGeneratedChanges(
    await options.promptForLine("Commit fixes now? [Y/n]: ")
  );
  if (!commitNow) {
    console.log("Leaving the generated changes uncommitted.");
    return;
  }

  console.log("Committing generated changes...");
  options.commitGeneratedChanges(
    options.repoRoot,
    `fix: address PR review comments for #${pullRequest.number}`
  );
}
