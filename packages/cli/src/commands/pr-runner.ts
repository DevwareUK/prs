import { getCliArgs,getDefaultRepoRoot,getRepositoryConfig,getRepositoryForge } from "../cli-context";
import {
captureVerificationFailure,
commitGeneratedChanges,
ensureCleanWorkingTree,
hasChanges,
verifyBuild,
} from "../cli-git";
import { promptForLine } from "../cli-prompts";
import { ensureVerificationCommandAvailable,preflightRemoteBranch } from "../workflow-preflights";
import { runPrFixCommentsCommand } from "../workflows/pr-fix-comments/run";
import { runPrFixFailingTestsCommand } from "../workflows/pr-fix-failing-tests/run";
import { runPrFixTestsCommand } from "../workflows/pr-fix-tests/run";
import { runPrResolveConflictsCommand } from "../workflows/pr-resolve-conflicts/run";
import { parseIssueNumber } from "./issue";
import { parsePrCommandArgs } from "./pr";

export async function runPrCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const prCommand = parsePrCommandArgs(getCliArgs(), parseIssueNumber);
  const repositoryConfig = getRepositoryConfig(repoRoot);

  if (prCommand.action === "resolve-conflicts") {
    await runPrResolveConflictsCodexLauncher(prCommand.prNumber, repoRoot, repositoryConfig);
    return;
  }

  if (prCommand.action === "address-comments") {
    const result = await runPrFixCommentsCommand({
      mode: "prepare",
      prNumber: prCommand.prNumber,
      repoRoot,
      buildCommand: repositoryConfig.buildCommand,
      ensureVerificationCommandAvailable,
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch: () => {
            throw new Error("prs pr address-comments must not launch Codex.");
          },
        }),
      },
      forge: getRepositoryForge(repoRoot),
      ensureCleanWorkingTree,
      promptForLine,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  if (prCommand.action === "fix-tests") {
    const result = await runPrFixFailingTestsCommand({
      mode: "prepare",
      prNumber: prCommand.prNumber,
      repoRoot,
      buildCommand: repositoryConfig.buildCommand,
      ensureVerificationCommandAvailable,
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch: () => {
            throw new Error("prs pr fix-tests must not launch Codex.");
          },
        }),
      },
      forge: getRepositoryForge(repoRoot),
      ensureCleanWorkingTree,
      captureVerificationFailure,
      promptForLine,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  const result = await runPrFixTestsCommand({
    mode: "prepare",
    prNumber: prCommand.prNumber,
    repoRoot,
    buildCommand: repositoryConfig.buildCommand,
    ensureVerificationCommandAvailable,
    runtime: {
      resolve: () => ({
        displayName: "Codex",
        launch: () => {
          throw new Error("prs pr add-tests must not launch Codex.");
        },
      }),
    },
    forge: getRepositoryForge(repoRoot),
    ensureCleanWorkingTree,
    promptForLine,
    verifyBuild,
    hasChanges,
    commitGeneratedChanges,
  });
  if (result) {
    console.log(JSON.stringify(result, null, 2));
  }
}

async function runPrResolveConflictsCodexLauncher(
  prNumber: number,
  repoRoot: string,
  repositoryConfig: ReturnType<typeof getRepositoryConfig>
): Promise<void> {
  await runPrResolveConflictsCommand({
    prNumber,
    repoRoot,
    buildCommand: repositoryConfig.buildCommand,
    ensureVerificationCommandAvailable,
    preflightBaseBranch: preflightRemoteBranch,
    forge: getRepositoryForge(repoRoot),
    ensureCleanWorkingTree,
    verifyBuild,
  });
}
