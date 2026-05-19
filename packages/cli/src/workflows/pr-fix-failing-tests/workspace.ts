import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatCommandForDisplay } from "../../config";
import { buildDoneStateInstructions } from "../../done-state";
import type { PullRequestDetails } from "../../forge";
import { formatRunTimestamp, toRepoRelativePath } from "../../run-artifacts";
import { formatPullRequestFailingTestsSnapshot } from "./snapshot";
import type {
  PullRequestFixFailingTestsWorkspace,
  PullRequestLinkedIssueContext,
  VerificationFailure,
} from "./types";

export function createPullRequestFixFailingTestsWorkspace(
  repoRoot: string,
  prNumber: number
): PullRequestFixFailingTestsWorkspace {
  const runDir = resolve(
    repoRoot,
    ".prs",
    "runs",
    `${formatRunTimestamp()}-pr-${prNumber}-fix-failing-tests`
  );

  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    snapshotFilePath: resolve(runDir, "failing-tests.md"),
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
  };
}

function buildPullRequestFixFailingTestsRuntimePrompt(
  repoRoot: string,
  workspace: PullRequestFixFailingTestsWorkspace,
  prNumber: number,
  buildCommand: string[]
): string {
  const snapshotFile = toRepoRelativePath(repoRoot, workspace.snapshotFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);
  const doneStateInstructions = buildDoneStateInstructions({
    mode: "interactive",
    readyLabel: "Ready to commit",
  });

  return [
    "You are working in the current repository.",
    "",
    `Read the pull request failing tests snapshot at \`${snapshotFile}\` before making changes.`,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to the coding agent:",
    "- analyze the repository only as needed for the captured failing tests",
    "- keep code changes focused on fixing the captured failing tests",
    "- follow existing architecture and test patterns",
    "- avoid changing unrelated pull request behavior",
    `- run \`${formatCommandForDisplay(buildCommand)}\` before finishing if code changes are made`,
    `- after verification passes and reviewed changes are committed, run \`prs tool pr push-reviewed ${prNumber} --json\` to push the PR branch through the guarded ahead/behind check`,
    "- if that guarded push reports a divergence or failure, keep the local commit and report the failure clearly",
    "- do not modify `.prs/` unless needed for local workflow artifacts",
    "- do not commit `.prs/` files",
    "",
    ...doneStateInstructions,
  ].join("\n");
}

function formatInitialOutputLog(
  repoRoot: string,
  workspace: PullRequestFixFailingTestsWorkspace,
  initialFailure: VerificationFailure,
  createdAt: string
): string {
  return [
    "# prs pr fix-failing-tests run log",
    "",
    `Created: ${createdAt}`,
    `Snapshot file: ${toRepoRelativePath(repoRoot, workspace.snapshotFilePath)}`,
    `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
    "",
    `$ ${formatCommandForDisplay(initialFailure.command)}`,
    initialFailure.stdout,
    initialFailure.stderr,
    "",
  ].join("\n");
}

export function writePullRequestFixFailingTestsWorkspaceFiles(
  repoRoot: string,
  pullRequest: PullRequestDetails,
  initialFailure: VerificationFailure,
  workspace: PullRequestFixFailingTestsWorkspace,
  buildCommand: string[],
  linkedIssues: PullRequestLinkedIssueContext[]
): void {
  const createdAt = new Date().toISOString();
  const prompt = buildPullRequestFixFailingTestsRuntimePrompt(
    repoRoot,
    workspace,
    pullRequest.number,
    buildCommand
  );

  writeFileSync(
    workspace.snapshotFilePath,
    formatPullRequestFailingTestsSnapshot(
      pullRequest,
      initialFailure,
      buildCommand,
      linkedIssues
    ),
    "utf8"
  );
  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        prNumber: pullRequest.number,
        prTitle: pullRequest.title,
        prUrl: pullRequest.url,
        baseRefName: pullRequest.baseRefName,
        headRefName: pullRequest.headRefName,
        snapshotFile: toRepoRelativePath(repoRoot, workspace.snapshotFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        linkedIssues: linkedIssues.map((issue) => ({
          number: issue.number,
          title: issue.title,
          url: issue.url,
        })),
        verificationCommand: buildCommand,
        initialVerification: {
          status: initialFailure.status,
          error: initialFailure.error ?? null,
          stdout: initialFailure.stdout,
          stderr: initialFailure.stderr,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.outputLogPath,
    formatInitialOutputLog(repoRoot, workspace, initialFailure, createdAt),
    "utf8"
  );
}
