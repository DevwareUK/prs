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
    url: "https://github.com/DevwareUK/prs/pull/71#issuecomment-801",
    createdAt: "2026-03-20T11:00:00Z",
    updatedAt: "2026-03-20T11:29:35Z",
    author: "github-actions[bot]",
    isBot: true,
  };
}

function buildSuggestionBlock(options: {
  title: string;
  priority: "High" | "Medium" | "Low";
  value: string;
  addressed?: boolean;
  testType?: string;
  behavior?: string;
  regressionRisk?: string;
  protectedPaths?: string[];
  likelyLocations?: string[];
  edgeCases?: string[];
  implementationNote?: string;
}): string[] {
  const lines = [
    `#### ${options.title}`,
    ...(options.addressed === undefined
      ? []
      : [`- [${options.addressed ? "x" : " "}] Addressed`]),
    `- Priority: ${options.priority}`,
    `- Test type: ${options.testType ?? "integration"}`,
    `- Behavior covered: ${options.behavior ?? `${options.title} should remain covered.`}`,
    `- Regression risk: ${options.regressionRisk ?? `${options.title} can regress without targeted tests.`}`,
    `- Why it matters: ${options.value}`,
  ];

  if (options.protectedPaths?.length) {
    lines.push(
      `- Protected paths: ${options.protectedPaths
        .map((path) => `\`${path}\``)
        .join(", ")}`
    );
  }

  if (options.likelyLocations?.length) {
    lines.push(
      `- Likely locations: ${options.likelyLocations
        .map((path) => `\`${path}\``)
        .join(", ")}`
    );
  }

  if (options.edgeCases?.length) {
    lines.push("- Edge cases:");
    lines.push(...options.edgeCases.map((edgeCase) => `  - ${edgeCase}`));
  }

  lines.push(
    `- Implementation note: ${
      options.implementationNote ?? `Add or update tests for ${options.title.toLowerCase()}.`
    }`
  );

  return lines;
}

function createPullRequest(): PullRequestDetails {
  return {
    number: 71,
    title: "Add prs pr fix-tests",
    body: "Closes #70\n\nImplement managed AI test suggestion handoff.",
    url: "https://github.com/DevwareUK/prs/pull/71",
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
  updateIssueComment: ReturnType<typeof vi.fn>;
} {
  const fetchPullRequestDetails = vi.fn().mockResolvedValue(createPullRequest());
  const fetchPullRequestIssueComments = vi.fn().mockResolvedValue(comments);
  const updateIssueComment = vi.fn().mockResolvedValue({
    id: 801,
    body: "updated",
    url: "https://github.com/DevwareUK/prs/pull/71#issuecomment-801",
    createdAt: "2026-03-20T11:00:00Z",
    updatedAt: "2026-03-20T11:40:00Z",
    author: "github-actions[bot]",
    isBot: true,
  });

  return {
    forge: {
      type: "github",
      isAuthenticated: () => true,
      fetchIssueDetails: vi.fn(),
      fetchIssueComments: vi.fn(),
      fetchIssuePlanComment: vi.fn(),
      fetchAuditComment: vi.fn(),
      fetchPullRequestDetails,
      fetchPullRequestChecks: vi.fn(),
      listOpenPullRequestChanges: vi.fn(),
      fetchPullRequestIssueComments,
      fetchPullRequestReviewComments: vi.fn(),
      createIssuePlanComment: vi.fn(),
      createAuditComment: vi.fn(),
      updateIssuePlanComment: vi.fn(),
      createDraftIssue: vi.fn(),
      updateIssue: vi.fn(),
      createOrReuseIssue: vi.fn(),
      createPullRequest: vi.fn(),
      updateIssueComment,
    } as RepositoryForge,
    fetchPullRequestDetails,
    fetchPullRequestIssueComments,
    updateIssueComment,
  };
}

describe("runPrFixTestsCommand", () => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-pr-fix-tests-"));
  const workspace: PullRequestFixTestsWorkspace = {
    runDir: resolve(repoRoot, ".prs/runs/20260320T112935000Z-pr-71-add-tests"),
    snapshotFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-71-add-tests/pr-test-suggestions.md"
    ),
    promptFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-71-add-tests/prompt.md"
    ),
    metadataFilePath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-71-add-tests/metadata.json"
    ),
    outputLogPath: resolve(
      repoRoot,
      ".prs/runs/20260320T112935000Z-pr-71-add-tests/output.log"
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === "HEAD"
      ) {
        return { status: 0, stdout: "accepted-head-sha\n", stderr: "" } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-parse" &&
        args[1] === "origin/feat/pr-fix-tests"
      ) {
        return { status: 0, stdout: "head-tip-71\n", stderr: "" } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-list" &&
        args[3] === "origin/feat/pr-fix-tests...HEAD"
      ) {
        return { status: 0, stdout: "0 1\n", stderr: "" } as never;
      }

      return { status: 0, stdout: "", stderr: "" } as never;
    });
    vi.mocked(fetchLinkedIssuesForPullRequest).mockResolvedValue([
      {
        number: 70,
        title: "Add prs pr fix-tests",
        body: "Implement managed AI test suggestion handoff.",
        url: "https://github.com/DevwareUK/prs/issues/70",
      },
    ]);
    vi.mocked(createPullRequestFixTestsWorkspace).mockReturnValue(workspace);
  });

  afterAll(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("prepares selected test suggestion artifacts without launching a runtime", async () => {
    const comment = createManagedComment(
      [
        "<!-- prs:test-suggestions -->",
        "## AI Test Suggestions",
        "",
        "### Suggested test areas",
        "",
        ...buildSuggestionBlock({
          title: "Verify command execution for 'prs pr fix-tests'",
          priority: "High",
          value: "The command should orchestrate the selected test workflow.",
        }),
      ].join("\n")
    );
    const { forge } = createForge([comment]);
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn();
    const commitGeneratedChanges = vi.fn();
    const promptForLine = vi.fn();

    const result = await runPrFixTestsCommand({
      mode: "prepare",
      selection: "1",
      prNumber: 71,
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
      flow: "pr-add-tests",
      prNumber: 71,
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
          name: "pr-add-tests",
          role: "tester",
          targetPullRequestNumber: 71,
          runDir: workspace.runDir,
        },
        auditPublication: {
          target: "pr",
          prNumber: 71,
          section: "token-usage",
          publishWhen: ["reviewed-updates-pushed"],
        },
      },
      nextAction: "continue-in-current-codex-session",
    });
    expect(writePullRequestFixTestsWorkspaceFiles).toHaveBeenCalled();
    expect(promptForLine).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(verifyBuild).not.toHaveBeenCalled();
    expect(hasChanges).not.toHaveBeenCalled();
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
  });

  it("fetches PR context, writes workspace files, runs the selected runtime, verifies the build, and commits", async () => {
    const comment = createManagedComment(
      [
        "<!-- prs:test-suggestions -->",
        "## AI Test Suggestions",
        "",
        "### Suggested test areas",
        "",
        ...buildSuggestionBlock({
          title: "Verify command execution for 'prs pr fix-tests'",
          priority: "High",
          addressed: false,
          value: "The command should orchestrate the selected test workflow.",
          protectedPaths: [
            "packages/cli/src/workflows/pr-fix-tests/run.ts",
          ],
          likelyLocations: [
            "packages/cli/src/index.test.ts",
            "packages/cli/src/workflows/pr-fix-tests/run.test.ts",
          ],
          implementationNote:
            "Exercise the command flow from comment parsing through runtime launch and commit review.",
        }),
        "",
        ...buildSuggestionBlock({
          title: "Verify output artifacts are created correctly",
          priority: "Medium",
          addressed: false,
          value: "The workflow should produce auditable run artifacts.",
          protectedPaths: [
            "packages/cli/src/workflows/pr-fix-tests/workspace.ts",
          ],
          likelyLocations: [
            "packages/cli/src/workflows/pr-fix-tests/workspace.test.ts",
          ],
          implementationNote:
            "Assert the snapshot, prompt, metadata, and log files are written with the richer task context.",
        }),
      ].join("\n")
    );
    const {
      forge,
      fetchPullRequestDetails,
      fetchPullRequestIssueComments,
      updateIssueComment,
    } = createForge([comment]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1,2").mockResolvedValueOnce("y");
    const ensureCleanWorkingTree = vi.fn();
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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
          area: "Verify command execution for 'prs pr fix-tests'",
          priority: "high",
          testType: "integration",
        }),
        expect.objectContaining({
          area: "Verify output artifacts are created correctly",
          priority: "medium",
          implementationNote: expect.stringContaining("snapshot, prompt, metadata"),
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
    expect(launch).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(hasChanges).toHaveBeenCalledWith(repoRoot);
    expect(commitGeneratedChanges).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({
        content: "test: add suggested tests for PR #71\n",
        filePath: resolve(workspace.runDir, "commit-message.txt"),
      })
    );
    expect(updateIssueComment).not.toHaveBeenCalled();
    const pushCallIndex = vi.mocked(spawnSync).mock.calls.findIndex(
      ([command, args]) =>
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "push" &&
        args[2] === "HEAD:feat/pr-fix-tests"
    );
    expect(pushCallIndex).toBeGreaterThanOrEqual(0);
    expect(commitGeneratedChanges.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(spawnSync).mock.invocationCallOrder[pushCallIndex] ?? 0
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin", "feat/pr-fix-tests"],
      expect.any(Object)
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:feat/pr-fix-tests"],
      expect.any(Object)
    );
    expect(promptForLine).toHaveBeenNthCalledWith(
      1,
      "Select test suggestions to implement [All|none|1,2,...] (default: All): "
    );
    expect(promptForLine).toHaveBeenNthCalledWith(
      2,
      "Commit fixes with this message? [Y/n/m]: "
    );
  });

  it("uses the newest managed AI test suggestions comment when multiple candidates exist", async () => {
    const olderComment = createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Older suggestion",
            priority: "Low",
            value: "Older comments should not win selection.",
          }),
        ].join("\n")
      );
    const newerComment = {
      ...createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Newer suggestion",
            priority: "High",
            value: "The most recent managed comment should drive the workflow.",
            likelyLocations: ["packages/cli/src/workflows/pr-fix-tests/run.test.ts"],
          }),
        ].join("\n")
      ),
      id: 802,
      updatedAt: "2026-03-20T11:45:00Z",
    };
    const { forge } = createForge([olderComment, newerComment]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("n");
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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
    expect(launch).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
  });

  it("exits without launching the runtime or writing workspace files when no test suggestions are selected", async () => {
    const { forge, updateIssueComment } = createForge([
      createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Verify command execution for 'prs pr fix-tests'",
            priority: "High",
            value: "The command should orchestrate the selected test workflow.",
          }),
        ].join("\n")
      ),
    ]);
    const promptForLine = vi.fn().mockResolvedValue("none");
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn();
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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

    expect(createPullRequestFixTestsWorkspace).not.toHaveBeenCalled();
    expect(writePullRequestFixTestsWorkspaceFiles).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
    expect(verifyBuild).not.toHaveBeenCalled();
    expect(hasChanges).not.toHaveBeenCalled();
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
    expect(updateIssueComment).not.toHaveBeenCalled();
    expect(promptForLine).toHaveBeenCalledTimes(1);
  });

  it("offers only unchecked checklist suggestions for selection", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Already addressed suggestion",
            priority: "High",
            addressed: true,
            value: "Checked suggestions should not be offered again.",
          }),
          "",
          ...buildSuggestionBlock({
            title: "Still open suggestion",
            priority: "Medium",
            addressed: false,
            value: "Open suggestions should remain selectable.",
          }),
        ].join("\n")
      ),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("all").mockResolvedValueOnce("n");
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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

    expect(writePullRequestFixTestsWorkspaceFiles).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({ number: 71 }),
      [
        expect.objectContaining({
          area: "Still open suggestion",
          addressed: false,
        }),
      ],
      expect.any(Object),
      workspace,
      ["pnpm", "build"],
      expect.any(Array)
    );
  });

  it("exits clearly when every managed suggestion is already addressed", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Already addressed suggestion",
            priority: "High",
            addressed: true,
            value: "Checked suggestions should not be offered again.",
          }),
        ].join("\n")
      ),
    ]);
    const promptForLine = vi.fn();
    const launch = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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
      hasChanges: vi.fn(),
      commitGeneratedChanges: vi.fn(),
    });

    expect(console.log).toHaveBeenCalledWith(
      "All managed AI test suggestions are already addressed."
    );
    expect(promptForLine).not.toHaveBeenCalled();
    expect(createPullRequestFixTestsWorkspace).not.toHaveBeenCalled();
    expect(writePullRequestFixTestsWorkspaceFiles).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it("leaves generated changes uncommitted when the user declines the commit prompt", async () => {
    const { forge, updateIssueComment } = createForge([
      createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Verify post-Codex workflow",
            priority: "High",
            value: "Users may want to inspect changes before committing.",
          }),
        ].join("\n")
      ),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1").mockResolvedValueOnce("n");
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(true);
    const commitGeneratedChanges = vi.fn();

    await runPrFixTestsCommand({
      prNumber: 71,
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
    expect(updateIssueComment).not.toHaveBeenCalled();
    expect(
      vi.mocked(spawnSync).mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          (args[0] === "fetch" || args[0] === "push")
      )
    ).toBe(false);
    expect(promptForLine).toHaveBeenNthCalledWith(
      2,
      "Commit fixes with this message? [Y/n/m]: "
    );
  });

  it("lets the user modify the reviewed commit message before committing", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Verify post-Codex workflow",
            priority: "High",
            value: "The reviewed commit message should be editable.",
          }),
        ].join("\n")
      ),
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
          args[1] === "HEAD"
        ) {
          return { status: 0, stdout: "edited-head-sha\n", stderr: "" } as never;
        }

        if (
          Array.isArray(args) &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/pr-fix-tests"
        ) {
          return { status: 0, stdout: "head-tip-71\n", stderr: "" } as never;
        }

        if (
          Array.isArray(args) &&
          args[0] === "rev-list" &&
          args[3] === "origin/feat/pr-fix-tests...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" } as never;
        }

        return { status: 0, stdout: "", stderr: "" } as never;
      }

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
        content: "test: refine AI test suggestion commit message\n\nReviewed before commit.\n",
        filePath: resolve(workspace.runDir, "commit-message.txt"),
      })
    );
    expect(
      vi.mocked(spawnSync).mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          args[0] === "push" &&
          args[2] === "HEAD:feat/pr-fix-tests"
      )
    ).toBe(true);
  });

  it("keeps the reviewed local commit when the PR head branch diverged on origin", async () => {
    const { forge } = createForge([
      createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Verify post-Codex workflow",
            priority: "High",
            value: "Diverged PR branches must not be auto-pushed.",
          }),
        ].join("\n")
      ),
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
        args[0] === "rev-parse" &&
        args[1] === "HEAD"
      ) {
        return { status: 0, stdout: "diverged-head-sha\n", stderr: "" } as never;
      }

      if (
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "rev-list" &&
        args[3] === "origin/feat/pr-fix-tests...HEAD"
      ) {
        return { status: 0, stdout: "1 1\n", stderr: "" } as never;
      }

      return { status: 0, stdout: "", stderr: "" } as never;
    });

    await expect(
      runPrFixTestsCommand({
        prNumber: 71,
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
      'Cannot push reviewed updates to "feat/pr-fix-tests" because HEAD diverged from origin/feat/pr-fix-tests (1 ahead, 1 behind). Local commits were kept.'
    );

    expect(commitGeneratedChanges).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({
        content: "test: add suggested tests for PR #71\n",
      })
    );
    expect(spawnSync).not.toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:feat/pr-fix-tests"],
      expect.any(Object)
    );
  });

  it("fails clearly when the selected runtime completes without producing any file changes", async () => {
    const { forge, updateIssueComment } = createForge([
      createManagedComment(
        [
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          ...buildSuggestionBlock({
            title: "Verify post-Codex workflow",
            priority: "High",
            value: "Empty Codex runs should fail before any commit prompt.",
          }),
        ].join("\n")
      ),
    ]);
    const promptForLine = vi.fn().mockResolvedValueOnce("1");
    const launch = vi.fn();
    const verifyBuild = vi.fn();
    const hasChanges = vi.fn().mockReturnValue(false);
    const commitGeneratedChanges = vi.fn();

    await expect(
      runPrFixTestsCommand({
        prNumber: 71,
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
    ).rejects.toThrow("Codex completed without producing any file changes to commit.");

    expect(launch).toHaveBeenCalledWith(repoRoot, workspace);
    expect(verifyBuild).toHaveBeenCalledWith(repoRoot, ["pnpm", "build"], workspace.outputLogPath);
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
    expect(updateIssueComment).not.toHaveBeenCalled();
    expect(promptForLine).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when no managed AI test suggestions comment exists", async () => {
    const { forge } = createForge([]);

    await expect(
      runPrFixTestsCommand({
        prNumber: 71,
        repoRoot,
        buildCommand: ["pnpm", "build"],
        ensureVerificationCommandAvailable: vi.fn(),
        runtime: {
          resolve: () => ({
            displayName: "Codex",
            launch: vi.fn(),
          }),
        },
        forge,
        ensureCleanWorkingTree: vi.fn(),
        promptForLine: vi.fn(),
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
          "<!-- prs:test-suggestions -->",
          "## AI Test Suggestions",
          "",
          "### Suggested test areas",
          "",
          "#### Missing Why Field",
          "- Priority: High",
          "- Test type: integration",
          "- Behavior covered: Missing Why Field should still reach the required-field validation.",
          "- Regression risk: The parser could report the wrong missing field if validation order changes.",
        ].join("\n")
      ),
    ]);

    await expect(
      runPrFixTestsCommand({
        prNumber: 71,
        repoRoot,
        buildCommand: ["pnpm", "build"],
        ensureVerificationCommandAvailable: vi.fn(),
        runtime: {
          resolve: () => ({
            displayName: "Codex",
            launch: vi.fn(),
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
      'Failed to parse the managed AI test suggestions comment for PR #71. Suggestion "Missing Why Field" is missing a Why it matters field.'
    );

    expect(createPullRequestFixTestsWorkspace).not.toHaveBeenCalled();
    expect(writePullRequestFixTestsWorkspaceFiles).not.toHaveBeenCalled();
  });
});
