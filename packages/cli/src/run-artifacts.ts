import { relative, resolve } from "node:path";

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
  return resolve(repoRoot, ".git-ai", "issues", String(issueNumber));
}

export function getIssueSessionStateFilePath(
  repoRoot: string,
  issueNumber: number
): string {
  return resolve(getIssueStateDir(repoRoot, issueNumber), "session.json");
}

function formatBatchKey(issueNumbers: number[]): string {
  return `issues-${issueNumbers.join("-")}`;
}

export function getIssueBatchStateDir(repoRoot: string): string {
  return resolve(repoRoot, ".git-ai", "batches");
}

export function getIssueBatchStateFilePath(
  repoRoot: string,
  issueNumbers: number[]
): string {
  return resolve(getIssueBatchStateDir(repoRoot), `${formatBatchKey(issueNumbers)}.json`);
}

export function getIssueBatchRunDir(
  repoRoot: string,
  issueNumbers: number[],
  date = new Date()
): string {
  return resolve(
    repoRoot,
    ".git-ai",
    "runs",
    `${formatRunTimestamp(date)}-${formatBatchKey(issueNumbers)}`
  );
}
