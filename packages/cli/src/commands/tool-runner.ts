import { existsSync,mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { dirname,isAbsolute,resolve } from "node:path";
import { cleanupMergedBranchesTool } from "../branch-cleanup-tool";
import { createProvider,getCliArgs,getDefaultRepoRoot,getRepositoryConfig,getRepositoryForge,loadRepoEnv } from "../cli-context";
import {
captureVerificationFailure,
commitGeneratedChanges,
ensureCleanWorkingTree,
hasChanges,
loadMediaEvidenceForPublication,
readIssueWorkflowDiff,
verifyBuild,
} from "../cli-git";
import { promptForLine } from "../cli-prompts";
import { loadCodexSessionModelMetadata } from "../codex-session-metadata";
import {
enrichTokenUsageLedgerRowsWithCodexSessionModel,
getTokenUsageArtifactFilePath,
parseTokenUsageLedgerRowsFromContent
} from "../token-audit";
import {
publishTokenUsageLedger,
TOKEN_USAGE_COMMENT_MARKER
} from "../token-usage-comments";
import {
createIssueEstimateContext,
estimateIssueTool,
publishIssueEstimateFile,
} from "../issue-estimate-tool";
import { listIssuesTool } from "../issue-list-tool";
import { contextIssueTool } from "../issue-context-tool";
import { publishIssueArtifactsTool } from "../issue-publish-artifacts-tool";
import { readyIssueTool } from "../issue-ready-tool";
import { appendMediaEvidenceSection } from "../media-evidence";
import { listPullRequestsTool } from "../pr-list-tool";
import { readyPullRequestTool } from "../pr-ready-tool";
import { parsePrsToolCommandArgs } from "../prs-tool-command";
import { formatRunTimestamp,toRepoRelativePath } from "../run-artifacts";
import { ensureVerificationCommandAvailable,preflightRemoteBranch } from "../workflow-preflights";
import {
createIssueDraftSetWithRecords,
loadIssueDraftSet,
parseIssueDraftDocument,
} from "../workflows/issue/drafts";
import {
createAuditPublicationHints,
publishAutomaticEstimateHints,
publishManagedCommentsFromArtifacts,
} from "../workflows/issue/publication";
import { ensurePrsManagedIssueBody } from "../workflows/issue/refinement";
import { runPrFixCommentsCommand } from "../workflows/pr-fix-comments/run";
import { runPrFixFailingTestsCommand } from "../workflows/pr-fix-failing-tests/run";
import { runPrFixTestsCommand } from "../workflows/pr-fix-tests/run";
import { publishPullRequestLocalReview } from "../workflows/pr-local-review/publish";
import { preparePullRequestLocalReviewTool } from "../workflows/pr-local-review/run";
import { preparePullRequestReviewTool } from "../workflows/pr-prepare-review/run";
import { pushReviewedPullRequestUpdates } from "../workflows/pull-request-reviewed-updates";
import { cleanupWorktreesTool } from "../worktree-cleanup-tool";

async function publishIssueTokenUsageCommentsFromRun(input: {
  repoRoot: string;
  forge: ReturnType<typeof getRepositoryForge>;
  issues: Array<{ number: number }>;
  runDir: string;
}): Promise<
  Array<{
    issueNumber: number;
    marker: typeof TOKEN_USAGE_COMMENT_MARKER;
    status: "published";
    file: string;
    id: number;
    url: string;
  }>
> {
  const artifactPath = getTokenUsageArtifactFilePath(input.runDir);
  if (!existsSync(artifactPath)) {
    return [];
  }

  const rows = enrichTokenUsageLedgerRowsWithCodexSessionModel(
    parseTokenUsageLedgerRowsFromContent(readFileSync(artifactPath, "utf8").trim()),
    loadCodexSessionModelMetadata()
  );
  if (rows.length === 0) {
    throw new Error(
      "Token usage artifacts must be structured JSON supported by prs token audit publisher."
    );
  }

  const publications = [];
  for (const issue of input.issues) {
    const result = await publishTokenUsageLedger(input.forge, {
      target: { type: "issue", number: issue.number },
      rows,
    });
    publications.push({
      issueNumber: issue.number,
      marker: TOKEN_USAGE_COMMENT_MARKER,
      status: "published" as const,
      file: artifactPath,
      id: result.comment.id,
      url: result.comment.url,
    });
  }

  return publications;
}

export async function runToolCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  loadRepoEnv(repoRoot);
  const toolCommand = parsePrsToolCommandArgs(getCliArgs().slice(1));
  const repositoryConfig = getRepositoryConfig(repoRoot);

  if (toolCommand.kind === "token-usage-publish") {
    const artifactPath = isAbsolute(toolCommand.filePath)
      ? toolCommand.filePath
      : resolve(repoRoot, toolCommand.filePath);
    const content = readFileSync(artifactPath, "utf8").trim();
    const rows = enrichTokenUsageLedgerRowsWithCodexSessionModel(
      parseTokenUsageLedgerRowsFromContent(content),
      loadCodexSessionModelMetadata()
    );
    if (rows.length === 0) {
      throw new Error(
        "Token usage artifacts must be structured JSON supported by prs token audit publisher."
      );
    }

    const result = await publishTokenUsageLedger(getRepositoryForge(repoRoot), {
      target: toolCommand.target,
      rows,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: result.status,
          target: toolCommand.target,
          url: result.comment.url,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (toolCommand.kind === "pr-list") {
    const result = await listPullRequestsTool({
      actionable: toolCommand.actionable,
      repoRoot,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-list") {
    const result = await listIssuesTool({
      actionable: toolCommand.actionable,
      repoRoot,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-ready") {
    const result = await readyIssueTool({
      unattended: toolCommand.unattended,
      issueNumber: toolCommand.issueNumber,
      repoRoot,
      forge: getRepositoryForge(repoRoot),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-context") {
    const result = await contextIssueTool({
      issueNumber: toolCommand.issueNumber,
      forge: getRepositoryForge(repoRoot),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-publish-artifacts") {
    const result = await publishIssueArtifactsTool({
      issueNumber: toolCommand.issueNumber,
      repoRoot,
      specFilePath: toolCommand.specFilePath,
      planFilePath: toolCommand.planFilePath,
      forge: getRepositoryForge(repoRoot),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-estimate") {
    const result = await estimateIssueTool({
      issueNumber: toolCommand.issueNumber,
      repoRoot,
      forge: getRepositoryForge(repoRoot),
      repositoryConfig,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-estimate-context") {
    const result = await createIssueEstimateContext({
      issueNumber: toolCommand.issueNumber,
      forge: getRepositoryForge(repoRoot),
      repositoryConfig,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "issue-publish-estimate") {
    const result = await publishIssueEstimateFile({
      issueNumber: toolCommand.issueNumber,
      estimateFilePath: resolve(repoRoot, toolCommand.estimateFilePath),
      forge: getRepositoryForge(repoRoot),
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: result.status,
          ...(result.status === "skipped" ? { reason: result.reason } : { url: result.url }),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (toolCommand.kind === "issue-create") {
    const forge = getRepositoryForge(repoRoot);

    if (forge.type === "none") {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "blocked",
            message:
              "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue creation.",
            nextAction: "configure-forge",
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (!forge.isAuthenticated()) {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "blocked",
            message:
              "GitHub issue creation requires GH_TOKEN or GITHUB_TOKEN in the repository environment, or an authenticated gh session.",
            nextAction: "configure-github-auth",
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (toolCommand.draftFilePath) {
      const draftFilePath = resolve(repoRoot, toolCommand.draftFilePath);
      const runDir = toolCommand.runDir
        ? resolve(repoRoot, toolCommand.runDir)
        : dirname(draftFilePath);
      const mediaEvidence = loadMediaEvidenceForPublication(
        repoRoot,
        toolCommand.mediaManifestFilePath
      );
      const parsedDraft = parseIssueDraftDocument(
        appendMediaEvidenceSection(readFileSync(draftFilePath, "utf8"), mediaEvidence)
      );
      const body = toolCommand.forcePrsManaged
        ? ensurePrsManagedIssueBody(parsedDraft.body)
        : parsedDraft.body;
      const issue = await forge.createOrReuseIssue(
        parsedDraft.title,
        body,
        toolCommand.labels
      );
      const tokenUsageComments = await publishIssueTokenUsageCommentsFromRun({
        repoRoot,
        forge,
        issues: [issue],
        runDir,
      });
      const managedCommentResult = await publishManagedCommentsFromArtifacts({
        repoRoot,
        forge,
        issues: [issue],
        specFilePath: toolCommand.specFilePath,
        planFilePath: toolCommand.planFilePath,
      });
      const estimatePublicationHints = await publishAutomaticEstimateHints({
        repoRoot,
        forge,
        repositoryConfig,
        issues: [issue],
        managedComments: managedCommentResult.managedComments,
      });

      process.stdout.write(
        `${JSON.stringify(
          {
            status: "ok",
            mode: "single",
            issues: [issue],
            createdIssues: [issue],
            auditPublicationHints:
              tokenUsageComments.length > 0
                ? []
                : createAuditPublicationHints({
                    issues: [issue],
                    runDir,
                  }),
            estimatePublicationHints,
            tokenUsageComments,
            ...managedCommentResult,
          },
          null,
          2
        )}\n`
      );
      return;
    }

    if (!toolCommand.issueSetFilePath) {
      throw new Error("Provide exactly one of --draft-file or --issue-set.");
    }

    const issueSetFilePath = resolve(repoRoot, toolCommand.issueSetFilePath);
    const runDir = toolCommand.runDir
      ? resolve(repoRoot, toolCommand.runDir)
      : dirname(issueSetFilePath);
    const issueSet = loadIssueDraftSet({
      repoRoot,
      runDir,
      issueSetFilePath,
    });
    if (toolCommand.mediaManifestFilePath) {
      throw new Error("Media manifests are currently supported for single issue draft creation only.");
    }
    const issues = await createIssueDraftSetWithRecords({
      issueSet,
      forge,
      labels: toolCommand.labels,
      forcePrsManaged: toolCommand.forcePrsManaged,
    });
    const tokenUsageComments = await publishIssueTokenUsageCommentsFromRun({
      repoRoot,
      forge,
      issues,
      runDir,
    });
    const managedCommentResult = await publishManagedCommentsFromArtifacts({
      repoRoot,
      forge,
      issues,
      specFilePath: toolCommand.specFilePath,
      planFilePath: toolCommand.planFilePath,
    });
    const estimatePublicationHints = await publishAutomaticEstimateHints({
      repoRoot,
      forge,
      repositoryConfig,
      issues,
      managedComments: managedCommentResult.managedComments,
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          mode: "multiple",
          issues,
          createdIssues: issues,
          auditPublicationHints:
            tokenUsageComments.length > 0
              ? []
              : createAuditPublicationHints({
                  issues,
                  runDir,
                }),
          estimatePublicationHints,
          tokenUsageComments,
          ...managedCommentResult,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (toolCommand.kind === "branches-cleanup") {
    const result = cleanupMergedBranchesTool({
      repoRoot,
      apply: toolCommand.apply,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "pr-review") {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    let result: Awaited<ReturnType<typeof preparePullRequestLocalReviewTool>>;
    try {
      result = await preparePullRequestLocalReviewTool({
        prNumber: toolCommand.prNumber,
        repoRoot,
        buildCommand: repositoryConfig.buildCommand,
        outputMode: toolCommand.unattended ? "unattended" : "manual",
        ensureVerificationCommandAvailable,
        preflightBaseBranch: preflightRemoteBranch,
        forge: getRepositoryForge(repoRoot),
        ensureCleanWorkingTree,
      });
    } finally {
      console.log = originalConsoleLog;
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "pr-prepare-review") {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    let result: Awaited<ReturnType<typeof preparePullRequestReviewTool>>;
    try {
      result = await preparePullRequestReviewTool({
        prNumber: toolCommand.prNumber,
        repoRoot,
        buildCommand: repositoryConfig.buildCommand,
        ensureVerificationCommandAvailable,
        preflightBaseBranch: preflightRemoteBranch,
        forge: getRepositoryForge(repoRoot),
        ensureCleanWorkingTree,
        promptForLine,
        hasChanges,
        verifyBuild,
        commitGeneratedChanges,
        readDiff: readIssueWorkflowDiff,
        createProvider: async (providerRepoRoot) =>
          createProvider(providerRepoRoot),
      });
    } finally {
      console.log = originalConsoleLog;
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "pr-publish-review") {
    const reportFilePath = isAbsolute(toolCommand.reportFilePath)
      ? toolCommand.reportFilePath
      : resolve(repoRoot, toolCommand.reportFilePath);
    const commentsFilePath = isAbsolute(toolCommand.commentsFilePath)
      ? toolCommand.commentsFilePath
      : resolve(repoRoot, toolCommand.commentsFilePath);
    const result = await publishPullRequestLocalReview({
      repoRoot,
      prNumber: toolCommand.prNumber,
      reportFilePath,
      commentsFilePath,
      forge: getRepositoryForge(repoRoot),
      outputMode: toolCommand.unattended ? "unattended" : "manual",
      reviewStatus: toolCommand.reviewStatus,
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "pr-push-reviewed") {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    try {
      ensureCleanWorkingTree(repoRoot);
      const forge = getRepositoryForge(repoRoot);
      const pullRequest = await forge.fetchPullRequestDetails(toolCommand.prNumber);
      const runDir = resolve(
        repoRoot,
        ".prs",
        "runs",
        `${formatRunTimestamp()}-pr-${pullRequest.number}-push-reviewed`
      );
      mkdirSync(runDir, { recursive: true });
      const outputLogPath = resolve(runDir, "output.log");
      const createdAt = new Date().toISOString();
      writeFileSync(
        outputLogPath,
        [
          "# prs tool pr push-reviewed run log",
          "",
          `Created: ${createdAt}`,
          `Pull request: #${pullRequest.number} ${pullRequest.title}`,
          `Head branch: ${pullRequest.headRefName}`,
          "",
        ].join("\n"),
        "utf8"
      );
      const pushResult = pushReviewedPullRequestUpdates(
        repoRoot,
        outputLogPath,
        pullRequest.headRefName
      );

      process.stdout.write(
        `${JSON.stringify(
          {
            status: pushResult.status,
            prNumber: pullRequest.number,
            headRefName: pullRequest.headRefName,
            remoteRef: pushResult.remoteRef,
            runDir: toRepoRelativePath(repoRoot, runDir),
            outputLogPath: toRepoRelativePath(repoRoot, outputLogPath),
          },
          null,
          2
        )}\n`
      );
    } finally {
      console.log = originalConsoleLog;
    }
    return;
  }

  if (
    toolCommand.kind === "pr-address-comments" ||
    toolCommand.kind === "pr-fix-tests" ||
    toolCommand.kind === "pr-add-tests"
  ) {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    const runtime = {
      resolve: () => ({
        displayName: "Codex",
        launch: () => {
          throw new Error("prs tool pr fix preparation must not launch Codex.");
        },
      }),
    };
    let result:
      | Awaited<ReturnType<typeof runPrFixCommentsCommand>>
      | Awaited<ReturnType<typeof runPrFixFailingTestsCommand>>
      | Awaited<ReturnType<typeof runPrFixTestsCommand>>;
    try {
      if (toolCommand.kind === "pr-address-comments") {
        result = await runPrFixCommentsCommand({
          mode: "prepare",
          selection: toolCommand.selection,
          prNumber: toolCommand.prNumber,
          repoRoot,
          buildCommand: repositoryConfig.buildCommand,
          ensureVerificationCommandAvailable,
          runtime,
          forge: getRepositoryForge(repoRoot),
          ensureCleanWorkingTree,
          promptForLine,
          verifyBuild,
          hasChanges,
          commitGeneratedChanges,
        });
      } else if (toolCommand.kind === "pr-fix-tests") {
        result = await runPrFixFailingTestsCommand({
          mode: "prepare",
          prNumber: toolCommand.prNumber,
          repoRoot,
          buildCommand: repositoryConfig.buildCommand,
          ensureVerificationCommandAvailable,
          runtime,
          forge: getRepositoryForge(repoRoot),
          ensureCleanWorkingTree,
          captureVerificationFailure,
          promptForLine,
          verifyBuild,
          hasChanges,
          commitGeneratedChanges,
        });
      } else {
        result = await runPrFixTestsCommand({
          mode: "prepare",
          selection: toolCommand.selection,
          prNumber: toolCommand.prNumber,
          repoRoot,
          buildCommand: repositoryConfig.buildCommand,
          ensureVerificationCommandAvailable,
          runtime,
          forge: getRepositoryForge(repoRoot),
          ensureCleanWorkingTree,
          promptForLine,
          verifyBuild,
          hasChanges,
          commitGeneratedChanges,
        });
      }
    } finally {
      console.log = originalConsoleLog;
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "pr-ready") {
    const originalConsoleLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map((value) => String(value)).join(" ")}\n`);
    };

    let result: Awaited<ReturnType<typeof readyPullRequestTool>>;
    try {
      result = await readyPullRequestTool({
        unattended: toolCommand.unattended,
        prNumber: toolCommand.prNumber,
        repoRoot,
        buildCommand: repositoryConfig.buildCommand,
        localRuntime: repositoryConfig.localRuntime,
        prReadiness: repositoryConfig.prReadiness,
        ensureVerificationCommandAvailable,
        forge: getRepositoryForge(repoRoot),
        ensureCleanWorkingTree,
      });
    } finally {
      console.log = originalConsoleLog;
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (toolCommand.kind === "worktrees-cleanup") {
    const result = cleanupWorktreesTool({
      repoRoot,
      apply: toolCommand.apply,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error("This prs tool command is not implemented yet.");
}
