import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PullRequestDetails,
  RepositoryComment,
  RepositoryForge,
} from "../../forge";
import type { PullRequestFixTestsWorkspace } from "./types";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("./snapshot", () => ({
  fetchLinkedIssuesForPullRequest: vi.fn(),
}));

vi.mock("./workspace", () => ({
  createPullRequestFixTestsWorkspace: vi.fn(),
  writePullRequestFixTestsWorkspaceFiles: vi.fn(),
}));

import { runPrFixTestsCommand } from "./run";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import {
  createPullRequestFixTestsWorkspace,
  writePullRequestFixTestsWorkspaceFiles,
} from "./workspace";

function createManagedComment(body: string): RepositoryComment {
  return {
    id: 801,
    body,
    url: "https://github.com/DevwareUK/git-ai/pull/71#issuecomment-801",
    createdAt: "2026-03-20T11:00:00Z",
    updatedAt: "2026-03-20T11:29:35Z",
    author: "github-actions[bot]",
    isBot: true,
  };
}

function createPullRequest(): PullRequestDetails {
  return {
    number: 71,
    title: "Add git-ai pr fix-tests",
    body: "Closes #70\n\nImplement managed AI test suggestion handoff.",
    url: "https://github.com/DevwareUK/git-ai/pull/71",
    baseRefName: "main",
    headRefName: "feat/pr-fix-tests",
  };
}

function createForge(
  comments: RepositoryComment[]
): {
  forge: RepositoryForge;
  fetchPullRequestDetails: ReturnType<typeof vi.fn>;
  fetchPullRequestIssueComments: ReturnType<typeof vi.fn>;
} {
  const fetchPullRequestDetails = vi.fn().mockResolvedValue(createPullRequest());
  const fetchPullRequestIssueComments = vi.fn().mockResolvedValue(comments);

  return {
    forge: {
      type: "github",
      isAuthenticated: () => true,
      fetchIssueDetails: vi.fn(),
      fetchIssuePlanComment: vi.fn(),
      fetchPullRequestDetails,
      fetchPullRequestIssueComments,
      fetchPullRequestReviewComments: vi.fn(),
      createIssuePlanComment: vi.fn(),
      createDraftIssue: vi.fn(),
      createOrReuseIssue: vi.fn(),
      createPullRequest: vi.fn(),
    },
    fetchPullRequestDetails,
    fetchPullRequestIssueComments,
  };
}

