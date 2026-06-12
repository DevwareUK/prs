import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupMergedBranchesTool } from "./branch-cleanup-tool";

const cleanupTargets = new Set<string>();

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(repoRoot: string, relativePath: string, contents: string): void {
  const filePath = resolve(repoRoot, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function commit(repoRoot: string, message: string): void {
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", message]);
}

function createRepository(): { repoRoot: string; worktreePath: string } {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-branch-cleanup-"));
  cleanupTargets.add(repoRoot);

  git(repoRoot, ["init", "--initial-branch=main"]);
  git(repoRoot, ["config", "user.email", "prs@example.com"]);
  git(repoRoot, ["config", "user.name", "PRS Tests"]);
  write(repoRoot, ".prs/config.json", JSON.stringify({ baseBranch: "main" }, null, 2));
  write(repoRoot, "README.md", "Initial\n");
  commit(repoRoot, "initial");

  git(repoRoot, ["switch", "-c", "feature/merged"]);
  write(repoRoot, "merged.txt", "merged\n");
  commit(repoRoot, "merged branch");
  git(repoRoot, ["switch", "main"]);
  git(repoRoot, ["merge", "--no-ff", "feature/merged", "-m", "merge feature"]);

  git(repoRoot, ["switch", "-c", "feature/unmerged"]);
  write(repoRoot, "unmerged.txt", "unmerged\n");
  commit(repoRoot, "unmerged branch");
  git(repoRoot, ["switch", "main"]);

  git(repoRoot, ["switch", "-c", "feature/worktree"]);
  write(repoRoot, "worktree.txt", "worktree\n");
  commit(repoRoot, "worktree branch");
  git(repoRoot, ["switch", "main"]);
  git(repoRoot, ["merge", "--no-ff", "feature/worktree", "-m", "merge worktree branch"]);

  const worktreePath = resolve(dirname(repoRoot), `${repoRoot.split("/").pop()}-linked`);
  cleanupTargets.add(worktreePath);
  git(repoRoot, ["worktree", "add", worktreePath, "feature/worktree"]);

  return { repoRoot, worktreePath };
}

function branchExists(repoRoot: string, branchName: string): boolean {
  try {
    git(repoRoot, ["show-ref", "--verify", `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

describe("cleanupMergedBranchesTool", () => {
  it("dry-runs local branches merged into the configured base branch without deleting them", () => {
    const { repoRoot, worktreePath } = createRepository();

    const result = cleanupMergedBranchesTool({ repoRoot, apply: false });

    expect(result).toMatchObject({
      status: "ok",
      apply: false,
      baseBranch: "main",
    });
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["feature/merged"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { name: "main", reason: "protected" },
        { name: "feature/unmerged", reason: "not-merged" },
        {
          name: "feature/worktree",
          reason: "checked-out-in-worktree",
          worktreePath: realpathSync(worktreePath),
        },
      ])
    );
    expect(result.deleted).toEqual([]);
    expect(branchExists(repoRoot, "feature/merged")).toBe(true);
  });

  it("applies cleanup with safe deletion and preserves protected, unmerged, and worktree branches", () => {
    const { repoRoot } = createRepository();

    const result = cleanupMergedBranchesTool({ repoRoot, apply: true });

    expect(result.status).toBe("ok");
    expect(result.apply).toBe(true);
    expect(result.deleted).toEqual([{ name: "feature/merged" }]);
    expect(result.failures).toEqual([]);
    expect(branchExists(repoRoot, "feature/merged")).toBe(false);
    expect(branchExists(repoRoot, "main")).toBe(true);
    expect(branchExists(repoRoot, "feature/unmerged")).toBe(true);
    expect(branchExists(repoRoot, "feature/worktree")).toBe(true);
  });

  it("reports a blocked result outside a git repository", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-branch-cleanup-no-git-"));
    cleanupTargets.add(repoRoot);

    const result = cleanupMergedBranchesTool({ repoRoot, apply: false });

    expect(result.status).toBe("blocked");
    expect(result.message).toContain("requires a Git repository");
  });
});
