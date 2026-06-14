import type { RepositoryForge } from "../../forge";
import type { ReviewedGeneratedText } from "../../generated-text-review";
import { finalizeRuntimeChanges } from "../../runtime-change-review";
import {
  buildPullRequestTokenUsageMetadata,
  getTokenUsageArtifactFilePath,
  type PullRequestTokenUsageMetadata,
} from "../../token-audit";
import { ensureVerificationCommandAvailable } from "../../workflow-preflights";
import { pushReviewedPullRequestUpdates } from "../pull-request-reviewed-updates";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import type {
  PullRequestFixFailingTestsWorkspace,
  VerificationFailure,
} from "./types";
import {
  createPullRequestFixFailingTestsWorkspace,
  writePullRequestFixFailingTestsWorkspaceFiles,
} from "./workspace";

type RunPrFixFailingTestsCommandOptions = {
  mode?: "legacy-launch" | "prepare";
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
        workspace: Pick<
          PullRequestFixFailingTestsWorkspace,
          "promptFilePath" | "outputLogPath"
        >
      ): void;
    };
  };
  forge: RepositoryForge;
  ensureCleanWorkingTree(repoRoot: string): void;
  captureVerificationFailure(
    repoRoot: string,
    buildCommand: string[]
  ): VerificationFailure | undefined;
  promptForLine(prompt: string): Promise<string>;
  verifyBuild(repoRoot: string, buildCommand: string[], outputLogPath: string): void;
  hasChanges(repoRoot: string): boolean;
  commitGeneratedChanges(repoRoot: string, commitMessage: ReviewedGeneratedText): void;
};

export type PullRequestFixFailingTestsPreparationResult = {
  status: "ready";
  flow: "pr-fix-tests";
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

export async function runPrFixFailingTestsCommand(
  options: RunPrFixFailingTestsCommandOptions
): Promise<void | PullRequestFixFailingTestsPreparationResult> {
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

  const initialFailure = options.captureVerificationFailure(
    options.repoRoot,
    options.buildCommand
  );
  if (!initialFailure) {
    console.log(
      "Configured verification command passed. No failing test output was captured. If you meant to add tests from managed AI suggestions, run `prs pr add-tests <pr-number>`."
    );
    return;
  }

  const workspace = createPullRequestFixFailingTestsWorkspace(
    options.repoRoot,
    pullRequest.number
  );
  writePullRequestFixFailingTestsWorkspaceFiles(
    options.repoRoot,
    pullRequest,
    initialFailure,
    workspace,
    options.buildCommand,
    linkedIssues
  );

  if (options.mode === "prepare") {
    return {
      status: "ready",
      flow: "pr-fix-tests",
      prNumber: pullRequest.number,
      runDir: workspace.runDir,
      snapshotFilePath: workspace.snapshotFilePath,
      promptFilePath: workspace.promptFilePath,
      metadataFilePath: workspace.metadataFilePath,
      outputLogPath: workspace.outputLogPath,
      selectedCount: 1,
      tokenUsage: buildPullRequestTokenUsageMetadata({
        artifactFile: getTokenUsageArtifactFilePath(workspace.runDir),
        workflowName: "pr-fix-tests",
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
  console.log(`Fix the captured failing verification output in ${runtime.displayName}.`);
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
      `fix: address failing tests for PR #${pullRequest.number}\n`,
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
