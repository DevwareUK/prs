import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  LEGACY_REPOSITORY_STATE_DIRECTORY,
  REPOSITORY_STATE_DIRECTORY,
} from "@prs/contracts";

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
