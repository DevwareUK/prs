import { resolve } from "node:path";
import {
parseIssueCommandArgs
} from "../../commands/issue";
import {
estimateIssueTool,
publishIssueEstimateAudit,
renderIssueEstimate
} from "../../issue-estimate-tool";
import {
toRepoRelativePath
} from "../../run-artifacts";
import {
getInteractiveRuntimeByType,
selectInteractiveRuntime
} from "../../runtime";
import {
parseSetupCommandArgs
} from "../../setup";

export { parseAuditCommandArgs } from "../../commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "../../commands/backlog";
export { parseIssueCommandArgs } from "../../commands/issue";
export { parseReviewCommandArgs } from "../../commands/review";
export { parseSetupCommandArgs };

import { runIssueDraftCommand } from "./drafts";

import { runIssueRefineCommand } from "./refinement";

import {
emitIssuePrepareOutputs,
finalizeIssueRun,
prepareIssueRun,
printIssueRunOutcomeSummary,
printManualPrInstructions,
runIssuePlanCommand,
runUnattendedIssueCommand,
} from "./session";

import {
getCliArgs,
getDefaultRepoRoot,
getRepositoryConfig,
getRepositoryForge,
} from "../../cli-context";
import { runIssueBatchCommand } from "./batch";

export async function runIssueCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const args = getCliArgs();
  const issueCommand = parseIssueCommandArgs(args);

  if (issueCommand.action === "draft") {
    await runIssueDraftCommand(issueCommand);
    return;
  }

  if (issueCommand.action === "plan") {
    await runIssuePlanCommand(issueCommand.issueNumber, {
      refresh: issueCommand.refresh,
    });
    return;
  }

  if (issueCommand.action === "estimate") {
    const repositoryConfig = getRepositoryConfig(repoRoot);
    const forge = getRepositoryForge(repoRoot);
    const result = await estimateIssueTool({
      issueNumber: issueCommand.issueNumber,
      repoRoot,
      forge,
      repositoryConfig,
    });
    const publication = await publishIssueEstimateAudit(forge, result);
    const auditMessage =
      publication.status === "skipped"
        ? `Audit comment skipped: ${publication.reason}`
        : `Audit comment ${publication.status}: ${publication.url}`;
    process.stdout.write(`${renderIssueEstimate(result)}\n\n${auditMessage}\n`);
    return;
  }

  if (issueCommand.action === "refine") {
    await runIssueRefineCommand(issueCommand.issueNumber);
    return;
  }

  if (issueCommand.action === "batch") {
    await runIssueBatchCommand(issueCommand.issueNumbers);
    return;
  }

  if (issueCommand.action === "prepare") {
    const context = await prepareIssueRun(
      issueCommand.issueNumber,
      issueCommand.mode
    );
    emitIssuePrepareOutputs(repoRoot, context);
    process.stdout.write(
      `${JSON.stringify(
        {
          issueNumber: context.issueNumber,
          issueTitle: context.issue.title,
          issueUrl: context.issue.url,
          branchName: context.branchName,
          runtimeType: context.runtime.type,
          issueFile: toRepoRelativePath(repoRoot, context.workspace.issueFilePath),
          promptFile: toRepoRelativePath(repoRoot, context.workspace.promptFilePath),
          metadataFile: toRepoRelativePath(repoRoot, context.workspace.metadataFilePath),
          outputLog: toRepoRelativePath(repoRoot, context.workspace.outputLogPath),
          runDir: toRepoRelativePath(repoRoot, context.workspace.runDir),
          mode: context.mode,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (issueCommand.action === "finalize") {
    await finalizeIssueRun(repoRoot, issueCommand.issueNumber);
    return;
  }

  if (issueCommand.mode === "unattended") {
    await runUnattendedIssueCommand(issueCommand.issueNumber);
    return;
  }

  const repositoryConfig = getRepositoryConfig(repoRoot);
  const selectedRuntime = selectInteractiveRuntime(repositoryConfig.ai.runtime, {
    onFallback: (message) => {
      console.log(message);
    },
  });
  const context = await prepareIssueRun(issueCommand.issueNumber, "local", {
    allowResume: true,
    runtimeType: selectedRuntime.type,
  });
  const forge = getRepositoryForge(repoRoot);
  const runtime = getInteractiveRuntimeByType(selectedRuntime.type);
  const relativeRunDir = toRepoRelativePath(repoRoot, context.workspace.runDir);

  console.log(`Prepared issue branch ${context.branchName}.`);
  console.log(`Issue run artifacts: ${relativeRunDir}`);
  console.log(
    context.runtime.invocation === "resume"
      ? `Resuming the saved interactive ${runtime.displayName} session in this terminal...`
      : `Opening an interactive ${runtime.displayName} session in this terminal...`
  );
  console.log(`Complete the issue work in ${runtime.displayName}.`);
  console.log(
    `When ${runtime.displayName} exits, prs will resume with build and commit steps.`
  );
  const runtimeLaunch = runtime.launch(repoRoot, context.workspace, {
    resumeSessionId: context.runtime.sessionId,
  });
  console.log(`${runtime.displayName} exited; handing control back to prs.`);
  persistIssueSessionState(repoRoot, context, runtimeLaunch.sessionId);
  updateIssueWorkspaceMetadata(context.workspace, (currentMetadata) => ({
    ...currentMetadata,
    runtime: {
      ...((currentMetadata.runtime as Record<string, unknown> | undefined) ?? {}),
      type: runtime.type,
      displayName: runtime.displayName,
      command: runtime.metadata.command,
      invocation: runtimeLaunch.invocation,
      sessionId: runtimeLaunch.sessionId,
      sandboxMode: runtime.metadata.sandboxMode,
      approvalPolicy: runtime.metadata.approvalPolicy,
    },
  }));

  console.log("Verifying build...");
  verifyBuild(repoRoot, repositoryConfig.buildCommand, context.workspace.outputLogPath);

  let finalized: FinalizeIssueRunResult;
  try {
    finalized = await finalizeIssueRun(
      repoRoot,
      context.issueNumber,
      context.issue,
      context.workspace.runDir
    );
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.message !== ISSUE_RUN_NO_CHANGES_MESSAGE) {
      throw error;
    }

    const outcome: IssueRunOutcomeSummary = {
      issueNumber: context.issueNumber,
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      runDir: relativeRunDir,
      committed: false,
      pullRequest: {
        status: "skipped",
        reason: "no-changes",
      },
    };
    recordIssueRunOutcome(context.workspace, outcome);
    console.log(ISSUE_RUN_NO_CHANGES_MESSAGE);
    printIssueRunOutcomeSummary(outcome);
    return;
  }
  if (!finalized.committed) {
    const outcome: IssueRunOutcomeSummary = {
      issueNumber: context.issueNumber,
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      runDir: relativeRunDir,
      committed: false,
      pullRequest: {
        status: "skipped",
        reason: "commit-declined",
      },
    };
    recordIssueRunOutcome(context.workspace, outcome);
    console.log("Skipping pull request creation because no commit was created.");
    printIssueRunOutcomeSummary(outcome);
    return;
  }

  const pullRequest = await generateIssuePullRequest({
    repoRoot,
    issueNumber: context.issueNumber,
    issue: context.issue,
    diff: finalized.diff,
    commitMessage: finalized.commitMessage,
    overlapDecision: context.overlapDecision,
    runDir: context.workspace.runDir,
  });

  if (forge.isAuthenticated()) {
    console.log("Pushing branch and opening a pull request...");
    const createdPullRequest = await forge.createPullRequest({
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      title: pullRequest.title,
      body: pullRequest.body,
      bodyFilePath: pullRequest.bodyFilePath,
      outputLogPath: context.workspace.outputLogPath,
    });
    updateIssueWorkspaceMetadata(context.workspace, (currentMetadata) => ({
      ...currentMetadata,
      pullRequest: {
        title: pullRequest.title,
        url: createdPullRequest.url,
      },
    }));
    const outcome: IssueRunOutcomeSummary = {
      issueNumber: context.issueNumber,
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      runDir: relativeRunDir,
      committed: true,
      pullRequest: {
        status: "created",
        title: pullRequest.title,
        url: createdPullRequest.url,
      },
    };
    recordIssueRunOutcome(context.workspace, outcome);
    printIssueRunOutcomeSummary(outcome);
    return;
  }

  if (forge.type === "github") {
    const titleFilePath =
      pullRequest.titleFilePath ?? resolve(context.workspace.runDir, "pull-request-title.txt");
    const bodyFilePath =
      pullRequest.bodyFilePath ?? resolve(context.workspace.runDir, "pull-request-body.md");
    printManualPrInstructions(
      repoRoot,
      context.branchName,
      context.baseBranch,
      titleFilePath,
      bodyFilePath
    );
    const outcome: IssueRunOutcomeSummary = {
      issueNumber: context.issueNumber,
      branchName: context.branchName,
      baseBranch: context.baseBranch,
      runDir: relativeRunDir,
      committed: true,
      pullRequest: {
        status: "manual",
        titleFilePath: toRepoRelativePath(repoRoot, titleFilePath),
        bodyFilePath: toRepoRelativePath(repoRoot, bodyFilePath),
      },
    };
    recordIssueRunOutcome(context.workspace, outcome);
    printIssueRunOutcomeSummary(outcome);
    return;
  }

  const outcome: IssueRunOutcomeSummary = {
    issueNumber: context.issueNumber,
    branchName: context.branchName,
    baseBranch: context.baseBranch,
    runDir: relativeRunDir,
    committed: true,
    pullRequest: {
      status: "skipped",
      reason: "forge-disabled",
    },
  };
  recordIssueRunOutcome(context.workspace, outcome);
  printIssueRunOutcomeSummary(outcome);
  console.log(
    "Pull request creation skipped because repository forge support is disabled by .prs/config.json."
  );
}
