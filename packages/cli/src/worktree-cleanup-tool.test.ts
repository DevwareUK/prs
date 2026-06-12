import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWorktreesTool } from "./worktree-cleanup-tool";

const cleanupTargets = new Set<string>();

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

function setupRepoFixture(): {
  repoRoot: string;
  manualWorktreePath: string;
  prsDetachedWorktreePath: string;
  prsDirtyWorktreePath: string;
  prsBranchWorktreePath: string;
} {
  const repoRoot = mkdtempSync(join(tmpdir(), "prs-worktree-cleanup-repo-"));
  const manualWorktreePath = mkdtempSync(join(tmpdir(), "prs-worktree-cleanup-manual-"));
  cleanupTargets.add(repoRoot);
  cleanupTargets.add(manualWorktreePath);

  const prsDetachedWorktreePath = resolve(
    repoRoot,
    ".prs",
    "worktrees",
    "issues-223-224",
    "issue-223"
  );
  const prsDirtyWorktreePath = resolve(
    repoRoot,
    ".prs",
    "worktrees",
    "issues-223-224",
    "issue-224"
  );
  const prsBranchWorktreePath = resolve(repoRoot, ".worktrees", "sales-menu-images");

  mkdirSync(prsDetachedWorktreePath, { recursive: true });
  mkdirSync(prsDirtyWorktreePath, { recursive: true });
  mkdirSync(prsBranchWorktreePath, { recursive: true });

  return {
    repoRoot,
    manualWorktreePath,
    prsDetachedWorktreePath,
    prsDirtyWorktreePath,
    prsBranchWorktreePath,
  };
}

