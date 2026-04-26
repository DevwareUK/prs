import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  LEGACY_REPOSITORY_STATE_DIRECTORY,
  REPOSITORY_STATE_DIRECTORY,
} from "@prs/contracts";
import type { InteractiveRuntimeType } from "./runtime";

export function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return (relative(repoRoot, filePath) || ".").split("\\").join("/");
}

export function formatRunTimestamp(date = new Date()): string {
  const pad = (value: number, length = 2): string =>
    String(value).padStart(length, "0");

  return [
    `${date.getUTCFullYear()}`,
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3),
    "Z",
  ].join("");
}

export function getIssueStateDir(repoRoot: string, issueNumber: number): string {
  return resolve(repoRoot, REPOSITORY_STATE_DIRECTORY, "issues", String(issueNumber));
}

export function getLegacyIssueStateDir(repoRoot: string, issueNumber: number): string {
  return resolve(repoRoot, LEGACY_REPOSITORY_STATE_DIRECTORY, "issues", String(issueNumber));
}

export function getIssueSessionStateFilePath(
  repoRoot: string,
  issueNumber: number
): string {
  return resolve(getIssueStateDir(repoRoot, issueNumber), "session.json");
}

export function getIssueRefineSessionStateFilePath(
  repoRoot: string,
  issueNumber: number
): string {
  return resolve(getIssueStateDir(repoRoot, issueNumber), "refine-session.json");
}

export function getLegacyIssueSessionStateFilePath(
  repoRoot: string,
  issueNumber: number
): string {
  return resolve(getLegacyIssueStateDir(repoRoot, issueNumber), "session.json");
}

export function resolveExistingIssueSessionStateFilePath(
  repoRoot: string,
  issueNumber: number
): string {
  const canonicalPath = getIssueSessionStateFilePath(repoRoot, issueNumber);
  return existsSync(canonicalPath)
    ? canonicalPath
    : getLegacyIssueSessionStateFilePath(repoRoot, issueNumber);
}

function formatBatchKey(issueNumbers: number[]): string {
  return `issues-${issueNumbers.join("-")}`;
}

export function getIssueBatchStateDir(repoRoot: string): string {
  return resolve(repoRoot, REPOSITORY_STATE_DIRECTORY, "batches");
}

export function getLegacyIssueBatchStateDir(repoRoot: string): string {
  return resolve(repoRoot, LEGACY_REPOSITORY_STATE_DIRECTORY, "batches");
}

export function getIssueBatchStateFilePath(
  repoRoot: string,
  issueNumbers: number[]
): string {
  return resolve(getIssueBatchStateDir(repoRoot), `${formatBatchKey(issueNumbers)}.json`);
}

export function getLegacyIssueBatchStateFilePath(
  repoRoot: string,
  issueNumbers: number[]
): string {
  return resolve(getLegacyIssueBatchStateDir(repoRoot), `${formatBatchKey(issueNumbers)}.json`);
}

export function resolveExistingIssueBatchStateFilePath(
  repoRoot: string,
  issueNumbers: number[]
): string {
  const canonicalPath = getIssueBatchStateFilePath(repoRoot, issueNumbers);
  return existsSync(canonicalPath)
    ? canonicalPath
    : getLegacyIssueBatchStateFilePath(repoRoot, issueNumbers);
}

export function getIssueBatchRunDir(
  repoRoot: string,
  issueNumbers: number[],
  date = new Date()
): string {
  return resolve(
    repoRoot,
    REPOSITORY_STATE_DIRECTORY,
    "runs",
    `${formatRunTimestamp(date)}-${formatBatchKey(issueNumbers)}`
  );
}

export function getIssueRefineRunDir(
  repoRoot: string,
  issueNumber: number,
  date = new Date()
): string {
  return resolve(
    repoRoot,
    REPOSITORY_STATE_DIRECTORY,
    "runs",
    `${formatRunTimestamp(date)}-issue-refine-${issueNumber}`
  );
}

