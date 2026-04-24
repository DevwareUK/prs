import type { PullRequestDetails, RepositoryForge } from "../../forge";
import type { ReviewedGeneratedText } from "../../generated-text-review";
import { finalizeRuntimeChanges } from "../../runtime-change-review";
import { ensureVerificationCommandAvailable } from "../../workflow-preflights";
import { pushReviewedPullRequestUpdates } from "../pull-request-reviewed-updates";
import {
  findManagedTestSuggestionsComment,
  parseManagedTestSuggestionsComment,
  parsePullRequestTestSuggestionSelection,
  printPullRequestTestSuggestions,
} from "./selection";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import {
  createPullRequestFixTestsWorkspace,
  writePullRequestFixTestsWorkspaceFiles,
} from "./workspace";
import type {
  PullRequestFixTestsWorkspace,
  PullRequestTestSuggestion,
} from "./types";

type RunPrFixTestsCommandOptions = {
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
        workspace: Pick<PullRequestFixTestsWorkspace, "promptFilePath" | "outputLogPath">
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

async function selectPullRequestTestSuggestions(
  pullRequest: PullRequestDetails,
  suggestions: PullRequestTestSuggestion[],
  promptForLine: (prompt: string) => Promise<string>
): Promise<PullRequestTestSuggestion[]> {
  console.log(`AI test suggestions for PR #${pullRequest.number}: ${pullRequest.title}`);
  printPullRequestTestSuggestions(suggestions);

  const selection = await promptForLine(
    "Select test suggestions to implement [all|none|1,2,...]: "
  );
  const selectedIndexes = parsePullRequestTestSuggestionSelection(
    selection,
    suggestions.length
  );

  return selectedIndexes.map((index) => suggestions[index]).filter(Boolean);
}

export async function runPrFixTestsCommand(
  options: RunPrFixTestsCommandOptions
): Promise<void> {
  if (options.forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  options.ensureCleanWorkingTree(options.repoRoot);
  (options.ensureVerificationCommandAvailable ?? ensureVerificationCommandAvailable)(
    options.repoRoot,
    options.buildCommand,
    "prs pr fix-tests"
  );

  console.log(`Fetching pull request #${options.prNumber}...`);
  const pullRequest = await options.forge.fetchPullRequestDetails(options.prNumber);
  const linkedIssues = await fetchLinkedIssuesForPullRequest(options.forge, pullRequest);
  const comment = findManagedTestSuggestionsComment(
    await options.forge.fetchPullRequestIssueComments(options.prNumber)
  );

  if (!comment) {
    throw new Error(
      `No managed AI test suggestions comment was found for PR #${options.prNumber}.`
    );
  }

  let suggestionsComment;
  try {
    suggestionsComment = parseManagedTestSuggestionsComment(comment);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse the managed AI test suggestions comment for PR #${options.prNumber}. ${message}`
    );
  }

  const selectedSuggestions = await selectPullRequestTestSuggestions(
    pullRequest,
    suggestionsComment.suggestions,
    options.promptForLine
  );
  if (selectedSuggestions.length === 0) {
    console.log("No test suggestions selected. Exiting without changes.");
    return;
  }

  const workspace = createPullRequestFixTestsWorkspace(
    options.repoRoot,
    pullRequest.number
  );
  writePullRequestFixTestsWorkspaceFiles(
    options.repoRoot,
    pullRequest,
    selectedSuggestions,
    suggestionsComment,
    workspace,
    options.buildCommand,
    linkedIssues
  );

  const runtime = options.runtime.resolve();
  console.log(
    `Opening an interactive ${runtime.displayName} session in this terminal...`
  );
  console.log(
    `Complete the selected automated test changes in ${runtime.displayName}.`
  );
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
      `test: address AI test suggestions for PR #${pullRequest.number}\n`,
    noChangesMessage: `${runtime.displayName} completed without producing any file changes to commit.`,
  });

  if (!finalizeResult.committed) {
    return;
  }

  pushReviewedPullRequestUpdates(
    options.repoRoot,
    workspace.outputLogPath,
    pullRequest.headRefName
  );
}
