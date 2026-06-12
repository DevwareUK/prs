import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

export type WorktreeCleanupCandidate = {
  path: string;
  branch?: string;
  detached: boolean;
  reason: string;
  safeToRemove: boolean;
  blockedReasons: string[];
  removed?: boolean;
};

export type WorktreeCleanupToolResult = {
  status: "ready";
  repoRoot: string;
  apply: boolean;
  summary: {
    total: number;
    removable: number;
    blocked: number;
    removed: number;
  };
  candidates: WorktreeCleanupCandidate[];
};

type WorktreeCleanupToolOptions = {
  repoRoot: string;
  apply?: boolean;
  runCommand?: (command: string, args: string[]) => string;
};

type GitWorktreeEntry = {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
};

function runCommand(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function toDisplayPath(repoRoot: string, path: string): string {
  const resolvedRepoRoot = resolve(repoRoot);
  const resolvedPath = resolve(path);
  const relativePath = relative(resolvedRepoRoot, resolvedPath);

  if (!relativePath.startsWith("..")) {
    return relativePath || ".";
  }

  return path;
}

function parseBranchName(rawBranch: string | undefined): string | undefined {
  if (!rawBranch) {
    return undefined;
  }

  return rawBranch.replace(/^refs\/heads\//, "").trim() || undefined;
}

function parseWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: Partial<GitWorktreeEntry> | undefined;

  const finishEntry = () => {
    if (current?.path) {
      entries.push({
        path: current.path,
        head: current.head,
        branch: current.branch,
        detached: current.detached ?? false,
      });
    }
    current = undefined;
  };

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      finishEntry();
      continue;
    }

    const [key, ...rest] = trimmed.split(" ");
    const value = rest.join(" ").trim();
    if (key === "worktree") {
      finishEntry();
      current = { path: value, detached: false };
      continue;
    }
    if (!current) {
      continue;
    }
    if (key === "HEAD") {
      current.head = value || undefined;
      continue;
    }
    if (key === "branch") {
      current.branch = parseBranchName(value);
      continue;
    }
    if (key === "detached") {
      current.detached = true;
    }
  }

  finishEntry();
  return entries;
}

function isManagedPrsWorktree(repoRoot: string, entry: GitWorktreeEntry): boolean {
  const prsRoot = resolve(repoRoot, ".prs", "worktrees");
  const localRoot = resolve(repoRoot, ".worktrees");
  const resolvedPath = resolve(entry.path);

  if (resolvedPath === resolve(repoRoot)) {
    return true;
  }

  if (resolvedPath.startsWith(`${prsRoot}/`) || resolvedPath === prsRoot) {
    return true;
  }

  return (
    (resolvedPath.startsWith(`${localRoot}/`) || resolvedPath === localRoot) &&
    Boolean(entry.branch?.startsWith("codex/"))
  );
}

function getStatus(runCommandImpl: (command: string, args: string[]) => string, path: string): string {
  return runCommandImpl("git", ["-C", path, "status", "--porcelain"]);
}

function isReachableFromAnyRef(
  runCommandImpl: (command: string, args: string[]) => string,
  path: string
): boolean {
  return runCommandImpl("git", ["-C", path, "branch", "--contains", "HEAD", "--all"]).length > 0;
}

