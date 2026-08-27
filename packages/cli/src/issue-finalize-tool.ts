import { execFileSync } from "node:child_process";
import type { IssueDetails, RepositoryForge } from "./forge";

type IssueFinalizeForge = Pick<RepositoryForge, "type" | "fetchIssueDetails">;

function git(repoRoot: string, args: string[], errorMessage: string): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(stderr ? `${errorMessage} ${stderr}` : errorMessage);
  }
}

export function buildIssueCommitMessage(issueNumber: number, issue?: IssueDetails): string {
  const body = issue?.title.trim() ? `\n\nIssue: ${issue.title.trim()}` : "";
  return `feat: resolve issue #${issueNumber}${body}`;
}

export async function finalizeIssueChanges(input: {
  repoRoot: string;
  issueNumber: number;
  forge: IssueFinalizeForge;
  confirm(message: string): Promise<boolean>;
}): Promise<{ status: "committed" | "skipped"; commit?: string; message: string }> {
  const status = git(input.repoRoot, ["status", "--porcelain"], "Failed to inspect repository changes.");
  if (!status) {
    return { status: "skipped", message: "No repository changes are available to finalize." };
  }
  const issue = input.forge.type === "none"
    ? undefined
    : await input.forge.fetchIssueDetails(input.issueNumber);
  const message = buildIssueCommitMessage(input.issueNumber, issue);
  if (!(await input.confirm(message))) {
    return { status: "skipped", message: "Commit cancelled; local changes were kept." };
  }
  git(input.repoRoot, ["add", "--all"], "Failed to stage issue changes.");
  git(input.repoRoot, ["commit", "-m", message], "Failed to commit issue changes.");
  const commit = git(input.repoRoot, ["rev-parse", "HEAD"], "Failed to resolve the new commit.");
  return { status: "committed", commit, message };
}
