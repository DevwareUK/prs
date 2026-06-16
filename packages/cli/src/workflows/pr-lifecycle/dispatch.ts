import type { PrCommandOptions } from "../../commands/pr";
import type { getRepositoryConfig, getRepositoryForge } from "../../cli-context";
import type {
  captureVerificationFailure,
  commitGeneratedChanges,
  ensureCleanWorkingTree,
  hasChanges,
  verifyBuild,
} from "../../cli-git";
import type { promptForLine } from "../../cli-prompts";
import type {
  ensureVerificationCommandAvailable,
  preflightRemoteBranch,
} from "../../workflow-preflights";
import { runPrFixCommentsCommand } from "../pr-fix-comments/run";
import { runPrFixFailingTestsCommand } from "../pr-fix-failing-tests/run";
import { runPrFixTestsCommand } from "../pr-fix-tests/run";
import { runPrResolveConflictsCommand } from "../pr-resolve-conflicts/run";
import { getPrLifecycleActionMetadata } from "./actions";

export type PrLifecycleCommandDependencies = {
  prCommand: PrCommandOptions;
  repoRoot: string;
  repositoryConfig: ReturnType<typeof getRepositoryConfig>;
  forge: ReturnType<typeof getRepositoryForge>;
  ensureVerificationCommandAvailable: typeof ensureVerificationCommandAvailable;
  preflightBaseBranch: typeof preflightRemoteBranch;
  ensureCleanWorkingTree: typeof ensureCleanWorkingTree;
  captureVerificationFailure: typeof captureVerificationFailure;
  promptForLine: typeof promptForLine;
  verifyBuild: typeof verifyBuild;
  hasChanges: typeof hasChanges;
  commitGeneratedChanges: typeof commitGeneratedChanges;
};

export async function runPrLifecycleCommand(
  input: PrLifecycleCommandDependencies
): Promise<void> {
  const action = getPrLifecycleActionMetadata(input.prCommand.action).action;

  if (action === "resolve-conflicts") {
    await runPrResolveConflictsCommand({
      prNumber: input.prCommand.prNumber,
      repoRoot: input.repoRoot,
      buildCommand: input.repositoryConfig.buildCommand,
      ensureVerificationCommandAvailable: input.ensureVerificationCommandAvailable,
      preflightBaseBranch: input.preflightBaseBranch,
      forge: input.forge,
      ensureCleanWorkingTree: input.ensureCleanWorkingTree,
      verifyBuild: input.verifyBuild,
    });
    return;
  }

  const runtime = {
    resolve: () => ({
      displayName: "Codex",
      launch: () => {
        throw new Error(`prs pr ${action} must not launch Codex.`);
      },
    }),
  };

  if (action === "address-comments") {
    const result = await runPrFixCommentsCommand({
      mode: "prepare",
      prNumber: input.prCommand.prNumber,
      repoRoot: input.repoRoot,
      buildCommand: input.repositoryConfig.buildCommand,
      ensureVerificationCommandAvailable: input.ensureVerificationCommandAvailable,
      runtime,
      forge: input.forge,
      ensureCleanWorkingTree: input.ensureCleanWorkingTree,
      promptForLine: input.promptForLine,
      verifyBuild: input.verifyBuild,
      hasChanges: input.hasChanges,
      commitGeneratedChanges: input.commitGeneratedChanges,
    });
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  if (action === "fix-tests") {
    const result = await runPrFixFailingTestsCommand({
      mode: "prepare",
      prNumber: input.prCommand.prNumber,
      repoRoot: input.repoRoot,
      buildCommand: input.repositoryConfig.buildCommand,
      ensureVerificationCommandAvailable: input.ensureVerificationCommandAvailable,
      runtime,
      forge: input.forge,
      ensureCleanWorkingTree: input.ensureCleanWorkingTree,
      captureVerificationFailure: input.captureVerificationFailure,
      promptForLine: input.promptForLine,
      verifyBuild: input.verifyBuild,
      hasChanges: input.hasChanges,
      commitGeneratedChanges: input.commitGeneratedChanges,
    });
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  const result = await runPrFixTestsCommand({
    mode: "prepare",
    prNumber: input.prCommand.prNumber,
    repoRoot: input.repoRoot,
    buildCommand: input.repositoryConfig.buildCommand,
    ensureVerificationCommandAvailable: input.ensureVerificationCommandAvailable,
    runtime,
    forge: input.forge,
    ensureCleanWorkingTree: input.ensureCleanWorkingTree,
    promptForLine: input.promptForLine,
    verifyBuild: input.verifyBuild,
    hasChanges: input.hasChanges,
    commitGeneratedChanges: input.commitGeneratedChanges,
  });
  if (result) {
    console.log(JSON.stringify(result, null, 2));
  }
}
