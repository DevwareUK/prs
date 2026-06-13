import { spawn } from "node:child_process";
import {
appendFileSync,
copyFileSync,
existsSync,
mkdirSync,
readFileSync,
writeFileSync,
} from "node:fs";
import { dirname,isAbsolute,resolve } from "node:path";
import {
getIssueBatchRunDir,
getIssueBatchStateDir,
getIssueBatchStateFilePath,
resolveExistingIssueBatchStateFilePath,
toRepoRelativePath
} from "../../run-artifacts";
import {
parseSetupCommandArgs
} from "../../setup";
import {
preflightIssueBaseBranch
} from "../../workflow-preflights";

export { parseAuditCommandArgs } from "../../commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "../../commands/backlog";
export { parseIssueCommandArgs } from "../../commands/issue";
export { parseReviewCommandArgs } from "../../commands/review";
export { parseSetupCommandArgs };



export function createIssueBatchKey(issueNumbers: number[]): string {
  return `issues-${issueNumbers.join("-")}`;
}

export function createIssueBatchWorkspace(
  repoRoot: string,
  issueNumbers: number[]
): IssueBatchWorkspace {
  const runDir = getIssueBatchRunDir(repoRoot, issueNumbers);
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    summaryFilePath: resolve(runDir, "summary.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
  };
}

export function createInitialIssueBatchState(
  issueNumbers: number[],
  workspace: IssueBatchWorkspace
): IssueBatchState {
  const now = new Date().toISOString();

  return {
    key: createIssueBatchKey(issueNumbers),
    issueNumbers,
    createdAt: now,
    updatedAt: now,
    latestRunDir: workspace.runDir,
    issues: issueNumbers.map((issueNumber) => ({
      issueNumber,
      status: "pending",
      attempts: [],
    })),
  };
}

export function loadIssueBatchState(
  repoRoot: string,
  issueNumbers: number[]
): IssueBatchState | undefined {
  const stateFilePath = resolveExistingIssueBatchStateFilePath(repoRoot, issueNumbers);
  if (!existsSync(stateFilePath)) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as Partial<IssueBatchState>;
  if (
    parsed.key !== createIssueBatchKey(issueNumbers) ||
    !Array.isArray(parsed.issueNumbers) ||
    parsed.issueNumbers.length !== issueNumbers.length ||
    parsed.issueNumbers.some((issueNumber, index) => issueNumber !== issueNumbers[index]) ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    typeof parsed.latestRunDir !== "string" ||
    !Array.isArray(parsed.issues)
  ) {
    throw new Error(
      `Issue batch state at ${toRepoRelativePath(repoRoot, stateFilePath)} is malformed. Remove it and rerun the batch to start fresh.`
    );
  }

  return parsed as IssueBatchState;
}

