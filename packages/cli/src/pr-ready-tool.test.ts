import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestDetails, RepositoryForge } from "./forge";
import { readyPullRequestTool } from "./pr-ready-tool";

const cleanupTargets = new Set<string>();

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

function createRepo(): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-pr-ready-"));
  cleanupTargets.add(repoRoot);
  return repoRoot;
}

function createPullRequest(): PullRequestDetails {
  return {
    number: 115,
    title: "Add sale menu images",
    body: "Make the sale menu browsable with images.",
    url: "https://github.com/DevwareUK/bos/pull/115",
    baseRefName: "main",
    headRefName: "codex/sales-menu-images",
    headSha: "current-head",
  };
}

function createForge(overrides: Partial<RepositoryForge> = {}): RepositoryForge {
  return {
    type: "github",
    isAuthenticated: () => true,
    fetchIssueDetails: vi.fn(),
    fetchIssueComments: vi.fn(),
    fetchIssuePlanComment: vi.fn(),
    fetchAuditComment: vi.fn(),
    fetchPullRequestDetails: vi.fn().mockResolvedValue(createPullRequest()),
    fetchPullRequestChecks: vi.fn().mockResolvedValue([]),
    listOpenPullRequestChanges: vi.fn(),
    fetchPullRequestIssueComments: vi.fn().mockResolvedValue([]),
    fetchPullRequestReviewComments: vi.fn().mockResolvedValue([]),
    createIssuePlanComment: vi.fn(),
    createAuditComment: vi.fn(),
    updateIssuePlanComment: vi.fn(),
    updateIssueComment: vi.fn(),
    createDraftIssue: vi.fn(),
    updateIssue: vi.fn(),
    createOrReuseIssue: vi.fn(),
    createPullRequest: vi.fn(),
    ...overrides,
  };
}

function createCommandRecorder(options: {
  containsBase: boolean;
  currentBranch?: string;
  ddevDescribeStatus?: number;
  lockedWorktreeDirty?: boolean;
  lockedHeadBranch?: boolean;
  mergeStatus?: number;
  ddevStatus?: number;
  readinessStatus?: number;
}) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand = (command: string, args: string[]) => {
    calls.push({ command, args });
    const normalizedArgs = command === "git" && args[0] === "-C" ? args.slice(2) : args;

    if (command === "git" && normalizedArgs[0] === "rev-parse" && normalizedArgs[1] === "--verify") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && normalizedArgs[0] === "branch" && normalizedArgs[1] === "--show-current") {
      return { status: 0, stdout: `${options.currentBranch ?? "main"}\n`, stderr: "" };
    }
    if (command === "git" && normalizedArgs[0] === "checkout") {
      if (normalizedArgs[1] === "codex/sales-menu-images" && options.lockedHeadBranch) {
        options.lockedHeadBranch = false;
        return {
          status: 128,
          stdout: "",
          stderr:
            "fatal: 'codex/sales-menu-images' is already checked out at '/repo/.worktrees/sales-menu-images'\n",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && normalizedArgs[0] === "status" && normalizedArgs[1] === "--porcelain") {
      return {
        status: 0,
        stdout: options.lockedWorktreeDirty ? " M changed-file.txt\n" : "",
        stderr: "",
      };
    }
    if (command === "git" && normalizedArgs[0] === "worktree" && normalizedArgs[1] === "remove") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && normalizedArgs[0] === "fetch" && normalizedArgs[1] === "origin") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && normalizedArgs[0] === "rev-parse" && normalizedArgs[1] === "origin/main") {
      return { status: 0, stdout: "base-tip\n", stderr: "" };
    }
    if (command === "git" && normalizedArgs[0] === "merge-base") {
      return { status: options.containsBase ? 0 : 1, stdout: "", stderr: "" };
    }
    if (command === "git" && normalizedArgs[0] === "merge") {
      return { status: options.mergeStatus ?? 0, stdout: "", stderr: "conflict\n" };
    }
    if (command.endsWith("ddev") && args[0] === "describe") {
      return {
        status: options.ddevDescribeStatus ?? 1,
        stdout: options.ddevDescribeStatus === 0 ? "project is running\n" : "",
        stderr: options.ddevDescribeStatus === 0 ? "" : "project is not running\n",
      };
    }
    if (command.endsWith("ddev") && args[0] === "start") {
      return { status: options.ddevStatus ?? 0, stdout: "started\n", stderr: "" };
    }
    if (command === "pnpm" && args[0] === "install") {
      return { status: options.readinessStatus ?? 0, stdout: "installed\n", stderr: "" };
    }
    if (command === "pnpm" && args[0] === "build") {
      return {
        status: options.readinessStatus ?? 0,
        stdout: options.readinessStatus === 1 ? "" : "built\n",
        stderr: options.readinessStatus === 1 ? "build failed\n" : "",
      };
    }

    throw new Error(`Unexpected command: ${command} ${normalizedArgs.join(" ")}`);
  };

  return { calls, runCommand };
}