function resolveComparisonRef(
  runCommandImpl: (command: string, args: string[]) => string,
  repoRoot: string,
  path: string,
  branch: string
): string | undefined {
  try {
    const upstream = runCommandImpl("git", [
      "-C",
      path,
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    if (upstream) {
      return upstream;
    }
  } catch {
    // Fall back to origin/<branch> below.
  }

  const fallbackRef = `origin/${branch}`;
  try {
    runCommandImpl("git", ["-C", repoRoot, "rev-parse", "--verify", fallbackRef]);
    return fallbackRef;
  } catch {
    return undefined;
  }
}

function determineCandidate(
  runCommandImpl: (command: string, args: string[]) => string,
  repoRoot: string,
  entry: GitWorktreeEntry
): WorktreeCleanupCandidate {
  const displayPath = toDisplayPath(repoRoot, entry.path);
  const blockedReasons: string[] = [];
  const managed = isManagedPrsWorktree(repoRoot, entry);

  if (resolve(entry.path) === resolve(repoRoot)) {
    blockedReasons.push("current-checkout");
  }

  if (!managed) {
    blockedReasons.push("non-prs-worktree");
  }

  if (!existsSync(entry.path)) {
    blockedReasons.push("missing-path");
  }

  const status = existsSync(entry.path) ? getStatus(runCommandImpl, entry.path) : "";
  if (status.trim()) {
    blockedReasons.push("dirty-worktree");
  }

  if (managed && blockedReasons.length === 0) {
    if (entry.detached) {
      if (!isReachableFromAnyRef(runCommandImpl, entry.path)) {
        blockedReasons.push("detached-head-unreachable");
      }
    } else if (entry.branch) {
      const comparisonRef = resolveComparisonRef(runCommandImpl, repoRoot, entry.path, entry.branch);
      if (!comparisonRef) {
        blockedReasons.push("no-upstream");
      } else {
        const aheadCount = Number.parseInt(
          runCommandImpl("git", [
            "-C",
            entry.path,
            "rev-list",
            "--count",
            `${comparisonRef}..HEAD`,
          ]),
          10
        );
        if (!Number.isFinite(aheadCount) || aheadCount > 0) {
          blockedReasons.push("unpushed-commits");
        }
      }
    }
  }

  const safeToRemove = blockedReasons.length === 0;
  const reason = safeToRemove
    ? entry.detached
      ? "PRS-managed detached worktree under .prs/worktrees with a reachable HEAD and no local changes."
      : "PRS-managed worktree with a clean status and no unpushed commits."
    : blockedReasons.includes("current-checkout")
      ? "This is the repository root currently running the command."
      : blockedReasons.includes("dirty-worktree")
        ? "Worktree has uncommitted changes."
        : blockedReasons.includes("non-prs-worktree")
          ? "Path is not under a PRS-managed worktree root or branch pattern."
          : blockedReasons.includes("detached-head-unreachable")
            ? "Detached HEAD is not reachable from a ref, so cleanup could lose commits."
            : blockedReasons.includes("no-upstream")
              ? "Could not prove the branch has an upstream or origin tracking ref."
              : "Worktree has commits that are not safely removable.";

  return {
    path: displayPath,
    branch: entry.branch,
    detached: entry.detached,
    reason,
    safeToRemove,
    blockedReasons,
  };
}

function removeSafeCandidate(
  runCommandImpl: (command: string, args: string[]) => string,
  repoRoot: string,
  candidate: WorktreeCleanupCandidate
): void {
  if (!candidate.safeToRemove) {
    return;
  }

  const fullPath = resolve(repoRoot, candidate.path);
  runCommandImpl("git", ["-C", repoRoot, "worktree", "remove", fullPath]);
}

export function cleanupWorktreesTool(
  options: WorktreeCleanupToolOptions
): WorktreeCleanupToolResult {
  const runCommandImpl = options.runCommand ?? runCommand;
  const apply = options.apply ?? false;
  const worktreeList = parseWorktreeList(
    runCommandImpl("git", ["-C", options.repoRoot, "worktree", "list", "--porcelain"])
  );
  const candidates = worktreeList.map((entry) =>
    determineCandidate(runCommandImpl, options.repoRoot, entry)
  );

  if (apply) {
    for (const candidate of candidates) {
      removeSafeCandidate(runCommandImpl, options.repoRoot, candidate);
      if (candidate.safeToRemove) {
        candidate.removed = true;
      }
    }
  }

  const removable = candidates.filter((candidate) => candidate.safeToRemove).length;
  const removed = candidates.filter((candidate) => candidate.removed).length;

  return {
    status: "ready",
    repoRoot: options.repoRoot,
    apply,
    summary: {
      total: candidates.length,
      removable,
      blocked: candidates.length - removable,
      removed,
    },
    candidates,
  };
}
