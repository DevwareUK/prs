import { execFileSync } from "node:child_process";
import { loadResolvedRepositoryConfig } from "./config";

export type BranchCleanupCandidate = {
  name: string;
};

export type BranchCleanupSkipped = {
  name: string;
  reason: "protected" | "current" | "checked-out-in-worktree" | "not-merged";
  worktreePath?: string;
};

export type BranchCleanupFailure = {
  name: string;
  message: string;
};

export type BranchCleanupResult =
  | {
      status: "ok";
      apply: boolean;
      baseBranch: string;
      candidates: BranchCleanupCandidate[];
      skipped: BranchCleanupSkipped[];
      deleted: BranchCleanupCandidate[];
      failures: BranchCleanupFailure[];
    }
  | {
      status: "blocked";
      apply: boolean;
      message: string;
      nextAction: "run-in-git-repository" | "check-base-branch";
    };

export function cleanupMergedBranchesTool(input: {
  repoRoot: string;
  apply: boolean;
}): BranchCleanupResult {
  const git = createGitRunner(input.repoRoot);
  const repositoryConfig = loadResolvedRepositoryConfig(input.repoRoot);
  const baseBranch = repositoryConfig.baseBranch;

  try {
    git(["rev-parse", "--show-toplevel"]);
  } catch {
    return {
      status: "blocked",
      apply: input.apply,
      message: "Local branch cleanup requires a Git repository.",
      nextAction: "run-in-git-repository",
    };
  }

  let localBranches: string[];
  let mergedBranches: Set<string>;
  try {
    localBranches = splitLines(git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]));
    mergedBranches = new Set(
      splitLines(git(["branch", "--format=%(refname:short)", "--merged", baseBranch]))
    );
  } catch (error: unknown) {
    return {
      status: "blocked",
      apply: input.apply,
      message: `Unable to inspect local branches merged into "${baseBranch}": ${formatError(error)}`,
      nextAction: "check-base-branch",
    };
  }

  const currentBranch = splitLines(git(["branch", "--show-current"]))[0];
  const worktreeBranches = parseWorktreeBranches(git(["worktree", "list", "--porcelain"]));
  const protectedBranches = new Set([baseBranch, "main", "master", "develop"]);
  const candidates: BranchCleanupCandidate[] = [];
  const skipped: BranchCleanupSkipped[] = [];

  for (const branch of localBranches) {
    if (protectedBranches.has(branch)) {
      skipped.push({ name: branch, reason: "protected" });
      continue;
    }

    if (branch === currentBranch) {
      skipped.push({ name: branch, reason: "current" });
      continue;
    }

    const worktreePath = worktreeBranches.get(branch);
    if (worktreePath) {
      skipped.push({ name: branch, reason: "checked-out-in-worktree", worktreePath });
      continue;
    }

    if (!mergedBranches.has(branch)) {
      skipped.push({ name: branch, reason: "not-merged" });
      continue;
    }

    candidates.push({ name: branch });
  }

  const deleted: BranchCleanupCandidate[] = [];
  const failures: BranchCleanupFailure[] = [];

  if (input.apply) {
    for (const candidate of candidates) {
      try {
        git(["branch", "-d", candidate.name]);
        deleted.push(candidate);
      } catch (error: unknown) {
        failures.push({ name: candidate.name, message: formatError(error) });
      }
    }
  }

  return {
    status: "ok",
    apply: input.apply,
    baseBranch,
    candidates,
    skipped,
    deleted,
    failures,
  };
}

function createGitRunner(repoRoot: string): (args: string[]) => string {
  return (args: string[]) =>
    execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 10,
    }).trim();
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseWorktreeBranches(output: string): Map<string, string> {
  const branches = new Map<string, string>();
  let currentPath: string | undefined;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
      continue;
    }

    if (line.startsWith("branch refs/heads/") && currentPath) {
      branches.set(line.slice("branch refs/heads/".length), currentPath);
    }
  }

  return branches;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
