import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestDetails, RepositoryForge } from "../../forge";
import type { PullRequestPrepareReviewWorkspace } from "./types";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("./snapshot", () => ({
  fetchLinkedIssuesForPullRequest: vi.fn(),
}));

vi.mock("./workspace", () => ({
  appendPullRequestPrepareReviewWarning: vi.fn(),
  createPullRequestPrepareReviewWorkspace: vi.fn(),
  initializePullRequestPrepareReviewOutputLog: vi.fn(),
  writePullRequestPrepareReviewConflictPrompt: vi.fn(),
  writePullRequestPrepareReviewMetadata: vi.fn(),
  writePullRequestPrepareReviewWorkspaceFiles: vi.fn(),
}));

vi.mock("../../runtime", () => ({
  findTrackedRuntimeSessionById: vi.fn(),
  getInteractiveRuntimeByType: vi.fn(),
  launchUnattendedRuntime: vi.fn(),
}));

vi.mock("../../runtime-change-review", () => ({
  finalizeRuntimeChanges: vi.fn(),
  generateDiffBasedCommitProposal: vi.fn(),
}));

import { runPrPrepareReviewCommand } from "./run";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import {
  appendPullRequestPrepareReviewWarning,
  createPullRequestPrepareReviewWorkspace,
  initializePullRequestPrepareReviewOutputLog,
  writePullRequestPrepareReviewConflictPrompt,
  writePullRequestPrepareReviewMetadata,
  writePullRequestPrepareReviewWorkspaceFiles,
} from "./workspace";
import {
  getInteractiveRuntimeByType,
  launchUnattendedRuntime,
} from "../../runtime";
import {
  finalizeRuntimeChanges,
  generateDiffBasedCommitProposal,
} from "../../runtime-change-review";

const cleanupTargets = new Set<string>();

function createPullRequest(): PullRequestDetails {
  return {
    number: 206,
    title: "Tighten prepare-review follow-up fixes",
    body: "Closes #205\n\nCarry the review follow-up flow through commit proposal generation.",
    url: "https://github.com/DevwareUK/git-ai/pull/206",
    baseRefName: "main",
    headRefName: "feat/prepare-review-follow-up",
  };
}

function createForge(): {
  forge: RepositoryForge;
  fetchPullRequestDetails: ReturnType<typeof vi.fn>;
} {
  const fetchPullRequestDetails = vi.fn().mockResolvedValue(createPullRequest());

  return {
    forge: {
      type: "github",
      isAuthenticated: () => true,
      fetchIssueDetails: vi.fn(),
      fetchIssuePlanComment: vi.fn(),
      fetchPullRequestDetails,
      fetchPullRequestIssueComments: vi.fn(),
      fetchPullRequestReviewComments: vi.fn(),
      createIssuePlanComment: vi.fn(),
      updateIssuePlanComment: vi.fn(),
      createDraftIssue: vi.fn(),
      createOrReuseIssue: vi.fn(),
      createPullRequest: vi.fn(),
    },
    fetchPullRequestDetails,
  };
}

