import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestDetails, RepositoryForge } from "../../forge";
import type { PullRequestFixFailingTestsWorkspace } from "./types";

vi.mock("./snapshot", () => ({
  fetchLinkedIssuesForPullRequest: vi.fn(),
}));

vi.mock("./workspace", () => ({
  createPullRequestFixFailingTestsWorkspace: vi.fn(),
  writePullRequestFixFailingTestsWorkspaceFiles: vi.fn(),
}));

import { runPrFixFailingTestsCommand } from "./run";
import { fetchLinkedIssuesForPullRequest } from "./snapshot";
import {
  createPullRequestFixFailingTestsWorkspace,
  writePullRequestFixFailingTestsWorkspaceFiles,
} from "./workspace";

function createPullRequest(): PullRequestDetails {
  return {
    number: 95,
    title: "Fix failing PR checks",
    body: "Make the PR green.",
    url: "https://github.com/DevwareUK/prs/pull/95",
    baseRefName: "main",
    headRefName: "feat/pr-failing-tests",
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
    fetchPullRequestChecks: vi.fn(),
    listOpenPullRequestChanges: vi.fn(),
    fetchPullRequestIssueComments: vi.fn(),
    fetchPullRequestReviewComments: vi.fn(),
    createIssuePlanComment: vi.fn(),
    createAuditComment: vi.fn(),
    updateIssuePlanComment: vi.fn(),
    updateIssueComment: vi.fn(),
    createDraftIssue: vi.fn(),
    updateIssue: vi.fn(),
    createOrReuseIssue: vi.fn(),
    createPullRequest: vi.fn(),
  } as RepositoryForge;
}

describe("runPrFixFailingTestsCommand", () => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-pr-fix-tests-"));
  const workspace: PullRequestFixFailingTestsWorkspace = {
    runDir: resolve(repoRoot, ".prs/runs/20260320T112935000Z-pr-95-fix-tests"),
    snapshotFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-95-fix-tests/failing-tests.md"
    ),
    promptFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-95-fix-tests/prompt.md"
    ),
    metadataFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-95-fix-tests/metadata.json"
    ),
    outputLogPath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-95-fix-tests/output.log"
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([]);
    vi.mocked(createPullRequestFixFailingTestsWorkspace).mockReturnValue(workspace);
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("prepares failing test artifacts without launching a runtime", async () => {
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn();
    const commitGeneratedChanges = vi.fn();
    const initialFailure = {
      command: ["pnpm", "test"],
      status: 1,
      stdout: "",
      stderr: "expected true to be false",
    };

    const result = await runPrFixFailingTestsCommand({
      mode: "prepare",
      prNumber: 95,
      repoRoot,
      buildCommand: ["pnpm", "test"],
      ensureVerificationCommandAvailable: vi.fn(),
      runtime: {
        resolve: () => ({
          displayName: "Codex",
          launch,
        }),
      },
      forge: createForge(),
      ensureCleanWorkingTree: vi.fn(),
      captureVerificationFailure: vi.fn().mockReturnValue(initialFailure),
      promptForLine: vi.fn(),
      verifyBuild,
      hasChanges,
      commitGeneratedChanges,
    });

    expect(result).toEqual({
      status: "ready",
      flow: "pr-fix-tests",
      prNumber: 95,
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
          name: "pr-fix-tests",
          role: "tester",
          targetPullRequestNumber: 95,
          runDir: workspace.runDir,
        },
        auditPublication: {
          target: "pr",
          prNumber: 95,
          section: "token-usage",
          publishWhen: ["reviewed-updates-pushed"],
        },
      },
      nextAction: "continue-in-current-codex-session",
    });
    expect(writePullRequestFixFailingTestsWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({ number: 95 }),
      initialFailure,
      workspace,
      ["pnpm", "test"],
      []
    );
    expect(launch).not.toHaveBeenCalled();
    expect(verifyBuild).not.toHaveBeenCalled();
    expect(hasChanges).not.toHaveBeenCalled();
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
  });
});