export function getIssuePlanRunDir(
  repoRoot: string,
  issueNumber: number,
  date = new Date()
): string {
  return resolve(
    repoRoot,
    REPOSITORY_STATE_DIRECTORY,
    "runs",
    `${formatRunTimestamp(date)}-issue-plan-${issueNumber}`
  );
}

export type IssuePlanWorkspace = {
  runDir: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
  superpowersSpecFilePath: string;
  superpowersPlanFilePath: string;
};

export type IssueRefineWorkspace = {
  runDir: string;
  draftFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
  superpowersSpecFilePath: string;
  superpowersPlanFilePath: string;
};

export function createIssuePlanWorkspace(
  repoRoot: string,
  issueNumber: number
): IssuePlanWorkspace {
  const runDir = getIssuePlanRunDir(repoRoot, issueNumber);
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    superpowersSpecFilePath: resolve(runDir, "superpowers-spec.md"),
    superpowersPlanFilePath: resolve(runDir, "superpowers-plan.md"),
  };
}

export type IssueRefineSessionState = {
  issueNumber: number;
  runtimeType: InteractiveRuntimeType;
  runDir: string;
  promptFile: string;
  outputLog: string;
  latestDraftFile: string;
  sessionId?: string;
  completedIssueNumber?: number;
  completedIssueUrl?: string;
  completionMode?: "updated-existing" | "created-linked" | "kept-on-disk";
  createdAt: string;
  updatedAt: string;
};

export function createIssueRefineWorkspace(
  repoRoot: string,
  issueNumber: number
): IssueRefineWorkspace {
  const runDir = getIssueRefineRunDir(repoRoot, issueNumber);
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    draftFilePath: resolve(runDir, `issue-refine-${issueNumber}.md`),
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    superpowersSpecFilePath: resolve(runDir, "superpowers-spec.md"),
    superpowersPlanFilePath: resolve(runDir, "superpowers-plan.md"),
  };
}

function buildMalformedIssueRefineSessionStateError(
  repoRoot: string,
  issueNumber: number
): Error {
  const stateFilePath = getIssueRefineSessionStateFilePath(repoRoot, issueNumber);
  return new Error(
    `Issue refine session state at ${toRepoRelativePath(
      repoRoot,
      stateFilePath
    )} is malformed. Remove it and rerun \`prs issue refine ${issueNumber}\` to start a fresh session.`
  );
}

function hasCompletedIssueMetadata(
  state: Partial<IssueRefineSessionState>
): boolean {
  return (
    state.completedIssueNumber !== undefined || state.completedIssueUrl !== undefined
  );
}

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRequiredString(value: unknown): string | undefined {
  return isNonEmptyTrimmedString(value) ? value.trim() : undefined;
}

