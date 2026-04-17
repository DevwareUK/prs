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
  createPullRequestPrepareReviewWorkspace,
  initializePullRequestPrepareReviewOutputLog,
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

describe("runPrPrepareReviewCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("passes a diff-based commit proposal into runtime finalization after interactive follow-up changes", async () => {
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

      throw new Error(`Unexpected spawnSync call: ${command} ${String(args)}`);
    });

    await runPrPrepareReviewCommand({
      prNumber: 206,
      repoRoot,
      buildCommand: ["pnpm", "build"],
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
  });
});
