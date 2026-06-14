import type { PullRequestDetails, RepositoryForge } from "../../forge";
import type { ReviewedGeneratedText } from "../../generated-text-review";
import { finalizeRuntimeChanges } from "../../runtime-change-review";
import {
  buildPullRequestTokenUsageMetadata,
  getTokenUsageArtifactFilePath,
  type PullRequestTokenUsageMetadata,
} from "../../token-audit";
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

export type PullRequestFixPreparationResult = {
  status: "ready";
  flow: "pr-add-tests";
  prNumber: number;
  runDir: string;
  snapshotFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
  selectedCount: number;
  tokenUsage: PullRequestTokenUsageMetadata;
  nextAction: "continue-in-current-codex-session";
};

async function selectPullRequestTestSuggestions(
  pullRequest: PullRequestDetails,
  suggestions: PullRequestTestSuggestion[],
  promptForLine: (prompt: string) => Promise<string>,
  selectionOverride?: string
): Promise<PullRequestTestSuggestion[]> {
  console.log(`AI test suggestions for PR #${pullRequest.number}: ${pullRequest.title}`);
  printPullRequestTestSuggestions(suggestions);

  const selection =
    selectionOverride ??
    (await promptForLine(
      "Select test suggestions to implement [All|none|1,2,...] (default: All): "
    ));
  const selectedIndexes = parsePullRequestTestSuggestionSelection(
    selection,
    suggestions.length
  );

  return selectedIndexes.map((index) => suggestions[index]).filter(Boolean);
}

export async function runPrFixTestsCommand(
  options: RunPrFixTestsCommandOptions
): Promise<void | PullRequestFixPreparationResult> {
  if (options.forge.type === "none") {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  options.ensureCleanWorkingTree(options.repoRoot);
  (options.ensureVerificationCommandAvailable ?? ensureVerificationCommandAvailable)(
    options.repoRoot,
    options.buildCommand,
    "prs pr add-tests"
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

  const uncheckedSuggestions = suggestionsComment.suggestions.filter(
    (suggestion) => !suggestion.addressed
  );
  if (uncheckedSuggestions.length === 0) {
    console.log("All managed AI test suggestions are already addressed.");
    return;
  }

  const selectedSuggestions = await selectPullRequestTestSuggestions(
    pullRequest,
    uncheckedSuggestions,
    options.promptForLine,
    options.selection
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

  if (options.mode === "prepare") {
    return {
      status: "ready",
      flow: "pr-add-tests",
      prNumber: pullRequest.number,
      runDir: workspace.runDir,
      snapshotFilePath: workspace.snapshotFilePath,
      promptFilePath: workspace.promptFilePath,
      metadataFilePath: workspace.metadataFilePath,
      outputLogPath: workspace.outputLogPath,
      selectedCount: selectedSuggestions.length,
      tokenUsage: buildPullRequestTokenUsageMetadata({
        artifactFile: getTokenUsageArtifactFilePath(workspace.runDir),
        workflowName: "pr-add-tests",
        role: "tester",
        prNumber: pullRequest.number,
        runDir: workspace.runDir,
        publishWhen: ["reviewed-updates-pushed"],
      }),
      nextAction: "continue-in-current-codex-session",
    };
  }

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
      `test: add suggested tests for PR #${pullRequest.number}\n`,
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
