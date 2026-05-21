import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  REPO_ROOT,
  cleanupTargets,
  createFetchResponse,
  captureStdout,
  listRunDirectories,
  createMockCodexHome,
  writeMockCodexSession,
  withRepositoryConfig,
  loadCli,
} from "./index-test-support";

describe("PR prepare-review workflow", () => {
  it("fails pr prepare-review clearly when repository forge support is disabled", async () => {
    await withRepositoryConfig(
      JSON.stringify(
        {
          forge: {
            type: "none",
          },
        },
        null,
        2
      ),
      async () => {
        const { run } = await loadCli();

        process.argv = ["node", "prs", "codex", "pr", "prepare-review", "87"];

        await expect(run()).rejects.toThrow(
          "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
        );
      }
    );
  });

  it("runs prs tool pr prepare-review as deterministic JSON without launching Codex", async () => {
    const beforeRuns = listRunDirectories();
    const branchName = "feat/tool-pr-review";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 87,
        title: "Prepare a review workspace",
        body: "Set up a reviewer-ready local workspace for this pull request.",
        html_url: "https://github.com/DevwareUK/prs/pull/87",
        base: { ref: "main" },
        head: { ref: branchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0, stdout: "9.0.0\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === `refs/heads/${branchName}`
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-87\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-87" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "tool", "pr", "prepare-review", "87", "--json"];
    const stdout = captureStdout();

    await run();

    expect(stdout.output().trimStart()).toMatch(/^\{/);
    const result = JSON.parse(stdout.output()) as {
      status: string;
      prNumber: number;
      nextAction: string;
      reviewBriefFilePath?: string;
      snapshotFilePath?: string;
      checkout: { source: string; branchName: string };
    };
    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    if (createdRunDir) {
      cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir));
    }

    expect(result).toMatchObject({
      status: "ready",
      prNumber: 87,
      nextAction: "review-current-checkout",
      checkout: {
        source: "local-head",
        branchName,
      },
    });
    expect(result.reviewBriefFilePath).toBeUndefined();
    expect(result.snapshotFilePath).toMatch(/pr-review-prepare\.md$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.anything(),
      expect.anything()
    );
  });

  it("runs prs tool pr list actionable as deterministic JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          login: "me",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 115,
            title: "Needs my review",
            user: { login: "someone-else" },
            assignees: [],
            requested_reviewers: [{ login: "me" }],
            head: { ref: "codex/review-me" },
            labels: [{ name: "ready" }],
            updated_at: "2026-05-11T10:00:00Z",
            mergeable: true,
          },
          {
            number: 116,
            title: "Unrelated PR",
            user: { login: "someone-else" },
            assignees: [],
            requested_reviewers: [],
            head: { ref: "feature/unrelated" },
            labels: [],
            updated_at: "2026-05-11T11:00:00Z",
            mergeable: true,
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") {
          return `${REPO_ROOT}\n`;
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "tool", "pr", "list", "--actionable", "--json"];
    const stdout = captureStdout();

    await run();

    expect(stdout.output().trimStart()).toMatch(/^\{/);
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: "ready",
      actionable: true,
      currentUser: "me",
      pullRequests: [
        {
          number: 115,
          reviewRequestedFrom: ["me"],
        },
      ],
      source: "github-api",
    });
  });

  it("runs prs tool issue list actionable as deterministic JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          login: "me",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 151,
            title: "Planned issue",
            user: { login: "someone-else" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-12T10:00:00Z",
          },
          {
            number: 152,
            title: "Pull request returned by issues endpoint",
            user: { login: "me" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-12T11:00:00Z",
            pull_request: {},
          },
        ])
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            body: "<!-- prs:issue-plan -->\nPlan",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") {
          return `${REPO_ROOT}\n`;
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "tool", "issue", "list", "--actionable", "--json"];
    const stdout = captureStdout();

    await run();

    expect(stdout.output().trimStart()).toMatch(/^\{/);
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: "ready",
      actionable: true,
      currentUser: "me",
      issues: [
        {
          number: 151,
          hasPrsPlan: true,
        },
      ],
      source: "github-api",
    });
  });

  it("loads repository .env before running prs tool pr list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          login: "me",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 117,
            title: "Review me from env",
            user: { login: "someone-else" },
            assignees: [],
            requested_reviewers: [{ login: "me" }],
            head: { ref: "codex/env-token" },
            labels: [],
            updated_at: "2026-05-11T12:00:00Z",
            mergeable: true,
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const dotenvConfig = vi.fn((options?: { path?: string }) => {
      expect(options?.path).toBe(resolve(REPO_ROOT, ".env"));
      process.env.GITHUB_TOKEN = "test-token";
      return { parsed: { GITHUB_TOKEN: "test-token" } };
    });
    const { run } = await loadCli({
      dotenvConfigImpl: dotenvConfig,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") {
          return `${REPO_ROOT}\n`;
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "tool", "pr", "list", "--actionable", "--json"];
    const stdout = captureStdout();

    await run();

    expect(dotenvConfig).toHaveBeenCalledWith({ path: resolve(REPO_ROOT, ".env"), quiet: true });
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: "ready",
      actionable: true,
      pullRequests: [
        {
          number: 117,
          reviewRequestedFrom: ["me"],
        },
      ],
    });
  });

  it("runs pr prepare-review, reuses the linked issue branch, and exits cleanly when follow-up makes no changes", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 211;
    const branchName = "feat/issue-211-review-setup";
    const sessionId = "019d9001-aaaa-7bbb-8ccc-ddddeeeeffff";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));

    writeMockCodexSession(codexHome, sessionId, REPO_ROOT, "2026-04-10T08:15:00.000Z");
    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      resolve(sessionStateDir, "session.json"),
      `${JSON.stringify(
        {
          issueNumber,
          runtimeType: "codex",
          branchName,
          issueDir: `.prs/issues/${issueNumber}-review-setup`,
          runDir: ".prs/runs/20260410T081500000Z-issue-211",
          promptFile: ".prs/runs/20260410T081500000Z-issue-211/prompt.md",
          outputLog: ".prs/runs/20260410T081500000Z-issue-211/output.log",
          sessionId,
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-10T08:15:00.000Z",
          updatedAt: "2026-04-10T08:15:00.000Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 87,
          title: "Prepare a review workspace",
          body: [
            "Fixes #211",
            "",
            "Set up a reviewer-ready local workspace for this pull request.",
            "",
            "<!-- prs:pr-assistant:start -->",
            "## PR Assistant",
            "",
            "### Summary",
            "Reuse linked issue state when available.",
            "",
            "### Reviewer focus",
            "- Confirm the saved branch and session are reused when safe.",
            "<!-- prs:pr-assistant:end -->",
          ].join("\n"),
          html_url: "https://github.com/DevwareUK/prs/pull/87",
          base: { ref: "main" },
          head: { ref: "feat/pr-review-workspace" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Add PR review workspace setup",
          body: "Reuse saved issue state when preparing a local PR review.",
          html_url: "https://github.com/DevwareUK/prs/issues/211",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync, generateCommitMessage } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === branchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-87\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-87" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "resume") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before Codex resume.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".prs", "runs", createdRunDir, "review-brief.md"),
            [
              "# Review Brief",
              "",
              "## Reviewer Commands",
              "- `pnpm build`",
              "",
              "## Focus Areas",
              "- Confirm the linked issue branch and session were reused.",
            ].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "resume" && args[1] === sessionId) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "87"];
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const promptFilePath = resolve(runDirPath, "prompt.md");
    const interactivePromptFilePath = resolve(runDirPath, "interactive-prompt.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    const reviewBriefPath = resolve(runDirPath, "review-brief.md");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "# Pull Request Review Preparation Snapshot"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "## Managed PR Assistant Section"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Reuse saved issue state when preparing a local PR review."
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "Write the final Markdown review brief"
    );
    expect(readFileSync(interactivePromptFilePath, "utf8")).toContain(
      "stay in this interactive session so the user can ask follow-up review questions or request fixes"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "do not modify tracked repository files"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain("pnpm build");
    expect(readFileSync(outputLogPath, "utf8")).toContain("# prs codex pr prepare-review run log");
    expect(readFileSync(outputLogPath, "utf8")).toContain("git fetch origin main");
    expect(readFileSync(outputLogPath, "utf8")).toContain(`git checkout ${branchName}`);
    expect(readFileSync(reviewBriefPath, "utf8")).toContain("## Reviewer Commands");
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Already contained the latest origin/main tip base-tip-87"
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      flow: "pr-prepare-review",
      prNumber: 87,
      checkout: {
        source: "issue-branch",
        branchName,
        linkedIssueNumber: 211,
      },
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-87",
        status: "up-to-date",
        conflictResolution: "not-needed",
      },
      runtime: {
        type: "codex",
        invocation: "resume",
        sessionId,
        linkedIssueNumber: 211,
        warnings: [],
      },
      linkedIssues: [
        {
          number: 211,
          savedBranch: branchName,
          savedRuntimeType: "codex",
          savedSessionId: sessionId,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "resume", "--full-auto", sessionId]),
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", sessionId, "--sandbox", "workspace-write"]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
    expect(messages.join("\n")).toContain(
      "Codex exited without producing any file changes to review or commit."
    );
    expect(generateCommitMessage).not.toHaveBeenCalled();
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          (command === "pnpm" && Array.isArray(args) && args[0] === "build") ||
          (command === "git" &&
            Array.isArray(args) &&
            (args[0] === "commit" || args[0] === "push"))
      )
    ).toBe(false);
  });

  it("falls back to a fresh Codex run when the linked issue session is stale", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 212;
    const branchName = "feat/issue-212-review-setup";
    const staleSessionId = "019d9002-0000-7111-8222-933344445555";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));

    createMockCodexHome();
    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      resolve(sessionStateDir, "session.json"),
      `${JSON.stringify(
        {
          issueNumber,
          runtimeType: "codex",
          branchName,
          issueDir: `.prs/issues/${issueNumber}-review-setup`,
          runDir: ".prs/runs/20260410T091500000Z-issue-212",
          promptFile: ".prs/runs/20260410T091500000Z-issue-212/prompt.md",
          outputLog: ".prs/runs/20260410T091500000Z-issue-212/output.log",
          sessionId: staleSessionId,
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-10T09:15:00.000Z",
          updatedAt: "2026-04-10T09:15:00.000Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 88,
          title: "Prepare another review workspace",
          body: "Fixes #212\n\nRegenerate the reviewer brief when the old session is gone.",
          html_url: "https://github.com/DevwareUK/prs/pull/88",
          base: { ref: "main" },
          head: { ref: "feat/pr-review-workspace-stale" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Handle stale saved Codex sessions",
          body: "Warn and fall back instead of failing the reviewer workflow.",
          html_url: "https://github.com/DevwareUK/prs/issues/212",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === branchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-88\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-88" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".prs", "runs", createdRunDir, "review-brief.md"),
            [
              "# Review Brief",
              "",
              "## Reviewer Commands",
              "- `pnpm build`",
            ].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "88"];

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const interactivePromptFilePath = resolve(runDirPath, "interactive-prompt.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain("## Runtime Warnings");
    expect(readFileSync(interactivePromptFilePath, "utf8")).toContain(
      "Read the generated review brief"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      `Warning: Saved Codex session ${staleSessionId} for linked issue #212 is no longer available. Falling back to a fresh review brief generation run.`
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Already contained the latest origin/main tip base-tip-88"
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      checkout: {
        source: "issue-branch",
        branchName,
        linkedIssueNumber: 212,
      },
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-88",
        status: "up-to-date",
        conflictResolution: "not-needed",
      },
      runtime: {
        invocation: "new",
        linkedIssueNumber: 212,
        warnings: [
          `Saved Codex session ${staleSessionId} for linked issue #212 is no longer available. Falling back to a fresh review brief generation run.`,
        ],
      },
    });
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "resume", "--full-auto", staleSessionId]),
      expect.any(Object)
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "--full-auto", "--cd", REPO_ROOT]),
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--cd",
        REPO_ROOT,
      ]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
  });

  it("runs pr prepare-review follow-up fixes through build verification and reviewed commit flow", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-follow-up";
    let gitStatusCallCount = 0;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 206,
        title: "Tighten prepare-review follow-up fixes",
        body: "Keep the reviewer workflow open for follow-up fixes and commit review.",
        html_url: "https://github.com/DevwareUK/prs/pull/206",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPENAI_API_KEY = "test-key";
    const { run, spawnSync, generateCommitMessage } = await loadCli({
      commitMessageResult: {
        title: "fix: review follow-up fixes for PR #206",
        body: "Generated after the interactive prepare-review session.",
      },
      readlineAnswers: ["y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1
            ? ""
            : " M packages/cli/src/workflows/pr-prepare-review/run.ts\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/workflows/pr-prepare-review/run.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/workflows/pr-prepare-review/run.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/workflows/pr-prepare-review/run.ts b/packages/cli/src/workflows/pr-prepare-review/run.ts",
            "--- a/packages/cli/src/workflows/pr-prepare-review/run.ts",
            "+++ b/packages/cli/src/workflows/pr-prepare-review/run.ts",
            "@@ -1,1 +1,2 @@",
            '-console.log("before");',
            '+console.log("after");',
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-206\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-206" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".prs", "runs", createdRunDir, "review-brief.md"),
            ["# Review Brief", "", "## Reviewer Commands", "- `pnpm build`"].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "build ok\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === `origin/${headBranchName}`) {
          return { status: 0, stdout: "head-tip-206\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === `origin/${headBranchName}...HEAD`
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === `HEAD:${headBranchName}`
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "206"];
    const stdout = captureStdout();
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string);
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    const commitCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "commit"
    );
    expect(commitCall).toBeDefined();
    const commitArgs = commitCall?.[1] as string[];
    expect(commitArgs).toEqual(["commit", "-F", expect.stringContaining("commit-message.txt")]);
    expect(readFileSync(commitArgs[2], "utf8")).toContain(
      "fix: review follow-up fixes for PR #206"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain("$ pnpm build");
    expect(readFileSync(outputLogPath, "utf8")).toContain(`$ git push origin HEAD:${headBranchName}`);
    expect(stdout.output()).toContain("Proposed commit message");
    expect(messages.join("\n")).toContain(
      `Pushing reviewed updates to origin/${headBranchName}...`
    );
    expect(generateCommitMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining(
        "diff --git a/packages/cli/src/workflows/pr-prepare-review/run.ts b/packages/cli/src/workflows/pr-prepare-review/run.ts"
      )
    );
  });

  it("leaves pr prepare-review follow-up changes uncommitted when the reviewed message is declined", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-skip-commit";
    let gitStatusCallCount = 0;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 207,
        title: "Skip prepare-review follow-up commit",
        body: "Offer commit review after the follow-up session.",
        html_url: "https://github.com/DevwareUK/prs/pull/207",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPENAI_API_KEY = "test-key";
    const { run, spawnSync } = await loadCli({
      commitMessageResult: {
        title: "fix: stage follow-up prepare-review changes",
      },
      readlineAnswers: ["n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M README.md\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "README.md\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "README.md"
        ) {
          return [
            "diff --git a/README.md b/README.md",
            "--- a/README.md",
            "+++ b/README.md",
            "@@ -1,1 +1,2 @@",
            "-old",
            "+new",
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-207\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-207" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".prs", "runs", createdRunDir, "review-brief.md"),
            ["# Review Brief", "", "## Reviewer Commands", "- `pnpm build`"].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "build ok\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "head-tip-88\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === "origin/feat/pr-fix-comments...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === "HEAD:feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "207"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    expect(messages.join("\n")).toContain("Leaving the generated changes uncommitted.");
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          args[0] === "commit"
      )
    ).toBe(false);
  });

  it("stops pr prepare-review before commit review when the follow-up build fails", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-build-failure";
    let gitStatusCallCount = 0;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 208,
        title: "Fail prepare-review follow-up build",
        body: "Build verification must stop before commit creation.",
        html_url: "https://github.com/DevwareUK/prs/pull/208",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync, generateCommitMessage } = await loadCli({
      readlineAnswers: ["y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M README.md\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-208\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-208" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".prs", "runs", createdRunDir, "review-brief.md"),
            ["# Review Brief", "", "## Reviewer Commands", "- `pnpm build`"].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 1, stdout: "", stderr: "build failed\n" };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "head-tip-88\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === "origin/feat/pr-fix-comments...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === "HEAD:feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "208"];

    await expect(run()).rejects.toThrow("Build failed. Changes were not committed.");
    expect(generateCommitMessage).not.toHaveBeenCalled();
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          (args[0] === "commit" || args[0] === "push")
      )
    ).toBe(false);
  });

  it("fetches a dedicated local review branch and merges the latest base branch when no saved issue state or local head branch exists", async () => {
    const beforeRuns = listRunDirectories();
    const reviewBranchName = "review/pr-205-prepare-a-review-workspace";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 205,
        title: "Prepare a review workspace",
        body: "Generate a local reviewer brief for this pull request.",
        html_url: "https://github.com/DevwareUK/prs/pull/205",
        base: { ref: "main" },
        head: { ref: "feat/prepare-review-workspace" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-205\n", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
          return { status: 1, error: new Error("missing") };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === `pull/205/head:${reviewBranchName}`
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === reviewBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-205" &&
          args[3] === "HEAD"
        ) {
          return { status: 1, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge" &&
          args[1] === "--no-edit" &&
          args[2] === "--no-ff" &&
          args[3] === "origin/main"
        ) {
          return { status: 0, stdout: "Merge made by the 'ort' strategy.\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".prs", "runs", createdRunDir, "review-brief.md"),
            [
              "# Review Brief",
              "",
              "## Reviewer Commands",
              "- `pnpm build`",
              "",
              "## Focus Areas",
              "- Review the fetched branch diff against `main`.",
            ].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "feat/prepare-review-workspace"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/prepare-review-workspace"
        ) {
          return { status: 0, stdout: "head-tip-205\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === "origin/feat/prepare-review-workspace...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === "HEAD:feat/prepare-review-workspace"
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "205"];
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const interactivePromptFilePath = resolve(runDirPath, "interactive-prompt.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Fetched PR head into dedicated local review branch"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      'Merged the latest origin/main tip base-tip-205 into the checked-out branch'
    );
    expect(readFileSync(interactivePromptFilePath, "utf8")).toContain(
      "Remain available for follow-up questions and requested fixes"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      `git fetch origin pull/205/head:${reviewBranchName}`
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      `git checkout ${reviewBranchName}`
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain("git fetch origin main");
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      "git merge --no-edit --no-ff origin/main"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      "git push origin HEAD:feat/prepare-review-workspace"
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      prNumber: 205,
      checkout: {
        source: "fetched-review",
        branchName: reviewBranchName,
        headRefName: "feat/prepare-review-workspace",
      },
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-205",
        status: "merged",
        conflictResolution: "not-needed",
      },
      runtime: {
        invocation: "new",
        warnings: [],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin", `pull/205/head:${reviewBranchName}`],
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["merge", "--no-edit", "--no-ff", "origin/main"],
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:feat/prepare-review-workspace"],
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(messages.join("\n")).toContain(
      "Pushing reviewed updates to origin/feat/prepare-review-workspace..."
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--cd",
        REPO_ROOT,
      ]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
  });

  it("resolves base-branch merge conflicts before generating the review brief", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-conflicts-resolved";
    let mergeBaseCallCount = 0;
    let mergeHeadCheckCount = 0;
    let unmergedPathsCheckCount = 0;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 209,
        title: "Resolve prepare-review merge conflicts",
        body: "Sync the reviewer branch with main before brief generation.",
        html_url: "https://github.com/DevwareUK/prs/pull/209",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-209\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-209" &&
          args[3] === "HEAD"
        ) {
          mergeBaseCallCount += 1;
          return { status: mergeBaseCallCount === 1 ? 1 : 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge" &&
          args[1] === "--no-edit" &&
          args[2] === "--no-ff" &&
          args[3] === "origin/main"
        ) {
          return {
            status: 1,
            stdout: "Auto-merging README.md\n",
            stderr: "CONFLICT (content): Merge conflict in README.md\n",
          };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "-q" &&
          args[2] === "--verify" &&
          args[3] === "MERGE_HEAD"
        ) {
          mergeHeadCheckCount += 1;
          return {
            status: mergeHeadCheckCount === 1 ? 0 : 1,
            stdout: mergeHeadCheckCount === 1 ? "merge-head\n" : "",
            stderr: "",
          };
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "--name-only" &&
          args[2] === "--diff-filter=U"
        ) {
          unmergedPathsCheckCount += 1;
          return {
            status: 0,
            stdout: unmergedPathsCheckCount === 1 ? "README.md\n" : "",
            stderr: "",
          };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === headBranchName
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === `origin/${headBranchName}`
        ) {
          return { status: 0, stdout: "head-tip-209\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === `origin/${headBranchName}...HEAD`
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === `HEAD:${headBranchName}`
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".prs", "runs", createdRunDir, "review-brief.md"),
            [
              "# Review Brief",
              "",
              "## Reviewer Commands",
              "- `pnpm build`",
              "",
              "## Focus Areas",
              "- Inspect the conflict resolution and merged base branch changes.",
            ].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "209"];

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string);
    const conflictPromptFilePath = resolve(runDirPath, "base-sync-conflict-prompt.md");
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(conflictPromptFilePath, "utf8")).toContain(
      "Resolve the merge conflicts created while merging `origin/main`"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "after Codex resolved merge conflicts"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      'Warning: Merging origin/main into "feat/prepare-review-conflicts-resolved" produced conflicts.'
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      'Warning: Codex resolved the merge conflicts while merging origin/main into "feat/prepare-review-conflicts-resolved".'
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      `git push origin HEAD:${headBranchName}`
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-209",
        status: "merged",
        conflictResolution: "required",
      },
    });
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "codex" &&
          Array.isArray(args) &&
          args[0] === "--sandbox" &&
          args.some(
            (value) =>
              typeof value === "string" && value.includes("base-sync-conflict-prompt.md")
          )
      )
    ).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", `HEAD:${headBranchName}`],
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
  });

  it("fails clearly when base-branch merge conflicts remain unresolved", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-conflicts-unresolved";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 210,
        title: "Fail unresolved prepare-review merge conflicts",
        body: "Stop review preparation until the base-branch merge is clean.",
        html_url: "https://github.com/DevwareUK/prs/pull/210",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          ((args[1] === "origin/main") ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-210\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-210" &&
          args[3] === "HEAD"
        ) {
          return { status: 1, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge" &&
          args[1] === "--no-edit" &&
          args[2] === "--no-ff" &&
          args[3] === "origin/main"
        ) {
          return {
            status: 1,
            stdout: "Auto-merging README.md\n",
            stderr: "CONFLICT (content): Merge conflict in README.md\n",
          };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "-q" &&
          args[2] === "--verify" &&
          args[3] === "MERGE_HEAD"
        ) {
          return { status: 0, stdout: "merge-head\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "--name-only" &&
          args[2] === "--diff-filter=U"
        ) {
          return { status: 0, stdout: "README.md\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "210"];

    await expect(run()).rejects.toThrow(
      'Base-branch sync is still incomplete for "feat/prepare-review-conflicts-unresolved".'
    );

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain("## Base Branch Sync Recovery");
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      'Warning: Base-branch sync is still incomplete for "feat/prepare-review-conflicts-unresolved".'
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-210",
        status: "blocked",
        conflictResolution: "unresolved",
      },
    });
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "--full-auto", "--cd", REPO_ROOT]),
      expect.any(Object)
    );
  });

});