function normalizeIsoUtcTimestamp(value: unknown): string | undefined {
  if (!isNonEmptyTrimmedString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(trimmed)) {
    return undefined;
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return new Date(timestamp).toISOString() === trimmed ? trimmed : undefined;
}

function getGitHubRepositorySlug(repoRoot: string): string | undefined {
  const gitEntryPath = resolve(repoRoot, ".git");
  if (!existsSync(gitEntryPath)) {
    return undefined;
  }

  let gitConfigPath = resolve(gitEntryPath, "config");
  try {
    const gitEntryContents = readFileSync(gitEntryPath, "utf8").trim();
    const gitDirMatch = gitEntryContents.match(/^gitdir:\s*(.+)$/i);
    if (gitDirMatch?.[1]) {
      const gitDirPath = resolve(repoRoot, gitDirMatch[1].trim());
      const commonDirPath = resolve(
        gitDirPath,
        readFileSync(resolve(gitDirPath, "commondir"), "utf8").trim()
      );

      gitConfigPath = existsSync(resolve(commonDirPath, "config"))
        ? resolve(commonDirPath, "config")
        : resolve(gitDirPath, "config");
    }
  } catch {
    // `.git` is usually a directory; fall back to `.git/config`.
  }

  if (!existsSync(gitConfigPath)) {
    return undefined;
  }

  const gitConfig = readFileSync(gitConfigPath, "utf8");
  const remoteSectionMatch = gitConfig.match(
    /\[remote\s+"origin"\][\s\S]*?url\s*=\s*(.+?)(?:\r?\n|$)/
  );
  const remoteUrl = remoteSectionMatch?.[1]?.trim();
  if (!remoteUrl) {
    return undefined;
  }

  const parsed = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return parsed?.[1];
}

function isIssueRefineRunDir(repoRoot: string, issueNumber: number, runDir: string): boolean {
  const repoRelativeRunDir = toRepoRelativePath(repoRoot, runDir);
  return new RegExp(
    `^\\.prs/runs/\\d{8}T\\d{9}Z-issue-refine-${issueNumber}$`
  ).test(repoRelativeRunDir);
}

function parseCompletedIssueUrl(
  value: unknown,
  expectedRepositorySlug?: string
): { normalizedUrl: string; issueNumber: number } | undefined {
  if (!isNonEmptyTrimmedString(value)) {
    return undefined;
  }

  const trimmed = value.trim();
  const canonicalMatch = trimmed.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/
  );
  if (!canonicalMatch) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    const repositorySlug = `${canonicalMatch[1]}/${canonicalMatch[2]}`;
    const issueNumber = Number.parseInt(canonicalMatch[3] ?? "", 10);
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
      return undefined;
    }

    if (
      expectedRepositorySlug !== undefined &&
      repositorySlug !== expectedRepositorySlug
    ) {
      return undefined;
    }

    return {
      normalizedUrl: parsed.toString(),
      issueNumber,
    };
  } catch {
    return undefined;
  }
}

function hasConsistentCompletionMetadata(
  state: Partial<IssueRefineSessionState> & {
    issueNumber?: number;
    repositorySlug?: string;
  }
): boolean {
  if (state.completionMode === undefined) {
    return !hasCompletedIssueMetadata(state);
  }

  if (state.completionMode === "kept-on-disk") {
    return !hasCompletedIssueMetadata(state);
  }

  const parsedUrl = parseCompletedIssueUrl(
    state.completedIssueUrl,
    state.repositorySlug
  );
  const hasMatchedCompletedIssue =
    Number.isSafeInteger(state.completedIssueNumber) &&
    (state.completedIssueNumber as number) > 0 &&
    parsedUrl !== undefined &&
    parsedUrl.issueNumber === state.completedIssueNumber;

  if (!hasMatchedCompletedIssue) {
    return false;
  }

  if (state.completionMode === "updated-existing") {
    return state.completedIssueNumber === state.issueNumber;
  }

  if (state.completionMode === "created-linked") {
    return state.completedIssueNumber !== state.issueNumber;
  }

  return true;
}

