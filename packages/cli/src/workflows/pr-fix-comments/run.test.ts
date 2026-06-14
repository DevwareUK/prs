import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PullRequestDetails,
  PullRequestReviewComment,
  PullRequestReviewThreadDetails,
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
    url: "https://github.com/DevwareUK/prs/pull/88",
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
    url: "https://github.com/DevwareUK/prs/pull/88#discussion_r501",
    author: "reviewer-a",
    createdAt: "2026-03-18T08:00:00Z",
    updatedAt: "2026-03-18T08:05:00Z",
  };
}

function createForge(
  comments: PullRequestReviewComment[],
  options: {
    threads?: PullRequestReviewThreadDetails[];
    replyToPullRequestReviewThread?: ReturnType<typeof vi.fn>;
    resolvePullRequestReviewThread?: ReturnType<typeof vi.fn>;
  } = {}
): {
  forge: RepositoryForge;
  fetchPullRequestDetails: ReturnType<typeof vi.fn>;
  fetchPullRequestReviewComments: ReturnType<typeof vi.fn>;
  fetchPullRequestReviewThreads: ReturnType<typeof vi.fn>;
  fetchPullRequestChecks: ReturnType<typeof vi.fn>;
} {
  const fetchPullRequestDetails = vi.fn().mockResolvedValue(createPullRequest());
  const fetchPullRequestReviewComments = vi.fn().mockResolvedValue(comments);
  const fetchPullRequestReviewThreads = vi.fn().mockResolvedValue(options.threads ?? []);
  const fetchPullRequestChecks = vi.fn().mockResolvedValue([
    {
      name: "Vitest",
      status: "completed",
      conclusion: "success",
    },
  ]);

  return {
    forge: {
      type: "github",
      isAuthenticated: () => true,
      fetchIssueDetails: vi.fn(),
      fetchIssueComments: vi.fn(),
      fetchIssuePlanComment: vi.fn(),
      fetchAuditComment: vi.fn(),
      fetchPullRequestDetails,
      fetchPullRequestChecks,
      listOpenPullRequestChanges: vi.fn(),
      fetchPullRequestIssueComments: vi.fn(),
      fetchPullRequestReviewComments,
      ...(options.threads === undefined ? {} : { fetchPullRequestReviewThreads }),
      ...(options.replyToPullRequestReviewThread === undefined
        ? {}
        : { replyToPullRequestReviewThread: options.replyToPullRequestReviewThread }),
      ...(options.resolvePullRequestReviewThread === undefined
        ? {}
        : { resolvePullRequestReviewThread: options.resolvePullRequestReviewThread }),
      createIssuePlanComment: vi.fn(),
      createAuditComment: vi.fn(),
      updateIssuePlanComment: vi.fn(),
      updateIssueComment: vi.fn(),
      createDraftIssue: vi.fn(),
      updateIssue: vi.fn(),
      createOrReuseIssue: vi.fn(),
      createPullRequest: vi.fn(),
    },
    fetchPullRequestDetails,
    fetchPullRequestReviewComments,
    fetchPullRequestReviewThreads,
    fetchPullRequestChecks,
  };
}

