import { execFileSync } from "node:child_process";
import type { IssueDetails, RepositoryForge } from "./forge";

type IssueFinalizeForge = Pick<RepositoryForge, "type" | "fetchIssueDetails">;

export type IssueFinalizeStagedChange = {
  status: string;
  paths: string[];
};

export type IssueFinalizePreview = {
  commitMessage: string;
  stagedChanges: IssueFinalizeStagedChange[];
};

function gitRaw(repoRoot: string, args: string[], errorMessage: string): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(stderr ? `${errorMessage} ${stderr}` : errorMessage);
  }
}

function git(repoRoot: string, args: string[], errorMessage: string): string {
  return gitRaw(repoRoot, args, errorMessage).trim();
}

function readStagedChanges(repoRoot: string): IssueFinalizeStagedChange[] {
  const output = gitRaw(
    repoRoot,
    ["diff", "--cached", "--name-status", "-z", "--find-renames", "--"],
    "Failed to inspect staged changes."
  );
  if (!output) return [];
  const fields = output.endsWith("\0")
    ? output.slice(0, -1).split("\0")
    : output.split("\0");
  const changes: IssueFinalizeStagedChange[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const pathCount = /^[RC]/.test(status) ? 2 : 1;
    const paths = fields.slice(index, index + pathCount);
    if (!status || paths.length !== pathCount || paths.some((path) => !path)) {
      throw new Error(
        "Failed to inspect staged changes. Git returned an incomplete staged-path record."
      );
    }
    changes.push({ status, paths });
    index += pathCount;
  }
  return changes;
}

export function buildIssueCommitMessage(issueNumber: number, issue?: IssueDetails): string {
  const body = issue?.title.trim() ? `\n\nIssue: ${issue.title.trim()}` : "";
  return `feat: resolve issue #${issueNumber}${body}`;
}

export function formatIssueFinalizePreview(preview: IssueFinalizePreview): string {
  const lines = preview.stagedChanges.map(({ status, paths }) =>
    "  " + status + " " + paths.map((path) => JSON.stringify(path)).join(" -> ")
  );
  return [
    "Proposed commit message:", "", preview.commitMessage, "",
    "Staged paths:", ...lines,
  ].join("\n");
}

export async function finalizeIssueChanges(input: {
  repoRoot: string;
  issueNumber: number;
  forge: IssueFinalizeForge;
  confirm(preview: IssueFinalizePreview): Promise<boolean>;
}): Promise<{ status: "committed" | "skipped"; commit?: string; message: string }> {
  const stagedChanges = readStagedChanges(input.repoRoot);
  if (stagedChanges.length === 0) {
    return {
      status: "skipped",
      message: "No staged changes are available to finalize. Stage the intended issue changes and retry.",
    };
  }
  const issue = input.forge.type === "none"
    ? undefined
    : await input.forge.fetchIssueDetails(input.issueNumber);
  const message = buildIssueCommitMessage(input.issueNumber, issue);
  if (!(await input.confirm({ commitMessage: message, stagedChanges }))) {
    return {
      status: "skipped",
      message: "Commit cancelled; staged and working-tree changes were kept.",
    };
  }
  git(input.repoRoot, ["commit", "-m", message], "Failed to commit issue changes.");
  const commit = git(input.repoRoot, ["rev-parse", "HEAD"], "Failed to resolve the new commit.");
  return { status: "committed", commit, message };
}