describe("runPrFixTestsCommand", () => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-fix-tests-"));
  const workspace: PullRequestFixTestsWorkspace = {
    runDir: resolve(repoRoot, ".git-ai/runs/20260320T112935000Z-pr-71-fix-tests"),
    snapshotFilePath: resolve(
      repoRoot,
      ".git-ai/runs/20260320T112935000Z-pr-71-fix-tests/pr-test-suggestions.md"
    ),
    promptFilePath: resolve(
      repoRoot,
      ".git-ai/runs/20260320T112935000Z-pr-71-fix-tests/prompt.md"
    ),
    metadataFilePath: resolve(
      repoRoot,
      ".git-ai/runs/20260320T112935000Z-pr-71-fix-tests/metadata.json"
    ),
    outputLogPath: resolve(
      repoRoot,
      ".git-ai/runs/20260320T112935000Z-pr-71-fix-tests/output.log"
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never);
    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([
      {
        number: 70,
        title: "Add git-ai pr fix-tests",
        body: "Implement managed AI test suggestion handoff.",
        url: "https://github.com/DevwareUK/git-ai/issues/70",
      },
    ]);
    vi.mocked(createPullRequestFixTestsWorkspace).mockReturnValue(workspace);
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("fetches PR context, writes workspace files, runs Codex, verifies the build, and commits", async () => {
    const comment = createManagedComment(
      [
        "<!-- git-ai-test-suggestions -->",
        "## AI Test Suggestions",
        "",
        "### Suggested test areas",
        "",
        "#### Verify command execution for 'git-ai pr fix-tests'",
        "- Priority: High",
        "- Why it matters: The command should orchestrate the selected test workflow.",
        "- Likely locations: `packages/cli/src/index.test.ts`, `packages/cli/src/workflows/pr-fix-tests/run.test.ts`",
        "",
        "#### Verify output artifacts are created correctly",
        "- Priority: Medium",
        "- Why it matters: The workflow should produce auditable run artifacts.",
        "- Likely locations: `packages/cli/src/workflows/pr-fix-tests/workspace.test.ts`",
      ].join("\n")
    );
    const { forge, fetchPullRequestDetails, fetchPullRequestIssueComments } = createForge([
      comment,
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1,2").mockResolvedValueOnce("y");
    const ensureCleanWorkingTree = vi.fn();
    const runCodex = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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
    expect(fetchPullRequestDetails).toHaveBeenCalledWith(71);
    expect(fetchPullRequestIssueComments).toHaveBeenCalledWith(71);
    expect(fetchLinkedIssuesForPullRequest).toHaveBeenCalledWith(
      forge,
      expect.objectContaining({ number: 71 })
    );
    expect(createPullRequestFixTestsWorkspace).toHaveBeenCalledWith(repoRoot, 71);
    expect(writePullRequestFixTestsWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({ number: 71 }),
      [
        expect.objectContaining({
          area: "Verify command execution for 'git-ai pr fix-tests'",
          priority: "high",
        }),
        expect.objectContaining({
          area: "Verify output artifacts are created correctly",
          priority: "medium",
        }),
      ],
      expect.objectContaining({
        sourceComment: expect.objectContaining({ id: 801 }),
      }),
      workspace,
      ["pnpm", "build"],
      [
        expect.objectContaining({
          number: 70,
        }),
      ]
    );
    expect(runCodex).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(hasChanges).toHaveBeenCalledWith(repoRoot);
    expect(commitGeneratedChanges).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({
        content: "test: address AI test suggestions for PR #71\n",
        filePath: resolve(workspace.runDir, "commit-message.txt"),
      })
    );
    expect(promptForLine).toHaveBeenNthCalledWith(
      1,
      "Select test suggestions to implement [all|none|1,2,...]: "
    );
    expect(promptForLine).toHaveBeenNthCalledWith(
      2,
      "Commit fixes with this message? [Y/n/m]: "
    );
  });

  it("uses the newest managed AI test suggestions comment when multiple candidates exist", async () => {
    const olderComment = createManagedComment(
      [
        "<!-- git-ai-test-suggestions -->",
        "## AI Test Suggestions",
        "",
        "### Suggested test areas",
        "",
        "#### Older suggestion",
        "- Priority: Low",
        "- Why it matters: Older comments should not win selection.",
      ].join("\n")
    );
    const newerComment = {
      ...createManagedComment(
        [
          "<!-- git-ai-test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          "#### Newer suggestion",
          "- Priority: High",
          "- Why it matters: The most recent managed comment should drive the workflow.",
          "- Likely locations: `packages/cli/src/workflows/pr-fix-tests/run.test.ts`",
        ].join("\n")
      ),
      id: 802,
      updatedAt: "2026-03-20T11:45:00Z",
    };
    const { forge } = createForge([olderComment, newerComment]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("n");
    const runCodex = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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

    expect(writePullRequestFixTestsWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({ number: 71 }),
      [
        expect.objectContaining({
          area: "Newer suggestion",
          priority: "high",
        }),
      ],
      expect.objectContaining({
        sourceComment: expect.objectContaining({ id: 802 }),
      }),
      workspace,
      ["pnpm", "build"],
      expect.any(Array)
    );
    expect(runCodex).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
  });

  it("exits without Codex or workspace writes when no test suggestions are selected", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- git-ai-test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          "#### Verify command execution for 'git-ai pr fix-tests'",
          "- Priority: High",
          "- Why it matters: The command should orchestrate the selected test workflow.",
        ].join("\n")
      ),
    ]);
    const promptForLine = vi.fn().mockResolvedValue("none");
    const runCodex = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn();
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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

    expect(createPullRequestFixTestsWorkspace).not.toHaveBeenCalled();
    expect(writePullRequestFixTestsWorkspaceFiles).not.toHaveBeenCalled();
    expect(runCodex).not.toHaveBeenCalled();
    expect(verifyBuild).not.toHaveBeenCalled();
    expect(hasChanges).not.toHaveBeenCalled();
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
    expect(promptForLine).toHaveBeenCalledTimes(1);
  });

  it("leaves generated changes uncommitted when the user declines the commit prompt", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- git-ai-test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          "#### Verify post-Codex workflow",
          "- Priority: High",
          "- Why it matters: Users may want to inspect changes before committing.",
        ].join("\n")
      ),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("n");
    const runCodex = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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
    expect(promptForLine).toHaveBeenNthCalledWith(
      2,
      "Commit fixes with this message? [Y/n/m]: "
    );
  });

  it("lets the user modify the reviewed commit message before committing", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- git-ai-test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          "#### Verify post-Codex workflow",
          "- Priority: High",
          "- Why it matters: The reviewed commit message should be editable.",
        ].join("\n")
      ),
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
        "test: refine AI test suggestion commit message\n\nReviewed before commit.\n",
        "utf8"
      );
      return { status: 0 } as never;
    });

    await runPrFixTestsCommand({
      prNumber: 71,
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
        content: "test: refine AI test suggestion commit message\n\nReviewed before commit.\n",
        filePath: resolve(workspace.runDir, "commit-message.txt"),
      })
    );
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when Codex completes without producing any file changes", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- git-ai-test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          "#### Verify post-Codex workflow",
          "- Priority: High",
          "- Why it matters: Empty Codex runs should fail before any commit prompt.",
        ].join("\n")
      ),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1");
    const runCodex = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(false);
    const commitGeneratedChanges = vi.fn();

    await expect(
      runPrFixTestsCommand({
        prNumber: 71,
        repoRoot,
        buildCommand: ["pnpm", "build"],
        forge,
        ensureCleanWorkingTree: vi.fn(),
        promptForLine,
        runCodex,
        verifyBuild,
        hasChanges,
        commitGeneratedChanges,
      })
    ).rejects.toThrow("Codex completed without producing any file changes to commit.");

    expect(runCodex).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
    expect(promptForLine).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when no managed AI test suggestions comment exists", async () => {
    const { forge } = createForge([]);

    await expect(
      runPrFixTestsCommand({
        prNumber: 71,
        repoRoot,
        buildCommand: ["pnpm", "build"],
        forge,
        ensureCleanWorkingTree: vi.fn(),
        promptForLine: vi.fn(),
        runCodex: vi.fn(),
        verifyBuild: vi.fn(),
        hasChanges: vi.fn(),
        commitGeneratedChanges: vi.fn(),
      })
    ).rejects.toThrow("No managed AI test suggestions comment was found for PR #71.");

    expect(createPullRequestFixTestsWorkspace).not.toHaveBeenCalled();
    expect(writePullRequestFixTestsWorkspaceFiles).not.toHaveBeenCalled();
  });

  it("fails clearly when the managed AI test suggestions comment cannot be parsed", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- git-ai-test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          "#### Missing Why Field",
          "- Priority: High",
        ].join("\n")
      ),
    ]);

    await expect(
      runPrFixTestsCommand({
        prNumber: 71,
        repoRoot,
        buildCommand: ["pnpm", "build"],
        forge,
        ensureCleanWorkingTree: vi.fn(),
        promptForLine: vi.fn(),
        runCodex: vi.fn(),
        verifyBuild: vi.fn(),
        hasChanges: vi.fn(),
        commitGeneratedChanges: vi.fn(),
      })
    ).rejects.toThrow(
      'Failed to parse the managed AI test suggestions comment for PR #71. Suggestion "Missing Why Field" is missing a Why it matters field.'
    );

    expect(createPullRequestFixTestsWorkspace).not.toHaveBeenCalled();
    expect(writePullRequestFixTestsWorkspaceFiles).not.toHaveBeenCalled();
  });
});
