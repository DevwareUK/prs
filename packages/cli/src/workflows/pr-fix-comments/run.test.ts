import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PullRequestDetails,
  PullRequestReviewComment,
  RepositoryForge,
} from "../../forge";
import type { PullRequestFixWorkspace } from "./types";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("./snapshot", () => ({
  fetchLinkedIssuesForPullRequest: vi.fn(),
}));

vi.mock("./workspace", () => ({
  createPullRequestFixWorkspace: vi.fn(),
  writePullRequestFixWorkspaceFiles: vi.fn(),
}));

import { runPrFixCommentsCommand } from "./run";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import {
  createPullRequestFixWorkspace,
  writePullRequestFixWorkspaceFiles,
} from "./workspace";

function createPullRequest(): PullRequestDetails {
  return {
    number: 88,
    title: "Tighten PR review comment fixing flow",
    body: "Apply selected review feedback with Codex.",
    url: "https://github.com/DevwareUK/git-ai/pull/88",
    baseRefName: "main",
    headRefName: "feat/pr-fix-comments",
  };
}

function createReviewComment(body: string): PullRequestReviewComment {
  return {
    id: 501,
    body,
    path: "packages/cli/src/index.ts",
    line: 1900,
    side: "RIGHT",
    diffHunk: "@@ -1890,0 +1900,4 @@",
    url: "https://github.com/DevwareUK/git-ai/pull/88#discussion_r501",
    author: "reviewer-a",
    createdAt: "2026-03-18T08:00:00Z",
    updatedAt: "2026-03-18T08:05:00Z",
  };
}

function createForge(
  comments: PullRequestReviewComment[]
): {
  forge: RepositoryForge;
  fetchPullRequestDetails: ReturnType<typeof vi.fn>;
  fetchPullRequestReviewComments: ReturnType<typeof vi.fn>;
} {
  const fetchPullRequestDetails = vi.fn().mockResolvedValue(createPullRequest());
  const fetchPullRequestReviewComments = vi.fn().mockResolvedValue(comments);

  return {
    forge: {
      type: "github",
      isAuthenticated: () => true,
      fetchIssueDetails: vi.fn(),
      fetchIssuePlanComment: vi.fn(),
      fetchPullRequestDetails,
      fetchPullRequestIssueComments: vi.fn(),
      fetchPullRequestReviewComments,
      createIssuePlanComment: vi.fn(),
      createDraftIssue: vi.fn(),
      createOrReuseIssue: vi.fn(),
      createPullRequest: vi.fn(),
    },
    fetchPullRequestDetails,
    fetchPullRequestReviewComments,
  };
}

describe("runPrFixCommentsCommand", () => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-fix-comments-"));
  const workspace: PullRequestFixWorkspace = {
    runDir: resolve(repoRoot, ".git-ai/runs/20260320T112935000Z-pr-88-fix-comments"),
    snapshotFilePath: resolve(
      repoRoot,
      ".git-ai/runs/20260320T112935000Z-pr-88-fix-comments/pr-review-comments.md"
    ),
    promptFilePath: resolve(
      repoRoot,
      ".git-ai/runs/20260320T112935000Z-pr-88-fix-comments/prompt.md"
    ),
    metadataFilePath: resolve(
      repoRoot,
      ".git-ai/runs/20260320T112935000Z-pr-88-fix-comments/metadata.json"
    ),
    outputLogPath: resolve(
      repoRoot,
      ".git-ai/runs/20260320T112935000Z-pr-88-fix-comments/output.log"
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never);
    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([
      {
        number: 42,
        title: "Improve PR comment selection",
        body: "Keep the snapshot coherent for Codex.",
        url: "https://github.com/DevwareUK/git-ai/issues/42",
      },
    ]);
    vi.mocked(createPullRequestFixWorkspace).mockReturnValue(workspace);
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("fetches PR review context, runs Codex, verifies the build, and commits the reviewed message", async () => {
    const { forge, fetchPullRequestDetails, fetchPullRequestReviewComments } = createForge([
      createReviewComment("Guard against an empty comment selection before starting Codex."),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("y");
    const ensureCleanWorkingTree = vi.fn();
    const runCodex = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixCommentsCommand({
      prNumber: 88,
      repoRoot,
      buildCommand: ["pnpm", "build"],
      forge,
      ensureCleanWorkingTree,
      promptForLine,
      runCodex,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });

    expect(ensureCleanWorkingTree).toHaveBeenCalledWith(repoRoot);
    expect(fetchPullRequestDetails).toHaveBeenCalledWith(88);
    expect(fetchPullRequestReviewComments).toHaveBeenCalledWith(88);
    expect(fetchLinkedIssuesForPullRequest).toHaveBeenCalledWith(
      forge,
      expect.objectContaining({ number: 88 })
    );
    expect(createPullRequestFixWorkspace).toHaveBeenCalledWith(repoRoot, 88);
    expect(writePullRequestFixWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({ number: 88 }),
      [
        expect.objectContaining({
          summary: "Guard against an empty comment selection before starting Codex.",
          path: "packages/cli/src/index.ts",
        }),
      ],
      workspace,
      ["pnpm", "build"],
      [
        expect.objectContaining({
          number: 42,
        }),
      ]
    );
    expect(runCodex).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(hasChanges).toHaveBeenCalledWith(repoRoot);
    expect(commitGeneratedChanges).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({
        content: "fix: address PR review comments for #88\n",
        filePath: resolve(workspace.runDir, "commit-message.txt"),
      })
    );
    expect(promptForLine).toHaveBeenNthCalledWith(
      1,
      "Select tasks to address [all|none|1,2,...]: "
    );
    expect(promptForLine).toHaveBeenNthCalledWith(
      2,
      "Commit fixes with this message? [Y/n/m]: "
    );
  });

  it("leaves generated changes uncommitted when the reviewed message is declined", async () => {
    const { forge } = createForge([
      createReviewComment("Guard against an empty comment selection before starting Codex."),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("n");
    const runCodex = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixCommentsCommand({
      prNumber: 88,
      repoRoot,
      buildCommand: ["pnpm", "build"],
      forge,
      ensureCleanWorkingTree: vi.fn(),
      promptForLine,
      runCodex,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });

    expect(runCodex).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(hasChanges).toHaveBeenCalledWith(repoRoot);
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
  });

  it("lets the user modify the reviewed commit message before committing", async () => {
    const { forge } = createForge([
      createReviewComment("Guard against an empty comment selection before starting Codex."),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("m").mockResolvedValueOnce("y");
    const runCodex = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    vi.mocked(spawnSync).mockImplementation((command) => {
      const [, quotedPath = ""] = String(command).match(/"([^"]+)"/) ?? [];
      writeFileSync(
        quotedPath,
        "fix: refine PR review comment commit message\n\nReviewed before commit.\n",
        "utf8"
      );
      return { status: 0 } as never;
    });

    await runPrFixCommentsCommand({
      prNumber: 88,
      repoRoot,
      buildCommand: ["pnpm", "build"],
      forge,
      ensureCleanWorkingTree: vi.fn(),
      promptForLine,
      runCodex,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });

    expect(commitGeneratedChanges).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({
        content: "fix: refine PR review comment commit message\n\nReviewed before commit.\n",
        filePath: resolve(workspace.runDir, "commit-message.txt"),
      })
    );
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });
});
