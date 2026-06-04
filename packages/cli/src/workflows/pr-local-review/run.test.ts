import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestDetails, RepositoryForge } from "../../forge";
import type { PullRequestLocalReviewWorkspace } from "./types";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("../pr-prepare-review/snapshot", () => ({
  fetchLinkedIssuesForPullRequest: vi.fn(),
}));

vi.mock("./workspace", () => ({
  appendPullRequestLocalReviewWarning: vi.fn(),
  createPullRequestLocalReviewWorkspace: vi.fn(),
  initializePullRequestLocalReviewOutputLog: vi.fn(),
  writePullRequestLocalReviewConflictPrompt: vi.fn(),
  writePullRequestLocalReviewMetadata: vi.fn(),
  writePullRequestLocalReviewWorkspaceFiles: vi.fn(),
}));

import { preparePullRequestLocalReviewTool } from "./run";
import { fetchLinkedIssuesForPullRequest } from "../pr-prepare-review/snapshot";
import {
  appendPullRequestLocalReviewWarning,
  createPullRequestLocalReviewWorkspace,
  initializePullRequestLocalReviewOutputLog,
  writePullRequestLocalReviewConflictPrompt,
  writePullRequestLocalReviewMetadata,
  writePullRequestLocalReviewWorkspaceFiles,
} from "./workspace";

const cleanupTargets = new Set<string>();

function createPullRequest(): PullRequestDetails {
  return {
    number: 224,
    title: "Improve dashboard filters",
    body: "Closes #223\n\nAdds local filter controls.",
    url: "https://github.com/DevwareUK/prs/pull/224",
    baseRefName: "main",
    headRefName: "feature/dashboard-filters",
  };
}

function createForge(): RepositoryForge {
  return {
    type: "github",
    isAuthenticated: () => true,
    fetchIssueDetails: vi.fn(),
    fetchIssueComments: vi.fn(),
    fetchIssuePlanComment: vi.fn(),
    fetchAuditComment: vi.fn(),
    fetchPullRequestDetails: vi.fn().mockResolvedValue(createPullRequest()),
    fetchPullRequestChecks: vi.fn().mockResolvedValue([
      { name: "test", status: "completed", conclusion: "success" },
    ]),
    listOpenPullRequestChanges: vi.fn(),
    fetchPullRequestIssueComments: vi.fn().mockResolvedValue([
      {
        id: 10,
        body: "Please verify empty filter state.",
        url: "https://github.com/DevwareUK/prs/pull/224#issuecomment-10",
        author: "reviewer",
        isBot: false,
        createdAt: "2026-05-20T10:00:00Z",
        updatedAt: "2026-05-20T10:00:00Z",
      },
    ]),
    fetchPullRequestReviewComments: vi.fn().mockResolvedValue([
      {
        id: 20,
        body: "This branch may skip null filters.",
        path: "src/filter.ts",
        line: 12,
        url: "https://github.com/DevwareUK/prs/pull/224#discussion_r20",
        author: "reviewer",
        createdAt: "2026-05-20T11:00:00Z",
        updatedAt: "2026-05-20T11:00:00Z",
      },
    ]),
    createIssuePlanComment: vi.fn(),
    createAuditComment: vi.fn(),
    updateIssuePlanComment: vi.fn(),
    updateIssueComment: vi.fn(),
    createDraftIssue: vi.fn(),
    updateIssue: vi.fn(),
    createOrReuseIssue: vi.fn(),
    createPullRequest: vi.fn(),
  };
}

function createWorkspace(repoRoot: string): PullRequestLocalReviewWorkspace {
  const runDir = resolve(repoRoot, ".prs/runs/20260521T100000000Z-pr-224-review");
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    snapshotFilePath: resolve(runDir, "pr-review-context.md"),
    promptFilePath: resolve(runDir, "prompt.md"),
    conflictPromptFilePath: resolve(runDir, "base-sync-conflict-prompt.md"),
    interactivePromptFilePath: resolve(runDir, "interactive-prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    reviewBriefFilePath: resolve(runDir, "codex-pr-review.md"),
    assistantLastMessageFilePath: resolve(runDir, "assistant-last-message.txt"),
    contextFilePath: resolve(runDir, "pr-review-context.md"),
    reportFilePath: resolve(runDir, "codex-pr-review.md"),
    commentsFilePath: resolve(runDir, "codex-pr-review-comments.json"),
  };
}