function createWorkspace(repoRoot: string): PullRequestPrepareReviewWorkspace {
  const runDir = resolve(
    repoRoot,
    ".git-ai/runs/20260417T155614124Z-pr-206-prepare-review"
  );
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    snapshotFilePath: resolve(runDir, "pr-review-prepare.md"),
    promptFilePath: resolve(runDir, "prompt.md"),
    conflictPromptFilePath: resolve(runDir, "base-sync-conflict-prompt.md"),
    interactivePromptFilePath: resolve(runDir, "interactive-prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    reviewBriefFilePath: resolve(runDir, "review-brief.md"),
    assistantLastMessageFilePath: resolve(runDir, "assistant-last-message.txt"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();

  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

function createCommandResult(
  status: number,
  output: { stdout?: string; stderr?: string } = {}
) {
  return {
    status,
    stdout: output.stdout ?? "",
    stderr: output.stderr ?? "",
  } as never;
}

function createDefaultCommandOptions(repoRoot: string, forge: RepositoryForge) {
  return {
    prNumber: 206,
    repoRoot,
    buildCommand: ["pnpm", "build"],
    ensureVerificationCommandAvailable: vi.fn(),
    preflightBaseBranch: vi.fn().mockReturnValue({
      remoteRef: "origin/main",
      remoteTip: "abc123base",
    }),
    forge,
    ensureCleanWorkingTree: vi.fn(),
    promptForLine: vi.fn(),
    hasChanges: vi.fn().mockReturnValue(false),
    verifyBuild: vi.fn(),
    commitGeneratedChanges: vi.fn(),
    readDiff: vi.fn(),
    createProvider: vi.fn(),
  };
}

function getGitCommandArgs(): string[][] {
  return vi
    .mocked(spawnSync)
    .mock.calls.filter(([command]) => command === "git")
    .map(([, args]) => args as string[]);
}

describe("runPrPrepareReviewCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("passes a diff-based commit proposal into runtime finalization and pushes an accepted follow-up commit", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-prepare-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    const { forge, fetchPullRequestDetails } = createForge();
    const interactiveLaunch = vi.fn();
    const provider = { name: "openai" } as unknown;
    const createProvider = vi.fn().mockResolvedValue({ provider });
    const readDiff = vi.fn().mockReturnValue("diff --git a/file b/file");
    const verifyBuild = vi.fn();
    const commitGeneratedChanges = vi.fn();

    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestPrepareReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestPrepareReviewOutputLog).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewWorkspaceFiles).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewMetadata).mockImplementation(() => undefined);
    vi.mocked(getInteractiveRuntimeByType).mockReturnValue({
      checkAvailability: () => ({ available: true }),
      launch: interactiveLaunch,
    });
    vi.mocked(launchUnattendedRuntime).mockImplementation(
      (_type, _repoRoot, suppliedWorkspace) => {
        writeFileSync(
          suppliedWorkspace.reviewBriefFilePath,
          "# Reviewer focus\n\n- Inspect the follow-up fix.\n",
          "utf8"
        );

        return {
          invocation: "new",
          sessionId: "codex-session-42",
        };
      }
    );
    vi.mocked(generateDiffBasedCommitProposal).mockResolvedValue({
      diff: "diff --git a/file b/file",
      initialMessage:
        "fix: apply review follow-up changes\n\nKeep the review branch ready for commit.\n",
    });
    vi.mocked(finalizeRuntimeChanges).mockImplementation(async (options) => {
      await expect(options.resolveInitialCommitMessage()).resolves.toBe(
        "fix: apply review follow-up changes\n\nKeep the review branch ready for commit.\n"
      );

      return {
        committed: true,
        commitMessage: {
          content:
            "fix: apply review follow-up changes\n\nKeep the review branch ready for commit.\n",
          filePath: resolve(options.runDir, "commit-message.txt"),
        },
      };
    });
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === createPullRequest().headRefName
      ) {
        return { status: 0 } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === createPullRequest().headRefName
      ) {
        return {
          status: 0,
          stdout: "",
          stderr: "",
        } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().baseRefName
      ) {
        return {
          status: 0,
          stdout: "",
          stderr: "",
        } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().baseRefName}`
      ) {
        return {
          status: 0,
          stdout: "abc123base\n",
          stderr: "",
        } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor" &&
        args[2] === "abc123base" &&
        args[3] === "HEAD"
      ) {
        return {
          status: 0,
          stdout: "",
          stderr: "",
        } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0, { stdout: "def456head\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-list" &&
        args[1] === "--left-right" &&
        args[2] === "--count" &&
        args[3] === `origin/${createPullRequest().headRefName}...HEAD`
      ) {
        return createCommandResult(0, { stdout: "0 1\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "push" &&
        args[1] === "origin" &&
        args[2] === `HEAD:${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0);
      }

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await runPrPrepareReviewCommand({
      prNumber: 206,
      repoRoot,
      buildCommand: ["pnpm", "build"],
      ensureVerificationCommandAvailable: vi.fn(),
      preflightBaseBranch: vi.fn().mockReturnValue({
        remoteRef: "origin/main",
        remoteTip: "abc123base",
      }),
      forge,
      ensureCleanWorkingTree: vi.fn(),
      promptForLine: vi.fn(),
      hasChanges: vi.fn().mockReturnValue(true),
      verifyBuild,
      commitGeneratedChanges,
      readDiff,
      createProvider,
    });

    expect(fetchPullRequestDetails).toHaveBeenCalledWith(206);
    expect(createPullRequestPrepareReviewWorkspace).toHaveBeenCalledWith(repoRoot, 206);
    expect(launchUnattendedRuntime).toHaveBeenCalledWith("codex", repoRoot, workspace, {
      resumeSessionId: undefined,
      outputLastMessageFilePath: workspace.assistantLastMessageFilePath,
    });
    expect(writePullRequestPrepareReviewWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        baseSync: expect.objectContaining({
          status: "up-to-date",
          remoteRef: "origin/main",
          baseTip: "abc123base",
        }),
      }),
      ["pnpm", "build"]
    );
    expect(interactiveLaunch).toHaveBeenCalledWith(
      repoRoot,
      {
        promptFilePath: workspace.interactivePromptFilePath,
        outputLogPath: workspace.outputLogPath,
      },
      {
        resumeSessionId: "codex-session-42",
      }
    );
    expect(finalizeRuntimeChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot,
        runDir: workspace.runDir,
        commitPrompt: "Commit generated changes with this message? [Y/n/m]: ",
        promptForLine: expect.any(Function),
        hasChanges: expect.any(Function),
        commitGeneratedChanges,
        noChangesMessage:
          "Codex exited without producing any file changes to review or commit.",
        noChangesAction: "return",
        checkForChangesBeforeBuild: true,
        verifyBuild: {
          buildCommand: ["pnpm", "build"],
          outputLogPath: workspace.outputLogPath,
          run: verifyBuild,
        },
      })
    );
    expect(createProvider).toHaveBeenCalledWith(repoRoot);
    expect(generateDiffBasedCommitProposal).toHaveBeenCalledWith(
      repoRoot,
      provider,
      readDiff
    );
    expect(getGitCommandArgs()).toContainEqual([
      "push",
      "origin",
      `HEAD:${createPullRequest().headRefName}`,
    ]);
  });

  it("skips merging when the checked-out branch already contains the fetched base tip", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-prepare-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    const { forge } = createForge();
    const interactiveLaunch = vi.fn();

    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestPrepareReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestPrepareReviewOutputLog).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewWorkspaceFiles).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewMetadata).mockImplementation(() => undefined);
    vi.mocked(getInteractiveRuntimeByType).mockReturnValue({
      checkAvailability: () => ({ available: true }),
      launch: interactiveLaunch,
    });
    vi.mocked(launchUnattendedRuntime).mockImplementation(
      (_type, _repoRoot, suppliedWorkspace) => {
        writeFileSync(
          suppliedWorkspace.reviewBriefFilePath,
          "# Reviewer focus\n\n- Inspect the synced review branch.\n",
          "utf8"
        );

        return {
          invocation: "new",
          sessionId: "codex-session-up-to-date",
        };
      }
    );
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().baseRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().baseRefName}`
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor" &&
        args[2] === "abc123base" &&
        args[3] === "HEAD"
      ) {
        return createCommandResult(0);
      }

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await runPrPrepareReviewCommand(createDefaultCommandOptions(repoRoot, forge));

    expect(getGitCommandArgs()).not.toContainEqual([
      "merge",
      "--no-edit",
      "--no-ff",
      "origin/main",
    ]);
    expect(writePullRequestPrepareReviewWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        checkoutTarget: {
          source: "local-head",
          branchName: createPullRequest().headRefName,
        },
        baseSync: expect.objectContaining({
          status: "up-to-date",
          conflictResolution: "not-needed",
          remoteRef: "origin/main",
          baseTip: "abc123base",
        }),
      }),
      ["pnpm", "build"]
    );
    expect(writePullRequestPrepareReviewMetadata).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        baseSync: expect.objectContaining({
          status: "up-to-date",
          summary: expect.stringContaining("already contained origin/main tip abc123base"),
        }),
      }),
      expect.objectContaining({
        invocation: "new",
      })
    );
    expect(writePullRequestPrepareReviewConflictPrompt).not.toHaveBeenCalled();
  });

  it("creates a fetched review branch and merges the latest base tip before generating the brief", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-prepare-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    const { forge } = createForge();
    const interactiveLaunch = vi.fn();
    const fetchedBranchName = "review/pr-206-tighten-prepare-review-follow-up-fixes";

    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestPrepareReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestPrepareReviewOutputLog).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewWorkspaceFiles).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewMetadata).mockImplementation(() => undefined);
    vi.mocked(getInteractiveRuntimeByType).mockReturnValue({
      checkAvailability: () => ({ available: true }),
      launch: interactiveLaunch,
    });
    vi.mocked(launchUnattendedRuntime).mockImplementation(
      (_type, _repoRoot, suppliedWorkspace) => {
        writeFileSync(
          suppliedWorkspace.reviewBriefFilePath,
          "# Reviewer focus\n\n- Inspect the merged base sync.\n",
          "utf8"
        );

        return {
          invocation: "new",
          sessionId: "codex-session-merged",
        };
      }
    );
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === createPullRequest().headRefName
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === fetchedBranchName
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === `pull/206/head:${fetchedBranchName}`
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === fetchedBranchName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().baseRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().baseRefName}`
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor" &&
        args[2] === "abc123base" &&
        args[3] === "HEAD"
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge" &&
        args[1] === "--no-edit" &&
        args[2] === "--no-ff" &&
        args[3] === "origin/main"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0, { stdout: "def456head\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-list" &&
        args[1] === "--left-right" &&
        args[2] === "--count" &&
        args[3] === `origin/${createPullRequest().headRefName}...HEAD`
      ) {
        return createCommandResult(0, { stdout: "0 1\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "push" &&
        args[1] === "origin" &&
        args[2] === `HEAD:${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0);
      }

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await runPrPrepareReviewCommand(createDefaultCommandOptions(repoRoot, forge));

    expect(getGitCommandArgs()).toEqual([
      ["-C", repoRoot, "rev-parse", "--verify", createPullRequest().headRefName],
      ["-C", repoRoot, "rev-parse", "--verify", fetchedBranchName],
      ["fetch", "origin", `pull/206/head:${fetchedBranchName}`],
      ["checkout", fetchedBranchName],
      ["fetch", "origin", "main"],
      ["rev-parse", "origin/main"],
      ["merge-base", "--is-ancestor", "abc123base", "HEAD"],
      ["merge", "--no-edit", "--no-ff", "origin/main"],
      ["fetch", "origin", createPullRequest().headRefName],
      ["rev-parse", `origin/${createPullRequest().headRefName}`],
      [
        "rev-list",
        "--left-right",
        "--count",
        `origin/${createPullRequest().headRefName}...HEAD`,
      ],
      ["push", "origin", `HEAD:${createPullRequest().headRefName}`],
    ]);
    expect(writePullRequestPrepareReviewWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        checkoutTarget: {
          source: "fetched-review",
          branchName: fetchedBranchName,
          headRefName: createPullRequest().headRefName,
        },
        baseSync: expect.objectContaining({
          status: "merged",
          conflictResolution: "not-needed",
          remoteRef: "origin/main",
          baseTip: "abc123base",
        }),
      }),
      ["pnpm", "build"]
    );
    expect(launchUnattendedRuntime).toHaveBeenCalledOnce();
    expect(writePullRequestPrepareReviewConflictPrompt).not.toHaveBeenCalled();
  });

  it("pushes a merge-only fetched review branch back to the real PR head branch", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-prepare-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    const { forge } = createForge();
    const interactiveLaunch = vi.fn();
    const fetchedBranchName = "review/pr-206-tighten-prepare-review-follow-up-fixes";

    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestPrepareReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestPrepareReviewOutputLog).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewWorkspaceFiles).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewMetadata).mockImplementation(() => undefined);
    vi.mocked(getInteractiveRuntimeByType).mockReturnValue({
      checkAvailability: () => ({ available: true }),
      launch: interactiveLaunch,
    });
    vi.mocked(launchUnattendedRuntime).mockImplementation(
      (_type, _repoRoot, suppliedWorkspace) => {
        writeFileSync(
          suppliedWorkspace.reviewBriefFilePath,
          "# Reviewer focus\n\n- Inspect the merged base sync.\n",
          "utf8"
        );

        return {
          invocation: "new",
          sessionId: "codex-session-merge-only-push",
        };
      }
    );
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === createPullRequest().headRefName
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === fetchedBranchName
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === `pull/206/head:${fetchedBranchName}`
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === fetchedBranchName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().baseRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().baseRefName}`
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor" &&
        args[2] === "abc123base" &&
        args[3] === "HEAD"
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge" &&
        args[1] === "--no-edit" &&
        args[2] === "--no-ff" &&
        args[3] === "origin/main"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0, { stdout: "def456head\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-list" &&
        args[1] === "--left-right" &&
        args[2] === "--count" &&
        args[3] === `origin/${createPullRequest().headRefName}...HEAD`
      ) {
        return createCommandResult(0, { stdout: "0 1\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "push" &&
        args[1] === "origin" &&
        args[2] === `HEAD:${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0);
      }

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await runPrPrepareReviewCommand(createDefaultCommandOptions(repoRoot, forge));

    expect(getGitCommandArgs()).toContainEqual([
      "push",
      "origin",
      `HEAD:${createPullRequest().headRefName}`,
    ]);
    expect(getGitCommandArgs()).not.toContainEqual([
      "push",
      "origin",
      `HEAD:${fetchedBranchName}`,
    ]);
  });

  it("does not push when prepare-review exits without workflow-created commits", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-prepare-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    const { forge } = createForge();
    const interactiveLaunch = vi.fn();

    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestPrepareReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestPrepareReviewOutputLog).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewWorkspaceFiles).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewMetadata).mockImplementation(() => undefined);
    vi.mocked(getInteractiveRuntimeByType).mockReturnValue({
      checkAvailability: () => ({ available: true }),
      launch: interactiveLaunch,
    });
    vi.mocked(launchUnattendedRuntime).mockImplementation(
      (_type, _repoRoot, suppliedWorkspace) => {
        writeFileSync(
          suppliedWorkspace.reviewBriefFilePath,
          "# Reviewer focus\n\n- Inspect the synced review branch.\n",
          "utf8"
        );

        return {
          invocation: "new",
          sessionId: "codex-session-no-push",
        };
      }
    );
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().baseRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().baseRefName}`
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor" &&
        args[2] === "abc123base" &&
        args[3] === "HEAD"
      ) {
        return createCommandResult(0);
      }

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await runPrPrepareReviewCommand(createDefaultCommandOptions(repoRoot, forge));

    expect(
      getGitCommandArgs().some((args) => args[0] === "push" || args[0] === "rev-list")
    ).toBe(false);
  });

  it("fails clearly when pushing reviewed updates back to the PR branch fails", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-prepare-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    const { forge } = createForge();
    const interactiveLaunch = vi.fn();

    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestPrepareReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestPrepareReviewOutputLog).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewWorkspaceFiles).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewMetadata).mockImplementation(() => undefined);
    vi.mocked(getInteractiveRuntimeByType).mockReturnValue({
      checkAvailability: () => ({ available: true }),
      launch: interactiveLaunch,
    });
    vi.mocked(launchUnattendedRuntime).mockImplementation(
      (_type, _repoRoot, suppliedWorkspace) => {
        writeFileSync(
          suppliedWorkspace.reviewBriefFilePath,
          "# Reviewer focus\n\n- Inspect the merged base sync.\n",
          "utf8"
        );

        return {
          invocation: "new",
          sessionId: "codex-session-push-failure",
        };
      }
    );
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().baseRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().baseRefName}`
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor" &&
        args[2] === "abc123base" &&
        args[3] === "HEAD"
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge" &&
        args[1] === "--no-edit" &&
        args[2] === "--no-ff" &&
        args[3] === "origin/main"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0, { stdout: "def456head\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-list" &&
        args[1] === "--left-right" &&
        args[2] === "--count" &&
        args[3] === `origin/${createPullRequest().headRefName}...HEAD`
      ) {
        return createCommandResult(0, { stdout: "0 1\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "push" &&
        args[1] === "origin" &&
        args[2] === `HEAD:${createPullRequest().headRefName}`
      ) {
        return createCommandResult(1, { stderr: "remote rejected\n" });
      }

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await expect(
      runPrPrepareReviewCommand(createDefaultCommandOptions(repoRoot, forge))
    ).rejects.toThrow(
      `Failed to push reviewed updates to origin/${createPullRequest().headRefName}. Local commits were kept.`
    );
  });

  it("opens a conflict-resolution Codex session and continues once the base sync is resolved", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-prepare-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    const { forge } = createForge();
    const interactiveLaunch = vi.fn();
    let mergeBaseChecks = 0;
    let mergeHeadChecks = 0;
    let unmergedDiffChecks = 0;

    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestPrepareReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestPrepareReviewOutputLog).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewWorkspaceFiles).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewMetadata).mockImplementation(() => undefined);
    vi.mocked(getInteractiveRuntimeByType).mockReturnValue({
      checkAvailability: () => ({ available: true }),
      launch: interactiveLaunch,
    });
    vi.mocked(launchUnattendedRuntime).mockImplementation(
      (_type, _repoRoot, suppliedWorkspace) => {
        writeFileSync(
          suppliedWorkspace.reviewBriefFilePath,
          "# Reviewer focus\n\n- Inspect the resolved merge conflicts.\n",
          "utf8"
        );

        return {
          invocation: "new",
          sessionId: "codex-session-resolved-conflicts",
        };
      }
    );
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().baseRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().baseRefName}`
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor" &&
        args[2] === "abc123base" &&
        args[3] === "HEAD"
      ) {
        mergeBaseChecks += 1;
        return createCommandResult(mergeBaseChecks === 1 ? 1 : 0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge" &&
        args[1] === "--no-edit" &&
        args[2] === "--no-ff" &&
        args[3] === "origin/main"
      ) {
        return createCommandResult(1, { stderr: "CONFLICT (content): Merge conflict in src/conflict.ts\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === "-q" &&
        args[2] === "--verify" &&
        args[3] === "MERGE_HEAD"
      ) {
        mergeHeadChecks += 1;
        return createCommandResult(mergeHeadChecks === 1 ? 0 : 1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "diff" &&
        args[1] === "--name-only" &&
        args[2] === "--diff-filter=U"
      ) {
        unmergedDiffChecks += 1;
        return createCommandResult(0, {
          stdout: unmergedDiffChecks === 1 ? "src/conflict.ts\n" : "",
        });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0, { stdout: "def456head\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-list" &&
        args[1] === "--left-right" &&
        args[2] === "--count" &&
        args[3] === `origin/${createPullRequest().headRefName}...HEAD`
      ) {
        return createCommandResult(0, { stdout: "0 1\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "push" &&
        args[1] === "origin" &&
        args[2] === `HEAD:${createPullRequest().headRefName}`
      ) {
        return createCommandResult(0);
      }

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await runPrPrepareReviewCommand(createDefaultCommandOptions(repoRoot, forge));

    expect(writePullRequestPrepareReviewConflictPrompt).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        branchName: createPullRequest().headRefName,
        baseSync: expect.objectContaining({
          status: "blocked",
          conflictResolution: "required",
          baseTip: "abc123base",
        }),
      })
    );
    expect(appendPullRequestPrepareReviewWarning).toHaveBeenNthCalledWith(
      1,
      workspace,
      expect.stringContaining("produced conflicts")
    );
    expect(appendPullRequestPrepareReviewWarning).toHaveBeenNthCalledWith(
      2,
      workspace,
      expect.stringContaining("Codex resolved the merge conflicts")
    );
    expect(interactiveLaunch).toHaveBeenNthCalledWith(
      1,
      repoRoot,
      {
        promptFilePath: workspace.conflictPromptFilePath,
        outputLogPath: workspace.outputLogPath,
      }
    );
    expect(interactiveLaunch).toHaveBeenNthCalledWith(
      2,
      repoRoot,
      {
        promptFilePath: workspace.interactivePromptFilePath,
        outputLogPath: workspace.outputLogPath,
      },
      {
        resumeSessionId: "codex-session-resolved-conflicts",
      }
    );
    expect(writePullRequestPrepareReviewWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        baseSync: expect.objectContaining({
          status: "merged",
          conflictResolution: "required",
          warnings: [
            expect.stringContaining("produced conflicts"),
            expect.stringContaining("resolved the merge conflicts"),
          ],
        }),
      }),
      ["pnpm", "build"]
    );
  });

  it("fails clearly and records blocked artifacts when merge conflicts remain unresolved", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-prepare-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    const { forge } = createForge();
    const interactiveLaunch = vi.fn();
    let mergeBaseChecks = 0;
    let mergeHeadChecks = 0;
    let unmergedDiffChecks = 0;

    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestPrepareReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestPrepareReviewOutputLog).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewWorkspaceFiles).mockImplementation(
      () => undefined
    );
    vi.mocked(writePullRequestPrepareReviewMetadata).mockImplementation(() => undefined);
    vi.mocked(getInteractiveRuntimeByType).mockReturnValue({
      checkAvailability: () => ({ available: true }),
      launch: interactiveLaunch,
    });
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify" &&
        args[4] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === createPullRequest().headRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === createPullRequest().baseRefName
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === `origin/${createPullRequest().baseRefName}`
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor" &&
        args[2] === "abc123base" &&
        args[3] === "HEAD"
      ) {
        mergeBaseChecks += 1;
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge" &&
        args[1] === "--no-edit" &&
        args[2] === "--no-ff" &&
        args[3] === "origin/main"
      ) {
        return createCommandResult(1, { stderr: "CONFLICT (content): Merge conflict in src/conflict.ts\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === "-q" &&
        args[2] === "--verify" &&
        args[3] === "MERGE_HEAD"
      ) {
        mergeHeadChecks += 1;
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "diff" &&
        args[1] === "--name-only" &&
        args[2] === "--diff-filter=U"
      ) {
        unmergedDiffChecks += 1;
        return createCommandResult(0, { stdout: "src/conflict.ts\n" });
      }

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await expect(
      runPrPrepareReviewCommand(createDefaultCommandOptions(repoRoot, forge))
    ).rejects.toThrow(
      'Base-branch sync is still incomplete for "feat/prepare-review-follow-up".'
    );

    expect(mergeBaseChecks).toBe(2);
    expect(mergeHeadChecks).toBe(2);
    expect(unmergedDiffChecks).toBe(2);
    expect(interactiveLaunch).toHaveBeenCalledTimes(1);
    expect(interactiveLaunch).toHaveBeenCalledWith(repoRoot, {
      promptFilePath: workspace.conflictPromptFilePath,
      outputLogPath: workspace.outputLogPath,
    });
    expect(launchUnattendedRuntime).not.toHaveBeenCalled();
    expect(appendPullRequestPrepareReviewWarning).toHaveBeenNthCalledWith(
      1,
      workspace,
      expect.stringContaining("produced conflicts")
    );
    expect(appendPullRequestPrepareReviewWarning).toHaveBeenNthCalledWith(
      2,
      workspace,
      expect.stringContaining("Base-branch sync is still incomplete")
    );
    expect(writePullRequestPrepareReviewWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        baseSync: expect.objectContaining({
          status: "blocked",
          conflictResolution: "unresolved",
          recoveryMessage: expect.stringContaining(
            "After fixing the branch state, rerun `git-ai pr prepare-review 206`."
          ),
        }),
      }),
      ["pnpm", "build"]
    );
    expect(writePullRequestPrepareReviewMetadata).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        baseSync: expect.objectContaining({
          status: "blocked",
          conflictResolution: "unresolved",
        }),
      }),
      expect.objectContaining({
        invocation: "new",
      })
    );
  });
});
