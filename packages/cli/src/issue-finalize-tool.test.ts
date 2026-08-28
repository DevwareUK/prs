import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseIssueCommandArgs } from "./commands/issue";
import {
  buildIssueCommitMessage,
  finalizeIssueChanges,
  formatIssueFinalizePreview,
  type IssueFinalizePreview,
} from "./issue-finalize-tool";

const temporaryRoots: string[] = [];

function gitRaw(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function git(root: string, args: string[]): string {
  return gitRaw(root, args).trim();
}

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "prs-issue-finalize-"));
  temporaryRoots.push(root);
  execFileSync("git", ["init", "--initial-branch=main", root], { stdio: "ignore" });
  git(root, ["config", "user.name", "PRS Test"]);
  git(root, ["config", "user.email", "prs@example.test"]);
  for (const name of [
    "included.txt", "unstaged.txt", "modified.txt",
    "renamed-before.txt", "deleted.txt",
  ]) {
    writeFileSync(join(root, name), name === "renamed-before.txt" ? "rename me\n" : "baseline\n");
  }
  git(root, ["add", "--all"]);
  git(root, ["commit", "-m", "test: baseline"]);
  return root;
}

function noForge() {
  return {
    type: "none" as const,
    fetchIssueDetails: vi.fn(async () => {
      throw new Error("forge lookup must not run");
    }),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("deterministic issue finalization", () => {
  it("keeps only the documented finalize command", () => {
    expect(parseIssueCommandArgs(["issue", "finalize", "42"])).toEqual({
      action: "finalize", issueNumber: 42,
    });
    expect(() => parseIssueCommandArgs(["issue", "42", "--jdi"])).toThrow("Usage:");
  });

  it("builds commit text without a model provider", () => {
    expect(buildIssueCommitMessage(42, {
      title: "Keep the CLI deterministic", body: "", url: "https://example.test/42",
    })).toBe("feat: resolve issue #42\n\nIssue: Keep the CLI deterministic");
  });

  it("commits only the prepared index and preserves working-tree state", async () => {
    const root = createRepository();
    writeFileSync(join(root, "included.txt"), "staged version\n");
    git(root, ["add", "included.txt"]);
    writeFileSync(join(root, "included.txt"), "staged version\nworking tree only\n");
    writeFileSync(join(root, "unstaged.txt"), "unrelated tracked edit\n");
    writeFileSync(join(root, "untracked.log"), "local artifact\n");
    const workingBefore = gitRaw(root, ["diff", "--binary"]);
    let preview: IssueFinalizePreview | undefined;

    const result = await finalizeIssueChanges({
      repoRoot: root,
      issueNumber: 345,
      forge: noForge(),
      confirm: async (value) => { preview = value; return true; },
    });

    expect(result.status).toBe("committed");
    expect(preview).toEqual({
      commitMessage: "feat: resolve issue #345",
      stagedChanges: [{ status: "M", paths: ["included.txt"] }],
    });
    expect(gitRaw(root, ["show", "HEAD:included.txt"])).toBe("staged version\n");
    expect(readFileSync(join(root, "included.txt"), "utf8"))
      .toBe("staged version\nworking tree only\n");
    expect(readFileSync(join(root, "unstaged.txt"), "utf8"))
      .toBe("unrelated tracked edit\n");
    expect(readFileSync(join(root, "untracked.log"), "utf8")).toBe("local artifact\n");
    expect(gitRaw(root, ["diff", "--binary"])).toBe(workingBefore);
    expect(git(root, ["show", "--format=", "--name-only", "HEAD"])).toBe("included.txt");
  });

  it("supports additions, modifications, deletions, and renames", async () => {
    const root = createRepository();
    writeFileSync(join(root, "added.txt"), "added\n");
    writeFileSync(join(root, "modified.txt"), "modified\n");
    git(root, ["add", "added.txt", "modified.txt"]);
    git(root, ["mv", "renamed-before.txt", "renamed-after.txt"]);
    git(root, ["rm", "deleted.txt"]);
    let preview: IssueFinalizePreview | undefined;

    await finalizeIssueChanges({
      repoRoot: root,
      issueNumber: 345,
      forge: noForge(),
      confirm: async (value) => { preview = value; return true; },
    });

    expect(preview?.stagedChanges).toEqual(expect.arrayContaining([
      { status: "A", paths: ["added.txt"] },
      { status: "D", paths: ["deleted.txt"] },
      { status: "M", paths: ["modified.txt"] },
      { status: "R100", paths: ["renamed-before.txt", "renamed-after.txt"] },
    ]));
    expect(formatIssueFinalizePreview(preview!))
      .toContain('R100 "renamed-before.txt" -> "renamed-after.txt"');
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });

  it("skips an empty index before forge lookup or confirmation", async () => {
    const root = createRepository();
    writeFileSync(join(root, "unstaged.txt"), "unstaged\n");
    writeFileSync(join(root, "untracked.log"), "untracked\n");
    const headBefore = git(root, ["rev-parse", "HEAD"]);
    const statusBefore = gitRaw(root, ["status", "--porcelain"]);
    const forge = noForge();
    const confirm = vi.fn(async () => true);

    const result = await finalizeIssueChanges({
      repoRoot: root, issueNumber: 345, forge, confirm,
    });

    expect(result).toEqual({
      status: "skipped",
      message: "No staged changes are available to finalize. Stage the intended issue changes and retry.",
    });
    expect(forge.fetchIssueDetails).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(git(root, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(gitRaw(root, ["status", "--porcelain"])).toBe(statusBefore);
  });

  it("cancellation preserves HEAD, index, working tree, and untracked files", async () => {
    const root = createRepository();
    writeFileSync(join(root, "included.txt"), "staged\n");
    git(root, ["add", "included.txt"]);
    writeFileSync(join(root, "unstaged.txt"), "unstaged\n");
    writeFileSync(join(root, "untracked.log"), "untracked\n");
    const before = {
      head: git(root, ["rev-parse", "HEAD"]),
      cached: gitRaw(root, ["diff", "--cached", "--binary"]),
      working: gitRaw(root, ["diff", "--binary"]),
      status: gitRaw(root, ["status", "--porcelain"]),
    };

    const result = await finalizeIssueChanges({
      repoRoot: root,
      issueNumber: 345,
      forge: noForge(),
      confirm: async () => false,
    });

    expect(result).toEqual({
      status: "skipped",
      message: "Commit cancelled; staged and working-tree changes were kept.",
    });
    expect(git(root, ["rev-parse", "HEAD"])).toBe(before.head);
    expect(gitRaw(root, ["diff", "--cached", "--binary"])).toBe(before.cached);
    expect(gitRaw(root, ["diff", "--binary"])).toBe(before.working);
    expect(gitRaw(root, ["status", "--porcelain"])).toBe(before.status);
    expect(readFileSync(join(root, "untracked.log"), "utf8")).toBe("untracked\n");
  });

  it("renders the deterministic message and exact staged paths", () => {
    expect(formatIssueFinalizePreview({
      commitMessage: "feat: resolve issue #345\n\nIssue: Safe finalization",
      stagedChanges: [
        { status: "M", paths: ["packages/cli/src/index.ts"] },
        { status: "R100", paths: ["old name.ts", "new name.ts"] },
      ],
    })).toBe([
      "Proposed commit message:", "",
      "feat: resolve issue #345", "", "Issue: Safe finalization", "",
      "Staged paths:",
      '  M "packages/cli/src/index.ts"',
      '  R100 "old name.ts" -> "new name.ts"',
    ].join("\n"));
  });

  it("quotes tabs and newlines in staged paths unambiguously", () => {
    expect(formatIssueFinalizePreview({
      commitMessage: "feat: resolve issue #345",
      stagedChanges: [
        { status: "A", paths: ["tab\tname.ts"] },
        { status: "M", paths: ["line\nbreak.ts"] },
      ],
    })).toBe([
      "Proposed commit message:", "", "feat: resolve issue #345", "",
      "Staged paths:",
      '  A "tab\\tname.ts"',
      '  M "line\\nbreak.ts"',
    ].join("\n"));
  });
});