function createCommandResult(status: number, output: { stdout?: string; stderr?: string } = {}) {
  return {
    status,
    stdout: output.stdout ?? "",
    stderr: output.stderr ?? "",
  } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

describe("preparePullRequestLocalReviewTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("prepares a Codex review report context without launching a runtime", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-pr-local-review-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestLocalReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestLocalReviewOutputLog).mockImplementation(() => undefined);
    vi.mocked(writePullRequestLocalReviewWorkspaceFiles).mockImplementation(() => undefined);
    vi.mocked(writePullRequestLocalReviewMetadata).mockImplementation(() => undefined);

    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify"
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === "pull/224/head:review/pr-224-improve-dashboard-filters"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout" &&
        args[1] === "review/pr-224-improve-dashboard-filters"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch" &&
        args[1] === "origin" &&
        args[2] === "main"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === "origin/main"
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "diff" &&
        args[1] === "--name-only"
      ) {
        return createCommandResult(0, { stdout: "src/filter.ts\nREADME.md\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "diff" &&
        args[1] === "--unified=80"
      ) {
        return createCommandResult(0, {
          stdout: "diff --git a/src/filter.ts b/src/filter.ts\n+applyFilter();\n",
        });
      }

      return createCommandResult(0);
    });

    const result = await preparePullRequestLocalReviewTool({
      prNumber: 224,
      repoRoot,
      buildCommand: ["pnpm", "test"],
      ensureVerificationCommandAvailable: vi.fn(),
      preflightBaseBranch: vi.fn().mockReturnValue({
        remoteRef: "origin/main",
        remoteTip: "abc123base",
      }),
      forge: createForge(),
      ensureCleanWorkingTree: vi.fn(),
    });

    expect(result).toMatchObject({
      status: "ready",
      prNumber: 224,
      contextFilePath: workspace.contextFilePath,
      promptFilePath: workspace.promptFilePath,
      outputLogPath: workspace.outputLogPath,
      reportFilePath: workspace.reportFilePath,
      commentsFilePath: workspace.commentsFilePath,
      nextAction: "write-codex-pr-review-report",
      changedFiles: ["src/filter.ts", "README.md"],
    });
    expect(writePullRequestLocalReviewWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        changedFiles: ["src/filter.ts", "README.md"],
        diff: "diff --git a/src/filter.ts b/src/filter.ts\n+applyFilter();\n",
        checks: { status: "available", items: expect.any(Array) },
        issueComments: { status: "available", items: expect.any(Array) },
        reviewComments: { status: "available", items: expect.any(Array) },
      }),
      ["pnpm", "test"],
      { outputMode: "manual" }
    );
    expect(writePullRequestLocalReviewMetadata).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        flow: "pr-review",
        reportFilePath: workspace.reportFilePath,
        commentsFilePath: workspace.commentsFilePath,
      })
    );
  });

  it("returns blocked artifacts when base sync has merge conflicts", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-pr-local-review-blocked-"));
    cleanupTargets.add(repoRoot);

    const workspace = createWorkspace(repoRoot);
    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestLocalReviewWorkspace).mockReturnValue(workspace);
    vi.mocked(initializePullRequestLocalReviewOutputLog).mockImplementation(() => undefined);
    vi.mocked(appendPullRequestLocalReviewWarning).mockImplementation(() => undefined);
    vi.mocked(writePullRequestLocalReviewConflictPrompt).mockImplementation(() => undefined);
    vi.mocked(writePullRequestLocalReviewWorkspaceFiles).mockImplementation(() => undefined);
    vi.mocked(writePullRequestLocalReviewMetadata).mockImplementation(() => undefined);

    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "-C" &&
        args[1] === repoRoot &&
        args[2] === "rev-parse" &&
        args[3] === "--verify"
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "fetch"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "checkout"
      ) {
        return createCommandResult(0);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === "origin/main"
      ) {
        return createCommandResult(0, { stdout: "abc123base\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge-base" &&
        args[1] === "--is-ancestor"
      ) {
        return createCommandResult(1);
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "merge"
      ) {
        return createCommandResult(1, { stderr: "CONFLICT (content): src/filter.ts\n" });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === "--git-path" &&
        args[2] === "MERGE_HEAD"
      ) {
        return createCommandResult(0, { stdout: resolve(repoRoot, ".git/MERGE_HEAD") });
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "ls-files" &&
        args[1] === "-u"
      ) {
        return createCommandResult(0, { stdout: "100644 abc 1\tsrc/filter.ts\n" });
      }

      return createCommandResult(0);
    });

    const result = await preparePullRequestLocalReviewTool({
      prNumber: 224,
      repoRoot,
      buildCommand: ["pnpm", "test"],
      ensureVerificationCommandAvailable: vi.fn(),
      preflightBaseBranch: vi.fn().mockReturnValue({
        remoteRef: "origin/main",
        remoteTip: "abc123base",
      }),
      forge: createForge(),
      ensureCleanWorkingTree: vi.fn(),
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "merge-conflicts",
      prNumber: 224,
      conflictPromptFilePath: workspace.conflictPromptFilePath,
      reportFilePath: workspace.reportFilePath,
      commentsFilePath: workspace.commentsFilePath,
      nextAction: "resolve-conflicts-in-current-codex-session",
    });
    expect(writePullRequestLocalReviewConflictPrompt).toHaveBeenCalledWith(
      repoRoot,
      workspace,
      expect.objectContaining({
        branchName: "review/pr-224-improve-dashboard-filters",
        baseSync: expect.objectContaining({ status: "blocked" }),
      })
    );
  });
});