function gitCallArgs(call: { command: string; args: string[] }): string[] {
  return call.command === "git" && call.args[0] === "-C" ? call.args.slice(2) : call.args;
}

describe("PR ready tool", () => {
  it("syncs the base by default without starting the local runtime", async () => {
    const repoRoot = createRepo();
    const { calls, runCommand } = createCommandRecorder({ containsBase: false });

    const result = await readyPullRequestTool({
      unattended: false,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
    });

    expect(result).toMatchObject({
      status: "ready",
      nextAction: "browse-local-app",
      baseSync: {
        status: "merged",
        remoteRef: "origin/main",
      },
      runtime: {
        kind: "unknown",
        status: "not-detected",
      },
      prContext: {
        checks: {
          status: "available",
          totalCount: 0,
        },
        testSuggestions: {
          status: "not-found",
        },
        reviewComments: {
          status: "available",
          actionableThreadCount: 0,
        },
        commentSummary: {
          status: "available",
          totalCount: 0,
          groups: [],
        },
      },
    });
    expect(calls.some((call) => call.command === "git" && gitCallArgs(call)[0] === "merge")).toBe(true);
    expect(calls.some((call) => call.command === "ddev")).toBe(false);
  });

  it("runs configured local readiness commands before reporting attended PR readiness", async () => {
    const repoRoot = createRepo();
    const { calls, runCommand } = createCommandRecorder({ containsBase: true });

    const result = await readyPullRequestTool({
      unattended: false,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
      prReadiness: {
        commands: [
          {
            name: "Install dependencies",
            command: ["pnpm", "install"],
          },
          {
            name: "Build frontend",
            command: ["pnpm", "build"],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: "ready",
      tokenUsage: {
        artifactFile: resolve(result.runDir, "codex-token-usage.json"),
        mode: "pr-token-usage-ledger",
        workflow: {
          name: "pr-ready",
          role: "reviewer",
          targetPullRequestNumber: 115,
          runDir: result.runDir,
        },
        auditPublication: {
          target: "pr",
          prNumber: 115,
          section: "token-usage",
          publishWhen: ["readiness-prepared"],
        },
      },
      localReadiness: {
        status: "passed",
        steps: [
          {
            name: "Install dependencies",
            command: ["pnpm", "install"],
            status: "passed",
          },
          {
            name: "Build frontend",
            command: ["pnpm", "build"],
            status: "passed",
          },
        ],
      },
    });
    expect(calls.map((call) => [call.command, ...call.args])).toContainEqual([
      "pnpm",
      "install",
    ]);
    expect(calls.map((call) => [call.command, ...call.args])).toContainEqual([
      "pnpm",
      "build",
    ]);
    const metadata = JSON.parse(readFileSync(result.metadataFilePath, "utf8")) as typeof result;
    expect(metadata.localReadiness).toEqual(result.localReadiness);
    expect(metadata.tokenUsage).toMatchObject({
      artifactFile: `${metadata.runDir}/codex-token-usage.json`,
      mode: "pr-token-usage-ledger",
      workflow: {
        name: "pr-ready",
        role: "reviewer",
        targetPullRequestNumber: 115,
        runDir: metadata.runDir,
      },
      auditPublication: {
        target: "pr",
        prNumber: 115,
        section: "token-usage",
        publishWhen: ["readiness-prepared"],
      },
    });
  });

  it("blocks PR readiness when a configured local readiness command fails", async () => {
    const repoRoot = createRepo();
    const { runCommand } = createCommandRecorder({
      containsBase: true,
      readinessStatus: 1,
    });

    const result = await readyPullRequestTool({
      unattended: false,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
      prReadiness: {
        commands: [
          {
            name: "Build frontend",
            command: ["pnpm", "build"],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "local-readiness-failed",
      nextAction: "inspect-local-readiness",
      localReadiness: {
        status: "failed",
        steps: [
          {
            name: "Build frontend",
            command: ["pnpm", "build"],
            status: "failed",
            summary: "build failed",
          },
        ],
      },
    });
    expect(result.localReadiness.steps[0].outputFilePath).toContain(
      ".prs/runs/"
    );
  });

  it("syncs base and starts the configured local runtime when unattended is set", async () => {
    const repoRoot = createRepo();
    const { calls, runCommand } = createCommandRecorder({ containsBase: false });

    const result = await readyPullRequestTool({
      unattended: true,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
      localRuntime: {
        type: "command",
        url: "https://bos.ddev.site",
        statusCommand: ["ddev", "describe"],
        startCommand: ["ddev", "start"],
      },
    });

    expect(result).toMatchObject({
      status: "ready",
      nextAction: "browse-local-app",
      baseSync: {
        status: "merged",
      },
      runtime: {
        kind: "command",
        status: "running",
        url: "https://bos.ddev.site",
        startCommand: ["ddev", "start"],
      },
    });
    expect(calls.some((call) => call.command === "git" && gitCallArgs(call)[0] === "merge")).toBe(true);
    expect(calls.some((call) => call.command === "ddev" && call.args[0] === "start")).toBe(true);
  });

  it("removes a clean PR worktree and checks out the actual PR branch when the head branch is locked", async () => {
    const repoRoot = createRepo();
    const { calls, runCommand } = createCommandRecorder({
      containsBase: true,
      lockedHeadBranch: true,
    });

    const result = await readyPullRequestTool({
      unattended: true,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
      localRuntime: {
        type: "command",
        url: "https://bos.ddev.site",
        statusCommand: ["ddev", "describe"],
        startCommand: ["ddev", "start"],
      },
    });

    expect(result).toMatchObject({
      status: "ready",
      branchName: "codex/sales-menu-images",
      nextAction: "browse-local-app",
      runtime: {
        kind: "command",
        status: "running",
        url: "https://bos.ddev.site",
      },
    });
    expect(calls.map(gitCallArgs)).toContainEqual(["status", "--porcelain"]);
    expect(calls.map(gitCallArgs)).toContainEqual([
      "worktree",
      "remove",
      "/repo/.worktrees/sales-menu-images",
    ]);
    expect(calls.map(gitCallArgs)).toContainEqual(["checkout", "codex/sales-menu-images"]);
  });

  it("blocks when the PR head branch is locked by a dirty worktree", async () => {
    const repoRoot = createRepo();
    const { runCommand } = createCommandRecorder({
      containsBase: true,
      lockedHeadBranch: true,
      lockedWorktreeDirty: true,
    });

    await expect(
      readyPullRequestTool({
        unattended: true,
        forge: createForge(),
        prNumber: 115,
        repoRoot,
        runCommand,
        ensureCleanWorkingTree: vi.fn(),
        ensureVerificationCommandAvailable: vi.fn(),
        buildCommand: ["pnpm", "build"],
      })
    ).rejects.toThrow(
      'PR branch "codex/sales-menu-images" is checked out in another worktree at /repo/.worktrees/sales-menu-images, and that worktree has uncommitted changes.'
    );
  });

  it("reports an already-running local runtime without starting it again", async () => {
    const repoRoot = createRepo();
    const { calls, runCommand } = createCommandRecorder({
      containsBase: true,
      ddevDescribeStatus: 0,
    });

    const result = await readyPullRequestTool({
      unattended: true,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
      localRuntime: {
        type: "command",
        url: "https://bos.ddev.site",
        statusCommand: ["ddev", "describe"],
        startCommand: ["ddev", "start"],
      },
    });

    expect(result).toMatchObject({
      status: "ready",
      runtime: {
        kind: "command",
        status: "running",
        message: "Local runtime is already running.",
      },
    });
    expect(calls.some((call) => call.command.endsWith("ddev") && call.args[0] === "describe")).toBe(true);
    expect(calls.some((call) => call.command.endsWith("ddev") && call.args[0] === "start")).toBe(false);
  });

  it("runs the configured local runtime start command", async () => {
    const repoRoot = createRepo();
    mkdirSync(resolve(repoRoot, "bin"), { recursive: true });
    const ddevPath = resolve(repoRoot, "bin", "ddev");
    writeFileSync(ddevPath, "", "utf8");
    const { calls, runCommand } = createCommandRecorder({ containsBase: true });

    const result = await readyPullRequestTool({
      unattended: true,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
      localRuntime: {
        type: "command",
        url: "https://bos.ddev.site",
        statusCommand: [ddevPath, "describe"],
        startCommand: [ddevPath, "start"],
      },
    });

    expect(result).toMatchObject({
      status: "ready",
      runtime: {
        kind: "command",
        status: "running",
        startCommand: [ddevPath, "start"],
      },
    });
    expect(calls.some((call) => call.command === ddevPath && call.args[0] === "start")).toBe(true);
  });

  it("blocks when unattended base sync hits merge conflicts", async () => {
    const repoRoot = createRepo();
    const { calls, runCommand } = createCommandRecorder({
      containsBase: false,
      mergeStatus: 1,
    });

    const result = await readyPullRequestTool({
      unattended: true,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
      localRuntime: {
        type: "command",
        url: "https://bos.ddev.site",
        statusCommand: ["ddev", "describe"],
        startCommand: ["ddev", "start"],
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "merge-conflicts",
      nextAction: "resolve-conflicts",
      runtime: {
        kind: "command",
        status: "not-started",
      },
    });
    expect(calls.some((call) => call.command === "ddev")).toBe(false);
  });

  it("does not run local readiness commands when base sync is blocked", async () => {
    const repoRoot = createRepo();
    const { calls, runCommand } = createCommandRecorder({
      containsBase: false,
      mergeStatus: 1,
    });

    const result = await readyPullRequestTool({
      unattended: false,
      forge: createForge(),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
      prReadiness: {
        commands: [
          {
            name: "Install dependencies",
            command: ["pnpm", "install"],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "merge-conflicts",
      localReadiness: {
        status: "skipped",
        message: "Local readiness commands were skipped because base sync is blocked.",
      },
    });
    expect(calls.some((call) => call.command === "pnpm")).toBe(false);
  });

  it("persists GitHub-hosted PR context in readiness metadata", async () => {
    const repoRoot = createRepo();
    const { runCommand } = createCommandRecorder({ containsBase: true });
    const forge = createForge({
      fetchPullRequestDetails: vi.fn().mockResolvedValue({
        ...createPullRequest(),
        isDraft: true,
        mergeable: false,
        mergeableState: "dirty",
      }),
      fetchPullRequestChecks: vi.fn().mockResolvedValue([
        {
          name: "build",
          status: "completed",
          conclusion: "failure",
          url: "https://github.com/DevwareUK/bos/actions/runs/1",
        },
        {
          name: "smoke",
          status: "in-progress",
          url: "https://github.com/DevwareUK/bos/actions/runs/2",
        },
      ]),
      fetchPullRequestIssueComments: vi.fn().mockResolvedValue([
        {
          id: 42,
          body: [
            "<!-- prs:test-suggestions -->",
            "## AI Test Suggestions",
            "",
            "### Suggested test areas",
            "",
            "#### Checkout readiness metadata",
            "- [ ] Addressed",
            "- Priority: High",
            "- Test type: Integration",
            "- Behavior covered: Readiness metadata includes hosted PR context.",
            "- Regression risk: Reviewers lose the fast path signal.",
            "- Why it matters: The local workflow should surface GitHub context.",
            "- Protected paths: `packages/cli/src/pr-ready-tool.ts`",
            "- Likely locations: `packages/cli/src/pr-ready-tool.test.ts`",
            "- Implementation note: Assert the metadata shape.",
          ].join("\n"),
          url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-42",
          createdAt: "2026-05-13T08:00:00Z",
          updatedAt: "2026-05-13T08:00:00Z",
          author: "github-actions",
          isBot: true,
        },
        {
          id: 43,
          body: "Can we add browser coverage for the menu image fallback?",
          url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-43",
          createdAt: "2026-05-13T08:10:00Z",
          updatedAt: "2026-05-13T08:10:00Z",
          author: "reviewer-a",
          isBot: false,
        },
        {
          id: 44,
          body: "The smoke check is still pending; let's wait before merge.",
          url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-44",
          createdAt: "2026-05-13T08:20:00Z",
          updatedAt: "2026-05-13T08:20:00Z",
          author: "reviewer-b",
          isBot: false,
        },
      ]),
      fetchPullRequestReviewComments: vi.fn().mockResolvedValue([
        {
          id: 100,
          body: "Please cover the metadata warning path too.",
          path: "packages/cli/src/pr-ready-tool.ts",
          line: 25,
          url: "https://github.com/DevwareUK/bos/pull/115#discussion_r100",
          author: "reviewer",
          createdAt: "2026-05-13T08:30:00Z",
          updatedAt: "2026-05-13T08:30:00Z",
        },
      ]),
    });

    const result = await readyPullRequestTool({
      unattended: false,
      forge,
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
    });

    expect(result.prContext).toMatchObject({
      pullRequest: {
        draft: true,
        mergeable: false,
        mergeableState: "dirty",
      },
      checks: {
        status: "available",
        failed: [{ name: "build", conclusion: "failure" }],
        pending: [{ name: "smoke", status: "in-progress" }],
      },
      testSuggestions: {
        status: "available",
        totalCount: 1,
        openCount: 1,
        topOpenSuggestions: ["Checkout readiness metadata"],
      },
      reviewComments: {
        status: "available",
        actionableThreadCount: 1,
        topThreads: [
          {
            path: "packages/cli/src/pr-ready-tool.ts",
            lineRange: "25",
            author: "reviewer",
          },
        ],
      },
      commentSummary: {
        status: "available",
        totalCount: 4,
        groups: [
          {
            category: "test-coverage",
            title: "Test coverage",
            count: 2,
            items: [
              {
                kind: "managed-test-suggestions",
                summary: "Open suggestions: Checkout readiness metadata",
                url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-42",
              },
              {
                kind: "issue-comment",
                summary: "Can we add browser coverage for the menu image fallback?",
                url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-43",
              },
            ],
          },
          {
            category: "code-review",
            title: "Code review",
            count: 1,
            items: [
              {
                kind: "review-thread",
                path: "packages/cli/src/pr-ready-tool.ts",
                lineRange: "25",
                url: "https://github.com/DevwareUK/bos/pull/115#discussion_r100",
              },
            ],
          },
          {
            category: "ci-checks",
            title: "CI and checks",
            count: 1,
            items: [
              {
                kind: "issue-comment",
                summary: "The smoke check is still pending; let's wait before merge.",
                url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-44",
              },
            ],
          },
        ],
      },
    });

    const metadata = JSON.parse(readFileSync(result.metadataFilePath, "utf8")) as typeof result;
    expect(metadata.prContext).toEqual(result.prContext);
  });

  it("groups uncategorized and blank PR issue comments without review threads", async () => {
    const repoRoot = createRepo();
    const { runCommand } = createCommandRecorder({ containsBase: true });

    const result = await readyPullRequestTool({
      unattended: false,
      forge: createForge({
        fetchPullRequestIssueComments: vi.fn().mockResolvedValue([
          {
            id: 201,
            body: "Can we mention this in the release note?",
            url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-201",
            createdAt: "2026-05-13T09:00:00Z",
            updatedAt: "2026-05-13T09:00:00Z",
            author: "reviewer-c",
            isBot: false,
          },
          {
            id: 202,
            body: "   ",
            url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-202",
            createdAt: "2026-05-13T09:10:00Z",
            updatedAt: "2026-05-13T09:10:00Z",
            author: "reviewer-d",
            isBot: false,
          },
        ]),
        fetchPullRequestReviewComments: vi.fn().mockResolvedValue([]),
      }),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
    });

    expect(result.prContext.commentSummary).toMatchObject({
      status: "available",
      totalCount: 2,
      groups: [
        {
          category: "general",
          title: "General discussion",
          count: 2,
          items: [
            {
              kind: "issue-comment",
              summary: "Can we mention this in the release note?",
              url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-201",
              author: "reviewer-c",
            },
            {
              kind: "issue-comment",
              summary: "(No comment body provided.)",
              url: "https://github.com/DevwareUK/bos/pull/115#issuecomment-202",
              author: "reviewer-d",
            },
          ],
        },
      ],
    });
  });

  it("reports actionable, handled, duplicate, resolved, and outdated review thread counts", async () => {
    const repoRoot = createRepo();
    const { runCommand } = createCommandRecorder({ containsBase: true });
    const botCommentBody =
      "Handle product lookup failure.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->";
    const duplicateBotCommentBody =
      "Product lookup failures still need a guard.\n\n<!-- prs:pr-review-inline {\"findingKey\":\"lookup-products\"} -->";

    const result = await readyPullRequestTool({
      unattended: false,
      forge: createForge({
        fetchPullRequestReviewThreads: vi.fn().mockResolvedValue([
          {
            threadId: 1,
            nodeId: "PRRT_old",
            isResolved: false,
            isOutdated: false,
            comments: [
              {
                id: 301,
                body: botCommentBody,
                path: "src/product.ts",
                line: 12,
                url: "https://github.com/DevwareUK/bos/pull/115#discussion_r301",
                author: "github-actions[bot]",
                authorIsBot: true,
                createdAt: "2026-05-13T09:00:00Z",
                updatedAt: "2026-05-13T09:00:00Z",
                commitOid: "old-head",
              },
            ],
          },
          {
            threadId: 2,
            nodeId: "PRRT_current",
            isResolved: false,
            isOutdated: false,
            comments: [
              {
                id: 302,
                body: botCommentBody,
                path: "src/product.ts",
                line: 18,
                url: "https://github.com/DevwareUK/bos/pull/115#discussion_r302",
                author: "github-actions[bot]",
                authorIsBot: true,
                createdAt: "2026-05-13T10:00:00Z",
                updatedAt: "2026-05-13T10:00:00Z",
                commitOid: "current-head",
              },
            ],
          },
          {
            threadId: 3,
            nodeId: "PRRT_duplicate",
            isResolved: false,
            isOutdated: false,
            comments: [
              {
                id: 303,
                body: duplicateBotCommentBody,
                path: "src/product.ts",
                line: 19,
                url: "https://github.com/DevwareUK/bos/pull/115#discussion_r303",
                author: "github-actions[bot]",
                authorIsBot: true,
                createdAt: "2026-05-13T10:05:00Z",
                updatedAt: "2026-05-13T10:05:00Z",
                commitOid: "current-head",
              },
            ],
          },
          {
            threadId: 4,
            nodeId: "PRRT_resolved",
            isResolved: true,
            isOutdated: false,
            comments: [
              {
                id: 304,
                body: "Resolved bot feedback.",
                path: "src/product.ts",
                line: 22,
                url: "https://github.com/DevwareUK/bos/pull/115#discussion_r304",
                author: "github-actions[bot]",
                authorIsBot: true,
                createdAt: "2026-05-13T10:10:00Z",
                updatedAt: "2026-05-13T10:10:00Z",
                commitOid: "current-head",
              },
            ],
          },
          {
            threadId: 5,
            nodeId: "PRRT_outdated",
            isResolved: false,
            isOutdated: true,
            comments: [
              {
                id: 305,
                body: "Outdated bot feedback.",
                path: "src/product.ts",
                line: 24,
                url: "https://github.com/DevwareUK/bos/pull/115#discussion_r305",
                author: "github-actions[bot]",
                authorIsBot: true,
                createdAt: "2026-05-13T10:15:00Z",
                updatedAt: "2026-05-13T10:15:00Z",
                commitOid: "current-head",
              },
            ],
          },
        ]),
      }),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
    });

    expect(result.prContext.reviewComments).toMatchObject({
      status: "available",
      totalCount: 5,
      totalThreadCount: 5,
      actionableThreadCount: 1,
      handledThreadCount: 1,
      duplicateThreadCount: 1,
      resolvedThreadCount: 1,
      outdatedThreadCount: 1,
      topThreads: [
        {
          path: "src/product.ts",
          lineRange: "18",
          url: "https://github.com/DevwareUK/bos/pull/115#discussion_r302",
        },
      ],
    });
  });

  it("keeps readiness non-blocking when hosted PR context cannot be fetched", async () => {
    const repoRoot = createRepo();
    const { runCommand } = createCommandRecorder({ containsBase: true });

    const result = await readyPullRequestTool({
      unattended: false,
      forge: createForge({
        fetchPullRequestChecks: vi.fn().mockRejectedValue(new Error("checks API failed")),
        fetchPullRequestIssueComments: vi.fn().mockRejectedValue(new Error("comments API failed")),
        fetchPullRequestReviewComments: vi.fn().mockRejectedValue(new Error("review API failed")),
      }),
      prNumber: 115,
      repoRoot,
      runCommand,
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      buildCommand: ["pnpm", "build"],
    });

    expect(result).toMatchObject({
      status: "ready",
      prContext: {
        checks: {
          status: "unavailable",
        },
        testSuggestions: {
          status: "unavailable",
        },
        reviewComments: {
          status: "unavailable",
        },
        commentSummary: {
          status: "unavailable",
        },
      },
    });
    expect(result.prContext.warnings).toHaveLength(3);
  });
});