describe("runPrFixCommentsCommand", () => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-pr-address-comments-"));
  const workspace: PullRequestFixWorkspace = {
    runDir: resolve(repoRoot, ".prs/runs/20260320T112935000Z-pr-88-address-comments"),
    snapshotFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-88-address-comments/pr-review-comments.md"
    ),
    promptFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-88-address-comments/prompt.md"
    ),
    metadataFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-88-address-comments/metadata.json"
    ),
    outputLogPath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-88-address-comments/output.log"
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    rmSync(resolve(repoRoot, ".prs"), { recursive: true, force: true });
    mkdirSync(workspace.runDir, { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === "origin/feat/pr-fix-comments"
      ) {
        return { status: 0, stdout: "head-tip-88\n", stderr: "" } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-list" &&
        args[3] === "origin/feat/pr-fix-comments...HEAD"
      ) {
        return { status: 0, stdout: "0 1\n", stderr: "" } as never;
      }

      return { status: 0, stdout: "", stderr: "" } as never;
    });
    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([
      {
        number: 42,
        title: "Improve PR comment selection",
        body: "Keep the snapshot coherent for Codex.",
        url: "https://github.com/DevwareUK/prs/issues/42",
      },
    ]);
    vi.mocked(createPullRequestFixWorkspace).mockReturnValue(workspace);
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("prepares selected review comment artifacts without launching a runtime", async () => {
    const { forge } = createForge([
      createReviewComment("Guard against an empty comment selection before starting Codex."),
    ]);
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn();
    const commitGeneratedChanges = vi.fn();
    const promptForLine = vi.fn();

    const result = await runPrFixCommentsCommand({
      mode: "prepare",
      selection: "1",
      prNumber: 88,
      repoRoot,
      buildCommand: ["pnpm", "build"],
      ensureVerificationCommandAvailable: vi.fn(),
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch,
        }),
      },
      forge,
      ensureCleanWorkingTree: vi.fn(),
      promptForLine,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });

    expect(result).toEqual({
      status: "ready",
      flow: "pr-address-comments",
      prNumber: 88,
      runDir: workspace.runDir,
      snapshotFilePath: workspace.snapshotFilePath,
      promptFilePath: workspace.promptFilePath,
      metadataFilePath: workspace.metadataFilePath,
      outputLogPath: workspace.outputLogPath,
      selectedCount: 1,
      tokenUsage: {
        artifactFile: resolve(workspace.runDir, "codex-token-usage.json"),
        mode: "pr-token-usage-ledger",
        workflow: {
          name: "pr-address-comments",
          role: "implementer",
          targetPullRequestNumber: 88,
          runDir: workspace.runDir,
        },
        auditPublication: {
          target: "pr",
          prNumber: 88,
          section: "token-usage",
          publishWhen: ["reviewed-updates-pushed"],
        },
      },
      nextAction: "continue-in-current-codex-session",
    });
    expect(writePullRequestFixWorkspaceFiles).toHaveBeenCalled();
    expect(promptForLine).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(verifyBuild).not.toHaveBeenCalled();
    expect(hasChanges).not.toHaveBeenCalled();
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
  });

  it("fetches PR review context, runs the selected runtime, verifies the build, and commits the reviewed message", async () => {
    const { forge, fetchPullRequestDetails, fetchPullRequestReviewComments } = createForge([
      createReviewComment("Guard against an empty comment selection before starting Codex."),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("y");
    const ensureCleanWorkingTree = vi.fn();
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixCommentsCommand({
      prNumber: 88,
      repoRoot,
      buildCommand: ["pnpm", "build"],
      ensureVerificationCommandAvailable: vi.fn(),
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch,
        }),
      },
      forge,
      ensureCleanWorkingTree,
      promptForLine,
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
    expect(launch).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(hasChanges).toHaveBeenCalledWith(repoRoot);
    expect(commitGeneratedChanges).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({
        content: "fix: address PR review comments for #88\n",
        filePath: resolve(workspace.runDir, "commit-message.txt"),
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin", "feat/pr-fix-comments"],
      expect.any(Object)
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:feat/pr-fix-comments"],
      expect.any(Object)
    );
    expect(promptForLine).toHaveBeenNthCalledWith(
      1,
      "Select tasks to address [All|none|1,2,...] (default: All): "
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
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixCommentsCommand({
      prNumber: 88,
      repoRoot,
      buildCommand: ["pnpm", "build"],
      ensureVerificationCommandAvailable: vi.fn(),
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch,
        }),
      },
      forge,
      ensureCleanWorkingTree: vi.fn(),
      promptForLine,
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });

    expect(launch).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(hasChanges).toHaveBeenCalledWith(repoRoot);
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
    expect(
      vi.mocked(spawnSync).mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          (args[0] === "fetch" || args[0] === "push")
      )
    ).toBe(false);
  });

  it("lets the user modify the reviewed commit message before committing", async () => {
    const { forge } = createForge([
      createReviewComment("Guard against an empty comment selection before starting Codex."),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("m").mockResolvedValueOnce("y");
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (command === "git") {
        if (
          Array.isArray(args) &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "head-tip-88\n", stderr: "" } as never;
        }

        if (
          Array.isArray(args) &&
          args[0] === "rev-list" &&
          args[3] === "origin/feat/pr-fix-comments...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" } as never;
        }

        return { status: 0, stdout: "", stderr: "" } as never;
      }

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
      ensureVerificationCommandAvailable: vi.fn(),
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch,
        }),
      },
      forge,
      ensureCleanWorkingTree: vi.fn(),
      promptForLine,
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
    expect(
      vi.mocked(spawnSync).mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          args[0] === "push" &&
          args[2] === "HEAD:feat/pr-fix-comments"
      )
    ).toBe(true);
  });

  it("fails clearly when the PR head branch cannot be fetched from origin before pushing", async () => {
    const { forge } = createForge([
      createReviewComment("Guard against an empty comment selection before starting Codex."),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("y");
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[2] === "feat/pr-fix-comments"
      ) {
        return { status: 1, stdout: "", stderr: "fatal: couldn't find remote ref\n" } as never;
      }

      return { status: 0, stdout: "", stderr: "" } as never;
    });

    await expect(
      runPrFixCommentsCommand({
        prNumber: 88,
        repoRoot,
        buildCommand: ["pnpm", "build"],
        ensureVerificationCommandAvailable: vi.fn(),
        runtime: {
          resolve: () => ({
            displayName: "Codex",
            launch,
          }),
        },
        forge,
        ensureCleanWorkingTree: vi.fn(),
        promptForLine,
        verifyBuild,
        hasChanges,
        commitGeneratedChanges,
      })
    ).rejects.toThrow(
      'Failed to fetch PR head branch "feat/pr-fix-comments" from origin before pushing reviewed updates. This workflow only pushes PR branches that are available as origin/feat/pr-fix-comments. Local commits were kept.'
    );

    expect(commitGeneratedChanges).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({
        content: "fix: address PR review comments for #88\n",
      })
    );
    expect(spawnSync).not.toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:feat/pr-fix-comments"],
      expect.any(Object)
    );
  });

  it("does not reopen old PRS-authored bot threads after a successful fix run", async () => {
    mkdirSync(resolve(repoRoot, ".prs/runs/20260514T120000000Z-pr-88-fix-comments"), {
      recursive: true,
    });
    writeFileSync(
      resolve(
        repoRoot,
        ".prs/runs/20260514T120000000Z-pr-88-fix-comments/addressed-review-comments.json"
      ),
      `${JSON.stringify(
        {
          prNumber: 88,
          completedAt: "2026-05-14T12:00:00.000Z",
          commitSha: "929ffc0",
          verification: {
            status: "passed",
          },
          push: {
            status: "pushed",
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const oldPrsComment = createReviewComment(
      "**High severity, High confidence Migration**\n\nHandle product lookup failures.\n\nWhy this matters: Missing products break imports."
    );
    oldPrsComment.author = "github-actions[bot]";
    oldPrsComment.authorIsBot = true;
    oldPrsComment.createdAt = "2026-05-14T10:00:00.000Z";
    oldPrsComment.updatedAt = "2026-05-14T10:00:00.000Z";
    const { forge, fetchPullRequestReviewThreads, fetchPullRequestChecks } =
      createForge([], {
        threads: [
          {
            threadId: oldPrsComment.id,
            nodeId: "PRRT_kwDO_stale",
            isResolved: false,
            isOutdated: false,
            comments: [oldPrsComment],
          },
        ],
      });
    const launch = vi.fn();

    await expect(
      runPrFixCommentsCommand({
        prNumber: 88,
        repoRoot,
        buildCommand: ["pnpm", "build"],
        ensureVerificationCommandAvailable: vi.fn(),
        runtime: {
          resolve: () => ({
            displayName: "Codex",
            launch,
          }),
        },
        forge,
        ensureCleanWorkingTree: vi.fn(),
        promptForLine: vi.fn(),
        verifyBuild: vi.fn(),
        hasChanges: vi.fn(),
        commitGeneratedChanges: vi.fn(),
      })
    ).rejects.toThrow(
      "No new actionable review comments were found for PR #88; previous PRS comments may need resolving."
    );

    expect(fetchPullRequestReviewThreads).toHaveBeenCalledWith(88);
    expect(fetchPullRequestChecks).toHaveBeenCalledWith(88);
    expect(launch).not.toHaveBeenCalled();
  });

  it("replies to and resolves selected PRS-authored bot threads after a successful fix", async () => {
    const prsComment = createReviewComment(
      "**High severity, High confidence Migration**\n\nHandle media lookup failures.\n\nWhy this matters: Missing media breaks imports."
    );
    prsComment.author = "github-actions[bot]";
    prsComment.authorIsBot = true;
    prsComment.createdAt = "2026-05-14T13:00:00.000Z";
    prsComment.updatedAt = "2026-05-14T13:00:00.000Z";
    const replyToPullRequestReviewThread = vi.fn().mockResolvedValue(undefined);
    const resolvePullRequestReviewThread = vi.fn().mockResolvedValue(undefined);
    const { forge } = createForge([], {
      threads: [
        {
          threadId: prsComment.id,
          nodeId: "PRRT_kwDO_selected",
          isResolved: false,
          isOutdated: false,
          comments: [prsComment],
        },
      ],
      replyToPullRequestReviewThread,
      resolvePullRequestReviewThread,
    });
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("y");
    const launch = vi.fn();

    await runPrFixCommentsCommand({
      prNumber: 88,
      repoRoot,
      buildCommand: ["pnpm", "build"],
      ensureVerificationCommandAvailable: vi.fn(),
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch,
        }),
      },
      forge,
      ensureCleanWorkingTree: vi.fn(),
      promptForLine,
      verifyBuild: vi.fn(),
      hasChanges: vi.fn().mockReturnValue(true),
      commitGeneratedChanges: vi.fn(),
    });

    expect(replyToPullRequestReviewThread).toHaveBeenCalledWith(
      "PRRT_kwDO_selected",
      expect.stringContaining("Addressed by")
    );
    expect(resolvePullRequestReviewThread).toHaveBeenCalledWith("PRRT_kwDO_selected");
  });
});