function normalizeIssueRefineSessionState(
  repoRoot: string,
  issueNumber: number,
  parsed: Partial<IssueRefineSessionState>
): IssueRefineSessionState {
  if (typeof parsed !== "object" || parsed === null) {
    throw buildMalformedIssueRefineSessionStateError(repoRoot, issueNumber);
  }

  const repositorySlug = getGitHubRepositorySlug(repoRoot);
  const normalizedRunDir = normalizeRequiredString(parsed.runDir);
  const normalizedPromptFile = normalizeRequiredString(parsed.promptFile);
  const normalizedOutputLog = normalizeRequiredString(parsed.outputLog);
  const normalizedLatestDraftFile = normalizeRequiredString(parsed.latestDraftFile);
  const normalizedSessionId =
    parsed.sessionId === undefined ? undefined : normalizeRequiredString(parsed.sessionId);
  const normalizedCreatedAt = normalizeIsoUtcTimestamp(parsed.createdAt);
  const normalizedUpdatedAt = normalizeIsoUtcTimestamp(parsed.updatedAt);
  const parsedCompletedIssueUrl =
    parsed.completedIssueUrl === undefined
      ? undefined
      : parseCompletedIssueUrl(parsed.completedIssueUrl, repositorySlug);
  const normalizedCompletedIssueUrl = parsedCompletedIssueUrl?.normalizedUrl;

  const hasCoherentWorkspacePaths =
    normalizedRunDir !== undefined &&
    isIssueRefineRunDir(repoRoot, issueNumber, normalizedRunDir) &&
    normalizedPromptFile === resolve(normalizedRunDir, "prompt.md") &&
    normalizedOutputLog === resolve(normalizedRunDir, "output.log") &&
    normalizedLatestDraftFile === resolve(
      normalizedRunDir,
      `issue-refine-${issueNumber}.md`
    );

  if (
    parsed.issueNumber !== issueNumber ||
    (parsed.runtimeType !== "codex" && parsed.runtimeType !== "claude-code") ||
    normalizedRunDir === undefined ||
    normalizedPromptFile === undefined ||
    normalizedOutputLog === undefined ||
    normalizedLatestDraftFile === undefined ||
    (parsed.sessionId !== undefined && normalizedSessionId === undefined) ||
    (parsed.completedIssueNumber !== undefined &&
      (!Number.isSafeInteger(parsed.completedIssueNumber) ||
        parsed.completedIssueNumber <= 0)) ||
    (parsed.completedIssueUrl !== undefined && normalizedCompletedIssueUrl === undefined) ||
    (parsed.completedIssueNumber !== undefined &&
      parsedCompletedIssueUrl !== undefined &&
      parsed.completedIssueNumber !== parsedCompletedIssueUrl.issueNumber) ||
    (parsed.completionMode !== undefined &&
      parsed.completionMode !== "updated-existing" &&
      parsed.completionMode !== "created-linked" &&
      parsed.completionMode !== "kept-on-disk") ||
    !hasConsistentCompletionMetadata({
      issueNumber,
      repositorySlug,
      ...parsed,
      runDir: normalizedRunDir,
      promptFile: normalizedPromptFile,
      outputLog: normalizedOutputLog,
      latestDraftFile: normalizedLatestDraftFile,
      ...(normalizedSessionId === undefined ? {} : { sessionId: normalizedSessionId }),
      completedIssueUrl: normalizedCompletedIssueUrl,
    }) ||
    !hasCoherentWorkspacePaths ||
    normalizedCreatedAt === undefined ||
    normalizedUpdatedAt === undefined
  ) {
    throw buildMalformedIssueRefineSessionStateError(repoRoot, issueNumber);
  }

  return {
    ...parsed,
    runDir: normalizedRunDir,
    promptFile: normalizedPromptFile,
    outputLog: normalizedOutputLog,
    latestDraftFile: normalizedLatestDraftFile,
    ...(normalizedSessionId === undefined ? {} : { sessionId: normalizedSessionId }),
    createdAt: normalizedCreatedAt,
    updatedAt: normalizedUpdatedAt,
    ...(normalizedCompletedIssueUrl === undefined
      ? {}
      : { completedIssueUrl: normalizedCompletedIssueUrl }),
  } as IssueRefineSessionState;
}

export function loadIssueRefineSessionState(
  repoRoot: string,
  issueNumber: number
): IssueRefineSessionState | undefined {
  const stateFilePath = getIssueRefineSessionStateFilePath(repoRoot, issueNumber);
  if (!existsSync(stateFilePath)) {
    return undefined;
  }

  let parsed: Partial<IssueRefineSessionState>;
  try {
    parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as Partial<IssueRefineSessionState>;
  } catch {
    throw buildMalformedIssueRefineSessionStateError(repoRoot, issueNumber);
  }

  return normalizeIssueRefineSessionState(repoRoot, issueNumber, parsed);
}

export function writeIssueRefineSessionState(
  repoRoot: string,
  state: IssueRefineSessionState
): void {
  const normalizedState = normalizeIssueRefineSessionState(
    repoRoot,
    state.issueNumber,
    state
  );
  const stateDir = getIssueStateDir(repoRoot, state.issueNumber);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    getIssueRefineSessionStateFilePath(repoRoot, state.issueNumber),
    `${JSON.stringify(normalizedState, null, 2)}\n`,
    "utf8"
  );
}