export function writeIssueBatchState(
  repoRoot: string,
  issueNumbers: number[],
  state: IssueBatchState
): void {
  mkdirSync(getIssueBatchStateDir(repoRoot), { recursive: true });
  writeFileSync(
    getIssueBatchStateFilePath(repoRoot, issueNumbers),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
}

export function appendIssueBatchLog(workspace: IssueBatchWorkspace, message: string): void {
  appendFileSync(workspace.outputLogPath, `${message}\n`, "utf8");
}

export function formatIssueBatchSummary(
  repoRoot: string,
  state: IssueBatchState,
  workspace: IssueBatchWorkspace
): string {
  const lines: string[] = [
    "# Issue Batch Summary",
    "",
    `Batch key: ${state.key}`,
    `Issues: ${state.issueNumbers.join(", ")}`,
    `Created: ${state.createdAt}`,
    `Updated: ${state.updatedAt}`,
    `Batch run directory: ${toRepoRelativePath(repoRoot, workspace.runDir)}`,
  ];

  if (state.stoppedIssueNumber !== undefined) {
    lines.push(`Stopped at issue: #${state.stoppedIssueNumber}`);
  }

  lines.push("", "## Issue status", "");

  for (const issueState of state.issues) {
    const pullRequestSummary =
      issueState.pullRequest?.status === "created" && issueState.pullRequest.url
        ? `PR ${issueState.pullRequest.url}`
        : issueState.pullRequest?.status === "skipped"
          ? `PR skipped (${issueState.pullRequest.reason})`
          : issueState.prUrl
            ? `PR ${issueState.prUrl}`
            : undefined;
    const details = [
      `#${issueState.issueNumber}`,
      issueState.status,
      issueState.branchName ? `branch ${issueState.branchName}` : undefined,
      issueState.runDir ? `run ${issueState.runDir}` : undefined,
      pullRequestSummary,
    ]
      .filter(Boolean)
      .join(" | ");
    lines.push(`- ${details}`);

    if (issueState.error) {
      lines.push(`  Error: ${issueState.error}`);
    }

    if (issueState.attempts.length > 0) {
      const latestAttempt = issueState.attempts.at(-1);
      if (latestAttempt) {
        lines.push(
          `  Latest attempt: ${latestAttempt.status} at ${latestAttempt.updatedAt}`
        );
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function writeIssueBatchArtifacts(
  repoRoot: string,
  state: IssueBatchState,
  workspace: IssueBatchWorkspace
): void {
  writeFileSync(
    workspace.summaryFilePath,
    formatIssueBatchSummary(repoRoot, state, workspace),
    "utf8"
  );
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        key: state.key,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        issueNumbers: state.issueNumbers,
        latestRunDir: toRepoRelativePath(repoRoot, workspace.runDir),
        stoppedIssueNumber: state.stoppedIssueNumber,
        issues: state.issues,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export function updateIssueBatchState(
  repoRoot: string,
  issueNumbers: number[],
  state: IssueBatchState,
  workspace: IssueBatchWorkspace,
  updater: (currentState: IssueBatchState) => IssueBatchState
): IssueBatchState {
  const nextState = {
    ...updater(state),
    updatedAt: new Date().toISOString(),
    latestRunDir: toRepoRelativePath(repoRoot, workspace.runDir),
  };
  writeIssueBatchState(repoRoot, issueNumbers, nextState);
  writeIssueBatchArtifacts(repoRoot, nextState, workspace);
  return nextState;
}

export function createIssueNoChangesOutcome(
  context: IssueRunContext,
  runDir: string
): IssueRunOutcomeSummary {
  return {
    issueNumber: context.issueNumber,
    branchName: context.branchName,
    baseBranch: context.baseBranch,
    runDir,
    committed: false,
    pullRequest: {
      status: "skipped",
      reason: "no-changes",
    },
  };
}

export function getIssueBatchWorktreePath(
  repoRoot: string,
  issueNumbers: number[],
  issueNumber: number
): string {
  return resolve(
    repoRoot,
    ".prs",
    "worktrees",
    createIssueBatchKey(issueNumbers),
    `issue-${issueNumber}`
  );
}

export function copyLocalWorkflowFileToWorktree(
  repoRoot: string,
  worktreePath: string,
  relativePath: string
): void {
  const sourcePath = resolve(repoRoot, relativePath);
  if (!existsSync(sourcePath)) {
    return;
  }

  const targetPath = resolve(worktreePath, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

export function copyLocalWorkflowConfigToWorktree(repoRoot: string, worktreePath: string): void {
  copyLocalWorkflowFileToWorktree(repoRoot, worktreePath, ".prs/config.json");
  copyLocalWorkflowFileToWorktree(repoRoot, worktreePath, ".env");
}

export function ensureIssueBatchWorktree(
  repoRoot: string,
  issueNumbers: number[],
  issueNumber: number,
  baseBranch: string
): string {
  const worktreePath = getIssueBatchWorktreePath(repoRoot, issueNumbers, issueNumber);

  if (existsSync(worktreePath)) {
    const worktreeRoot = runCommand(
      "git",
      ["-C", worktreePath, "rev-parse", "--show-toplevel"],
      `Existing issue worktree at ${worktreePath} is not a usable git worktree.`
    );
    if (resolve(worktreeRoot) !== resolve(worktreePath)) {
      throw new Error(
        `Existing issue worktree path ${worktreePath} resolves to ${worktreeRoot}; remove it or choose a fresh issue batch.`
      );
    }
    copyLocalWorkflowConfigToWorktree(repoRoot, worktreePath);
    return worktreePath;
  }

  mkdirSync(dirname(worktreePath), { recursive: true });
  runInteractiveCommand(
    "git",
    ["worktree", "add", "--detach", worktreePath, `origin/${baseBranch}`],
    `Failed to create worktree for issue #${issueNumber}.`,
    repoRoot
  );
  copyLocalWorkflowConfigToWorktree(repoRoot, worktreePath);
  return worktreePath;
}

export function toBatchRelativePath(repoRoot: string, worktreePath: string, pathValue: string): string {
  const absolutePath = isAbsolute(pathValue) ? pathValue : resolve(worktreePath, pathValue);
  return toRepoRelativePath(repoRoot, absolutePath);
}

export function readIssueBatchSessionDetails(
  repoRoot: string,
  worktreePath: string,
  issueNumber: number
): { branchName?: string; runDir?: string } {
  const sessionState = loadIssueSessionState(worktreePath, issueNumber);
  if (!sessionState) {
    return {};
  }

  return {
    branchName: sessionState.branchName,
    runDir: toBatchRelativePath(repoRoot, worktreePath, sessionState.runDir),
  };
}

export function isIssuePullRequestOutcome(value: unknown): value is IssuePullRequestOutcome {
  if (!value || typeof value !== "object") {
    return false;
  }

  const status = (value as { status?: unknown }).status;
  if (status === "created") {
    return (
      typeof (value as { title?: unknown }).title === "string" &&
      ((value as { url?: unknown }).url === undefined ||
        typeof (value as { url?: unknown }).url === "string")
    );
  }

  if (status === "manual") {
    return (
      typeof (value as { titleFilePath?: unknown }).titleFilePath === "string" &&
      typeof (value as { bodyFilePath?: unknown }).bodyFilePath === "string"
    );
  }

  if (status === "skipped") {
    const reason = (value as { reason?: unknown }).reason;
    return (
      reason === "commit-declined" ||
      reason === "no-changes" ||
      reason === "forge-disabled"
    );
  }

  return false;
}

export function readIssueRunResultFromWorktree(
  repoRoot: string,
  worktreePath: string,
  issueNumber: number
): UnattendedIssueRunResult {
  const sessionState = loadIssueSessionState(worktreePath, issueNumber);
  if (!sessionState) {
    throw new Error(`Issue #${issueNumber} completed without writing session state.`);
  }

  const metadataPath = resolve(worktreePath, sessionState.runDir, "metadata.json");
  if (!existsSync(metadataPath)) {
    throw new Error(`Issue #${issueNumber} completed without writing run metadata.`);
  }

  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
    outcome?: Partial<IssueRunOutcomeSummary>;
  };
  const outcome = metadata.outcome;
  if (
    !outcome ||
    outcome.issueNumber !== issueNumber ||
    typeof outcome.branchName !== "string" ||
    typeof outcome.runDir !== "string" ||
    typeof outcome.committed !== "boolean" ||
    !isIssuePullRequestOutcome(outcome.pullRequest)
  ) {
    throw new Error(`Issue #${issueNumber} completed without a valid recorded outcome.`);
  }

  return {
    branchName: outcome.branchName,
    runDir: toBatchRelativePath(repoRoot, worktreePath, outcome.runDir),
    committed: outcome.committed,
    pullRequest: outcome.pullRequest,
  };
}

export type IssueBatchChildResult = {
  issueNumber: number;
  worktreePath: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export function runIssueBatchChild(
  issueNumber: number,
  worktreePath: string
): Promise<IssueBatchChildResult> {
  const cliEntrypoint = process.argv[1];
  if (!cliEntrypoint) {
    throw new Error("Cannot locate the prs CLI entrypoint for multi-issue execution.");
  }

  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [cliEntrypoint, "issue", String(issueNumber), "--mode", "unattended"],
      {
        cwd: worktreePath,
        env: {
          ...process.env,
          PRS_DISABLE_AUTO_RUN: "0",
          PRS_ISSUE_WORKTREE_BASE_READY: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let spawnError: Error | undefined;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (exitCode, signal) => {
      resolvePromise({
        issueNumber,
        worktreePath,
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        error: spawnError,
      });
    });
  });
}

export function summarizeIssueBatchChildFailure(result: IssueBatchChildResult): string {
  if (result.error) {
    return result.error.message;
  }

  const output = [result.stdout, result.stderr]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = output.at(-1);
  if (lastLine) {
    return lastLine;
  }

  if (result.signal) {
    return `Issue process exited after signal ${result.signal}.`;
  }

  return `Issue process exited with code ${result.exitCode ?? "unknown"}.`;
}

export async function runIssueBatchCommand(issueNumbers: number[]): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const repositoryConfig = getRepositoryConfig(repoRoot);
  requireCodexForUnattendedIssueRuns(repositoryConfig);
  const forge = getRepositoryForge(repoRoot);
  if (!forge.isAuthenticated()) {
    throw new Error(
      "Multi-issue runs require authenticated GitHub access so prs can open pull requests automatically."
    );
  }
  preflightIssueBaseBranch(repoRoot, repositoryConfig.baseBranch);

  const workspace = createIssueBatchWorkspace(repoRoot, issueNumbers);
  let state =
    loadIssueBatchState(repoRoot, issueNumbers) ??
    createInitialIssueBatchState(issueNumbers, workspace);
  state = updateIssueBatchState(repoRoot, issueNumbers, state, workspace, (currentState) => ({
    ...currentState,
    latestRunDir: toRepoRelativePath(repoRoot, workspace.runDir),
  }));

  const issueRuns: Array<{ issueNumber: number; worktreePath: string }> = [];

  for (let index = 0; index < issueNumbers.length; index += 1) {
    const issueNumber = issueNumbers[index];
    const issueState = state.issues.find((entry) => entry.issueNumber === issueNumber);
    if (!issueState) {
      throw new Error(`Missing batch state for issue #${issueNumber}.`);
    }

    if (issueState.status === "completed") {
      const skipMessage = `[${index + 1}/${issueNumbers.length}] Skipping completed issue #${issueNumber}.`;
      console.log(skipMessage);
      appendIssueBatchLog(workspace, skipMessage);
      continue;
    }

    const worktreePath = ensureIssueBatchWorktree(
      repoRoot,
      issueNumbers,
      issueNumber,
      repositoryConfig.baseBranch
    );
    const relativeWorktreePath = toRepoRelativePath(repoRoot, worktreePath);
    const startMessage = `[${index + 1}/${issueNumbers.length}] Starting issue #${issueNumber} in ${relativeWorktreePath}.`;
    console.log(startMessage);
    appendIssueBatchLog(workspace, startMessage);
    const now = new Date().toISOString();
    state = updateIssueBatchState(
      repoRoot,
      issueNumbers,
      state,
      workspace,
      (currentState) => ({
        ...currentState,
        stoppedIssueNumber: undefined,
        issues: currentState.issues.map((entry) =>
          entry.issueNumber !== issueNumber
            ? entry
            : {
                ...entry,
                status: "running",
                worktreePath: relativeWorktreePath,
                error: undefined,
                attempts: [
                  ...entry.attempts,
                  {
                    startedAt: now,
                    updatedAt: now,
                    status: "running",
                    worktreePath: relativeWorktreePath,
                  },
                ],
              }
        ),
      })
    );
    issueRuns.push({ issueNumber, worktreePath });
  }

  const childResults = await Promise.all(
    issueRuns.map((issueRun) =>
      runIssueBatchChild(issueRun.issueNumber, issueRun.worktreePath)
    )
  );
  const failures: string[] = [];

  for (const childResult of childResults) {
    const { issueNumber, worktreePath } = childResult;
    appendIssueBatchLog(
      workspace,
      [
        `# Output for issue #${issueNumber}`,
        childResult.stdout.trim(),
        childResult.stderr.trim(),
        "",
      ]
        .filter((line) => line.length > 0)
        .join("\n")
    );

    if (!childResult.error && childResult.exitCode === 0) {
      try {
        const result = readIssueRunResultFromWorktree(
          repoRoot,
          worktreePath,
          issueNumber
        );
        const resultPrUrl =
          result.pullRequest.status === "created" ? result.pullRequest.url : undefined;
        const successMessage =
          result.pullRequest.status === "created" && result.pullRequest.url
            ? `Completed issue #${issueNumber}: ${result.pullRequest.url}`
            : result.pullRequest.status === "skipped"
              ? `Completed issue #${issueNumber}: skipped (${result.pullRequest.reason})`
              : `Completed issue #${issueNumber}.`;
        console.log(successMessage);
        appendIssueBatchLog(workspace, successMessage);
        state = updateIssueBatchState(
          repoRoot,
          issueNumbers,
          state,
          workspace,
          (currentState) => ({
            ...currentState,
            stoppedIssueNumber: undefined,
            issues: currentState.issues.map((entry) =>
              entry.issueNumber !== issueNumber
                ? entry
                : {
                    ...entry,
                    status: "completed",
                    worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                    branchName: result.branchName,
                    runDir: result.runDir,
                    prUrl: resultPrUrl,
                    pullRequest: result.pullRequest,
                    error: undefined,
                    attempts:
                      entry.attempts.length === 0
                        ? [
                            {
                              startedAt: new Date().toISOString(),
                              updatedAt: new Date().toISOString(),
                              status: "completed",
                              worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                              branchName: result.branchName,
                              runDir: result.runDir,
                              prUrl: resultPrUrl,
                              pullRequest: result.pullRequest,
                            },
                          ]
                        : entry.attempts.map((attempt, attemptIndex) =>
                            attemptIndex === entry.attempts.length - 1
                              ? {
                                  ...attempt,
                                  updatedAt: new Date().toISOString(),
                                  status: "completed",
                                  worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                                  branchName: result.branchName,
                                  runDir: result.runDir,
                                  prUrl: resultPrUrl,
                                  pullRequest: result.pullRequest,
                                  error: undefined,
                                }
                              : attempt
                          ),
                  }
            ),
          })
        );
        continue;
      } catch (error: unknown) {
        childResult.error = error instanceof Error ? error : new Error(String(error));
      }
    }

    const message = summarizeIssueBatchChildFailure(childResult);
    failures.push(`#${issueNumber}: ${message}`);
    const sessionDetails = readIssueBatchSessionDetails(
      repoRoot,
      worktreePath,
      issueNumber
    );
    const failureMessage = `Issue #${issueNumber} failed: ${message}`;
    console.log(failureMessage);
    appendIssueBatchLog(workspace, failureMessage);
    state = updateIssueBatchState(
      repoRoot,
      issueNumbers,
      state,
      workspace,
      (currentState) => ({
        ...currentState,
        stoppedIssueNumber: currentState.stoppedIssueNumber ?? issueNumber,
        issues: currentState.issues.map((entry) =>
          entry.issueNumber !== issueNumber
            ? entry
            : {
                ...entry,
                status: "failed",
                worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                branchName: sessionDetails.branchName ?? entry.branchName,
                runDir: sessionDetails.runDir ?? entry.runDir,
                error: message,
                attempts:
                  entry.attempts.length === 0
                    ? [
                        {
                          startedAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                          status: "failed",
                          worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                          branchName: sessionDetails.branchName,
                          runDir: sessionDetails.runDir,
                          error: message,
                        },
                      ]
                    : entry.attempts.map((attempt, attemptIndex) =>
                        attemptIndex === entry.attempts.length - 1
                          ? {
                              ...attempt,
                              updatedAt: new Date().toISOString(),
                              status: "failed",
                              worktreePath: toRepoRelativePath(repoRoot, worktreePath),
                              branchName: sessionDetails.branchName ?? attempt.branchName,
                              runDir: sessionDetails.runDir ?? attempt.runDir,
                              error: message,
                            }
                          : attempt
                      ),
              }
        ),
      })
    );
  }

  if (failures.length > 0) {
    throw new Error(`One or more issue runs failed: ${failures.join("; ")}`);
  }
}
