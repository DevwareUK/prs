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
import { runPrLifecycleCommand } from "../workflows/pr-lifecycle/dispatch";
import { parseIssueNumber } from "./issue";
import { parsePrCommandArgs } from "./pr";

export async function runPrCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const prCommand = parsePrCommandArgs(getCliArgs(), parseIssueNumber);
  const repositoryConfig = getRepositoryConfig(repoRoot);

  await runPrLifecycleCommand({
    prCommand,
      repoRoot,
    repositoryConfig,
      forge: getRepositoryForge(repoRoot),
      ensureVerificationCommandAvailable,
    preflightBaseBranch: preflightRemoteBranch,
      ensureCleanWorkingTree,
      captureVerificationFailure,
      promptForLine,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
  });
}