describe("worktree cleanup tool", () => {
  it("reports PRS-managed worktrees and blocks unsafe candidates", () => {
    const {
      repoRoot,
      manualWorktreePath,
      prsBranchWorktreePath,
      prsDetachedWorktreePath,
      prsDirtyWorktreePath,
    } = setupRepoFixture();
    const runCommand = vi.fn((command: string, args: string[]) => {
      const key = `${command} ${args.join(" ")}`;

      switch (key) {
        case `git -C ${repoRoot} worktree list --porcelain`:
          return [
            `worktree ${repoRoot}`,
            "HEAD aaaaaaaa",
            "branch refs/heads/main",
            "",
            `worktree ${prsDetachedWorktreePath}`,
            "HEAD bbbbbbbb",
            "detached",
            "",
            `worktree ${prsDirtyWorktreePath}`,
            "HEAD cccccccc",
            "detached",
            "",
            `worktree ${prsBranchWorktreePath}`,
            "HEAD dddddddd",
            "branch refs/heads/codex/sales-menu-images",
            "",
            `worktree ${manualWorktreePath}`,
            "HEAD eeeeeeee",
            "branch refs/heads/main",
            "",
          ].join("\n");
        case `git -C ${repoRoot} status --porcelain`:
          return "";
        case `git -C ${prsDetachedWorktreePath} status --porcelain`:
          return "";
        case `git -C ${prsDetachedWorktreePath} branch --contains HEAD --all`:
          return "origin/main";
        case `git -C ${prsDirtyWorktreePath} status --porcelain`:
          return " M packages/cli/src/index.ts";
        case `git -C ${prsBranchWorktreePath} status --porcelain`:
          return "";
        case `git -C ${prsBranchWorktreePath} rev-parse --abbrev-ref --symbolic-full-name @{u}`:
          return "origin/codex/sales-menu-images";
        case `git -C ${prsBranchWorktreePath} rev-list --count origin/codex/sales-menu-images..HEAD`:
          return "0";
        case `git -C ${manualWorktreePath} status --porcelain`:
          return "";
        case `git -C ${repoRoot} worktree remove ${prsDetachedWorktreePath}`:
        case `git -C ${repoRoot} worktree remove ${prsBranchWorktreePath}`:
          return "";
        default:
          throw new Error(`Unexpected command: ${key}`);
      }
    });

    const result = cleanupWorktreesTool({
      repoRoot,
      runCommand,
    });

    expect(result).toMatchObject({
      status: "ready",
      repoRoot,
      apply: false,
      summary: {
        total: 5,
        removable: 2,
        blocked: 3,
        removed: 0,
      },
      candidates: [
        {
          path: ".",
          safeToRemove: false,
          blockedReasons: ["current-checkout"],
        },
        {
          path: `.prs/worktrees/issues-223-224/issue-223`,
          detached: true,
          safeToRemove: true,
          blockedReasons: [],
        },
        {
          path: `.prs/worktrees/issues-223-224/issue-224`,
          safeToRemove: false,
          blockedReasons: ["dirty-worktree"],
        },
        {
          path: `.worktrees/sales-menu-images`,
          branch: "codex/sales-menu-images",
          safeToRemove: true,
          blockedReasons: [],
        },
        {
          path: manualWorktreePath,
          safeToRemove: false,
          blockedReasons: ["non-prs-worktree"],
        },
      ],
    });
    expect(runCommand).not.toHaveBeenCalledWith("git", [
      "-C",
      repoRoot,
      "worktree",
      "remove",
      prsDirtyWorktreePath,
    ]);
  });

  it("applies cleanup only to safe candidates", () => {
    const {
      repoRoot,
      prsBranchWorktreePath,
      prsDetachedWorktreePath,
      prsDirtyWorktreePath,
    } = setupRepoFixture();
    const removedPaths: string[] = [];
    const runCommand = vi.fn((command: string, args: string[]) => {
      const key = `${command} ${args.join(" ")}`;

      switch (key) {
        case `git -C ${repoRoot} worktree list --porcelain`:
          return [
            `worktree ${repoRoot}`,
            "HEAD aaaaaaaa",
            "branch refs/heads/main",
            "",
            `worktree ${prsDetachedWorktreePath}`,
            "HEAD bbbbbbbb",
            "detached",
            "",
            `worktree ${prsDirtyWorktreePath}`,
            "HEAD cccccccc",
            "detached",
            "",
            `worktree ${prsBranchWorktreePath}`,
            "HEAD dddddddd",
            "branch refs/heads/codex/sales-menu-images",
            "",
          ].join("\n");
        case `git -C ${repoRoot} status --porcelain`:
          return "";
        case `git -C ${prsDetachedWorktreePath} status --porcelain`:
          return "";
        case `git -C ${prsDetachedWorktreePath} branch --contains HEAD --all`:
          return "origin/main";
        case `git -C ${prsDirtyWorktreePath} status --porcelain`:
          return " M packages/cli/src/index.ts";
        case `git -C ${prsBranchWorktreePath} status --porcelain`:
          return "";
        case `git -C ${prsBranchWorktreePath} rev-parse --abbrev-ref --symbolic-full-name @{u}`:
          return "origin/codex/sales-menu-images";
        case `git -C ${prsBranchWorktreePath} rev-list --count origin/codex/sales-menu-images..HEAD`:
          return "0";
        case `git -C ${repoRoot} worktree remove ${prsDetachedWorktreePath}`:
        case `git -C ${repoRoot} worktree remove ${prsBranchWorktreePath}`:
          removedPaths.push(args.at(-1) ?? "");
          return "";
        default:
          throw new Error(`Unexpected command: ${key}`);
      }
    });

    const result = cleanupWorktreesTool({
      repoRoot,
      apply: true,
      runCommand,
    });

    expect(result.summary.removed).toBe(2);
    expect(result.candidates.filter((candidate) => candidate.removed)).toEqual([
      expect.objectContaining({ path: ".prs/worktrees/issues-223-224/issue-223" }),
      expect.objectContaining({ path: ".worktrees/sales-menu-images" }),
    ]);
    expect(removedPaths).toEqual([
      prsDetachedWorktreePath,
      prsBranchWorktreePath,
    ]);
  });
});
