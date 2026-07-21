import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UNATTENDED_GITHUB_OUTPUT_NOTE } from "@prs/contracts";
import {
  REPO_ROOT,
  cleanupTargets,
  createIssueResolutionPlanResult,
  createFetchResponse,
  listRunDirectories,
  readLatestRunMetadata,
  createMockCodexHome,
  createMockCodexSuperpowersHome,
  writeMockCodexSession,
  withRepositoryConfig,
  loadCli,
} from "./index-test-support";

describe("Full issue run workflow", () => {
  it("tracks the Codex session for a first full issue run", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 148;
    const issueTitle = "Track resumable Codex issue sessions";
    const branchName = "feat/issue-148-track-resumable-codex-issue-sessions";
    const sessionId = "019d5000-1111-7222-8333-444455556666";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      `${issueNumber}-track-resumable-codex-issue-sessions`
    );
    let gitStatusCallCount = 0;

    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const issuePlan = {
      ...createIssueResolutionPlanResult(),
      summary: "Generated plan summary for full issue execution.",
    };
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: issueTitle,
          body: "Persist the session id after the first full issue run.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        return createFetchResponse({
          id: 615,
          body: JSON.parse(String(init.body)).body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-615`,
          updated_at: "2026-04-26T10:40:00Z",
        });
      }

      if (url.endsWith("/pulls?state=open&per_page=100")) {
        return createFetchResponse([]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      issueResolutionPlanResult: issuePlan,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const flow = "before";',
            '+const flow = "after";',
          ].join("\n");
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

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex") {
          writeMockCodexSession(
            codexHome,
            sessionId,
            REPO_ROOT,
            "2026-04-01T09:15:00.000Z"
          );
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: "https://github.com/DevwareUK/prs/pull/1480\n",
            stderr: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const sessionStatePath = resolve(sessionStateDir, "session.json");
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const sessionState = JSON.parse(readFileSync(sessionStatePath, "utf8")) as {
      runtimeType: string;
      branchName: string;
      sessionId: string;
      runDir: string;
      promptFile: string;
      outputLog: string;
      issueDir: string;
    };
    expect(sessionState).toMatchObject({
      issueNumber,
      runtimeType: "codex",
      branchName,
      sessionId,
      runDir: `.prs/runs/${createdRunDir}`,
      promptFile: `.prs/runs/${createdRunDir}/prompt.md`,
      outputLog: `.prs/runs/${createdRunDir}/output.log`,
      issueDir: `.prs/issues/${issueNumber}-track-resumable-codex-issue-sessions`,
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });

    const metadata = JSON.parse(
      readFileSync(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"), "utf8")
    ) as {
      runtime?: {
        type?: string;
        invocation?: string;
        sessionId?: string;
      };
      branchName?: string;
    };
    expect(metadata).toMatchObject({
      branchName,
      runtime: {
        type: "codex",
        invocation: "new",
        sessionId,
      },
    });
    const issueFilePath = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      `${issueNumber}-track-resumable-codex-issue-sessions`,
      "issue.md"
    );
    expect(readFileSync(issueFilePath, "utf8")).toContain("## Resolution Plan");
    expect(readFileSync(issueFilePath, "utf8")).toContain(
      `Latest editable plan comment: https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-615`
    );
    expect(readFileSync(issueFilePath, "utf8")).toContain(
      "Generated plan summary for full issue execution."
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("resumes the saved Codex session for later full issue runs", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 149;
    const issueTitle = "Resume saved Codex sessions";
    const branchName = "feat/issue-149-resume-saved-codex-sessions";
    const sessionId = "019d5001-aaaa-7bbb-8ccc-ddddeeeeffff";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const sessionStatePath = resolve(sessionStateDir, "session.json");
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      `${issueNumber}-resume-saved-codex-sessions`
    );
    let gitStatusCallCount = 0;
    const gitCommands: string[][] = [];

    writeMockCodexSession(codexHome, sessionId, REPO_ROOT, "2026-04-01T09:20:00.000Z");
    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      sessionStatePath,
      `${JSON.stringify(
        {
          issueNumber,
          runtimeType: "codex",
          branchName,
          issueDir: `.prs/issues/${issueNumber}-resume-saved-codex-sessions`,
          runDir: ".prs/runs/20260401T090000000Z-issue-149",
          promptFile: ".prs/runs/20260401T090000000Z-issue-149/prompt.md",
          outputLog: ".prs/runs/20260401T090000000Z-issue-149/output.log",
          sessionId,
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-01T09:20:00.000Z",
          updatedAt: "2026-04-01T09:20:00.000Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: issueTitle,
          body: "Resume the same session instead of starting a new branch.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 9149,
            body: "<!-- prs:issue-plan -->\nResume plan.",
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9149`,
            updated_at: "2026-04-26T11:00:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "";

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const mode = "fresh";',
            '+const mode = "resume";',
          ].join("\n");
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

        if (command === "git") {
          gitCommands.push(args);
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          throw new Error("Resume path should not switch back to the base branch.");
        }

        if (command === "git" && args[0] === "pull") {
          throw new Error("Resume path should not pull the base branch.");
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          throw new Error("Resume path should not create a new branch.");
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", sessionId, "--sandbox", "workspace-write"]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
    expect(gitCommands).toContainEqual(["rev-parse", "--verify", branchName]);
    expect(gitCommands).toContainEqual(["checkout", branchName]);
    expect(gitCommands).not.toContainEqual(["checkout", "main"]);
    expect(gitCommands).not.toContainEqual(["pull"]);
    expect(gitCommands).not.toContainEqual(["checkout", "-b", branchName]);

    const metadata = JSON.parse(
      readFileSync(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"), "utf8")
    ) as {
      runtime?: {
        type?: string;
        invocation?: string;
        sessionId?: string;
      };
    };
    expect(metadata).toMatchObject({
      runtime: {
        type: "codex",
        invocation: "resume",
        sessionId,
      },
    });

    const updatedSessionState = JSON.parse(readFileSync(sessionStatePath, "utf8")) as {
      runDir: string;
      promptFile: string;
      outputLog: string;
    };
    expect(updatedSessionState).toMatchObject({
      runDir: `.prs/runs/${createdRunDir}`,
      promptFile: `.prs/runs/${createdRunDir}/prompt.md`,
      outputLog: `.prs/runs/${createdRunDir}/output.log`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when saved issue session state points to a missing Codex session", async () => {
    const issueNumber = 150;
    const branchName = "feat/issue-150-stale-codex-session-state";
    createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const sessionStatePath = resolve(sessionStateDir, "session.json");

    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      sessionStatePath,
      `${JSON.stringify(
        {
          issueNumber,
          runtimeType: "codex",
          branchName,
          issueDir: `.prs/issues/${issueNumber}-stale-codex-session-state`,
          runDir: ".prs/runs/20260401T092500000Z-issue-150",
          promptFile: ".prs/runs/20260401T092500000Z-issue-150/prompt.md",
          outputLog: ".prs/runs/20260401T092500000Z-issue-150/output.log",
          sessionId: "019d5002-0000-7111-8222-933344445555",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-01T09:25:00.000Z",
          updatedAt: "2026-04-01T09:25:00.000Z",
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
          title: "Stale Codex session state",
          body: "Fail with a recovery path when the saved session no longer exists.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
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

        if (command === "git" && args[0] === "checkout") {
          throw new Error("Stale session recovery should stop before branch checkout.");
        }

        if (command === "codex") {
          throw new Error("Stale session recovery should stop before launching Codex.");
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];

    let caughtError: unknown;
    try {
      await run();
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain(
      `Saved Codex session 019d5002-0000-7111-8222-933344445555 for issue #${issueNumber} is no longer available.`
    );
    expect((caughtError as Error).message).toContain(
      `remove .prs/issues/${issueNumber}/session.json and rerun \`prs issue ${issueNumber}\``
    );
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", "019d5002-0000-7111-8222-933344445555"]),
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts legacy unattended issue session state without runtimeType", async () => {
    const issueNumber = 151;
    const branchName = "feat/issue-151-legacy-unattended-session-state";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const sessionStatePath = resolve(sessionStateDir, "session.json");
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      `${issueNumber}-legacy-unattended-session-state`
    );
    let gitStatusCallCount = 0;
    const gitCommands: string[][] = [];

    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      sessionStatePath,
      `${JSON.stringify(
        {
          issueNumber,
          branchName,
          issueDir: `.prs/issues/${issueNumber}-legacy-unattended-session-state`,
          runDir: ".prs/runs/20260415T074750395Z-issue-151",
          promptFile: ".prs/runs/20260415T074750395Z-issue-151/prompt.md",
          outputLog: ".prs/runs/20260415T074750395Z-issue-151/output.log",
          executionMode: "unattended",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-15T07:47:50.464Z",
          updatedAt: "2026-04-15T07:47:50.464Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Legacy unattended session state",
          body: "Resume unattended runs created before runtimeType was persisted.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 9151,
            body: "<!-- prs:issue-plan -->\nLegacy unattended plan.",
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9151`,
            updated_at: "2026-04-26T11:05:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const mode = "before";',
            '+const mode = "after";',
          ].join("\n");
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

        if (command === "git") {
          gitCommands.push(args as string[]);
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          throw new Error("Legacy unattended resume should not switch to base branch.");
        }

        if (command === "git" && args[0] === "pull") {
          throw new Error("Legacy unattended resume should not pull the base branch.");
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          throw new Error("Legacy unattended resume should not create a new branch.");
        }

        if (command === "codex" && args[0] === "exec") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && (args[0] === "add" || args[0] === "commit" || args[0] === "push")) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: "https://github.com/DevwareUK/prs/pull/851\n",
            stderr: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "issue", String(issueNumber), "--mode", "unattended"];

    await run();

    expect(gitCommands).toContainEqual(["rev-parse", "--verify", branchName]);
    expect(gitCommands).toContainEqual(["checkout", branchName]);
    expect(gitCommands).not.toContainEqual(["checkout", "main"]);
    expect(gitCommands).not.toContainEqual(["pull"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 180000);

  it("continues with build and commit flow when Codex exits a full issue run", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 145;
    const branchName =
      "feat/issue-145-resume-issue-automation-after-the-codex-session";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "145-resume-issue-automation-after-the-codex-session"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Resume issue automation after the Codex session exits",
          body: "The outer issue workflow should continue after a normal Codex exit.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8145,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8145`,
          updated_at: "2026-04-26T11:09:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 9145,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9145`,
          updated_at: "2026-04-26T11:10:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(message === undefined ? "" : String(message));
    });

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const prompt = "old";',
            '+const prompt = "new";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return {
            status: 1,
            error: new Error("force API fallback"),
          };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: "https://github.com/DevwareUK/prs/pull/1450\n",
            stderr: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.any(Array),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "pnpm",
      ["build"],
      expect.objectContaining({
        encoding: "utf8",
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-F", expect.stringContaining("commit-message.txt")],
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-145$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const output = messages.join("\n");
    expect(output).toContain(`Prepared issue branch ${branchName}.`);
    expect(output).toContain("Codex exited; handing control back to prs.");
    expect(output).toContain("Issue #145 run summary:");
    expect(output).toContain("Pull request: https://github.com/DevwareUK/prs/pull/1450");

    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(metadata.outcome).toMatchObject({
      issueNumber: 145,
      branchName,
      baseBranch: "main",
      committed: true,
      pullRequest: {
        status: "created",
        url: "https://github.com/DevwareUK/prs/pull/1450",
      },
    });
  });

  it("summarizes skipped pull request creation when the issue commit is declined", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 1510;
    const branchName = "feat/issue-1510-decline-generated-issue-commit";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "1510-decline-generated-issue-commit"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Decline generated issue commit",
          body: "The workflow should explain that PR creation is skipped after commit decline.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8510,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8510`,
          updated_at: "2026-04-26T12:04:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 1510,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-1510`,
          updated_at: "2026-04-26T12:05:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(message === undefined ? "" : String(message));
    });

    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const state = "before";',
            '+const state = "after";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return {
            status: 1,
            error: new Error("force API fallback"),
          };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const output = messages.join("\n");
    expect(output).toContain("Skipping pull request creation because no commit was created.");
    expect(output).toContain("Pull request: skipped (commit-declined)");
    expect(spawnSync).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["push"]),
      expect.any(Object)
    );
    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-1510$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(metadata.outcome).toMatchObject({
      issueNumber,
      branchName,
      committed: false,
      pullRequest: {
        status: "skipped",
        reason: "commit-declined",
      },
    });
  });

  it("summarizes skipped pull request creation when the issue run produces no changes", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 1512;
    const branchName = "feat/issue-1512-no-generated-issue-changes";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "1512-no-generated-issue-changes"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "No generated issue changes",
          body: "The workflow should explain when the runtime leaves nothing to commit.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8512,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8512`,
          updated_at: "2026-04-26T12:14:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 1512,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-1512`,
          updated_at: "2026-04-26T12:15:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(message === undefined ? "" : String(message));
    });

    const { run, generateCommitMessage, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "diff") {
          return "";
        }

        if (
          command === "git" &&
          args[0] === "ls-files" &&
          args[1] === "--others" &&
          args[2] === "--exclude-standard"
        ) {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return {
            status: 1,
            error: new Error("force API fallback"),
          };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const output = messages.join("\n");
    expect(output).toContain(`Prepared issue branch ${branchName}.`);
    expect(output).toContain("The interactive runtime completed without producing any file changes to commit.");
    expect(output).toContain("Pull request: skipped (no-changes)");
    expect(generateCommitMessage).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["commit"]),
      expect.any(Object)
    );
    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-1512$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(metadata.outcome).toMatchObject({
      issueNumber,
      branchName,
      committed: false,
      pullRequest: {
        status: "skipped",
        reason: "no-changes",
      },
    });
  });

  it("commits and opens a pull request when an unattended issue run creates only untracked files", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 1513;
    const untrackedPath =
      "web/modules/custom/bos_sales_event/tests/src/Unit/Service/SalesEventManagerTest.php";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "1513-add-sales-event-manager-test"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Add sales event manager test",
          body: "The runtime should commit the generated untracked test file.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8513,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8513`,
          updated_at: "2026-04-26T12:19:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 1513,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-1513`,
          updated_at: "2026-04-26T12:20:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(message === undefined ? "" : String(message));
    });
    let gitStatusCallCount = 0;

    const { run, generateCommitMessage, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : `?? ${untrackedPath}\n`;
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "";
        }

        if (
          command === "git" &&
          args[0] === "ls-files" &&
          args[1] === "--others" &&
          args[2] === "--exclude-standard"
        ) {
          return `${untrackedPath}\n`;
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return {
            status: 1,
            error: new Error("force API fallback"),
          };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "--no-index" &&
          args.includes(untrackedPath)
        ) {
          return {
            status: 1,
            stdout: [
              `diff --git a/${untrackedPath} b/${untrackedPath}`,
              "new file mode 100644",
              "index 0000000..1111111",
              "--- /dev/null",
              `+++ b/${untrackedPath}`,
              "@@ -0,0 +1,1 @@",
              "+<?php",
            ].join("\n"),
            stderr: "",
          };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: "https://github.com/DevwareUK/prs/pull/1513\n",
            stderr: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber), "--mode", "unattended"];
    await run();

    expect(generateCommitMessage).not.toHaveBeenCalled();
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" && Array.isArray(args) && args[0] === "commit"
      )
    ).toBe(true);
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "gh" &&
          Array.isArray(args) &&
          args[0] === "pr" &&
          args[1] === "create"
      )
    ).toBe(true);
    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-1513$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    expect(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "commit-message.txt"),
        "utf8"
      )
    ).toContain("feat: address issue #1513");
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(metadata.outcome).toMatchObject({
      committed: true,
      pullRequest: {
        status: "created",
      },
    });
    expect(messages.join("\n")).toContain("Pull request: https://github.com/DevwareUK/prs/pull/1513");
  });

  it("completes an unattended Codex issue run without using provider-generated text", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 1517;
    const branchName = "feat/issue-1517-provider-free-unattended-finalization";
    const untrackedPath = "packages/cli/src/provider-free-finalize.ts";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "1517-provider-free-unattended-finalization"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Provider-free unattended finalization",
          body: "Do not require a provider after Codex has produced issue changes.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 8517,
            body: "<!-- prs:issue-spec -->\nGenerated spec.",
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8517`,
            updated_at: "2026-04-26T12:30:00Z",
          },
          {
            id: 1517,
            body: "<!-- prs:issue-plan -->\nGenerated plan.",
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-1517`,
            updated_at: "2026-04-26T12:31:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GITHUB_TOKEN = "test-token";
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(message === undefined ? "" : String(message));
    });
    let gitStatusCallCount = 0;

    const {
      run,
      generateCommitMessage,
      generatePRDescription,
      generatePRAssistant,
      spawnSync,
    } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : `?? ${untrackedPath}\n`;
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "";
        }

        if (
          command === "git" &&
          args[0] === "ls-files" &&
          args[1] === "--others" &&
          args[2] === "--exclude-standard"
        ) {
          return `${untrackedPath}\n`;
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return {
            status: 1,
            error: new Error("force API fallback"),
          };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "--no-index" &&
          args.includes(untrackedPath)
        ) {
          return {
            status: 1,
            stdout: [
              `diff --git a/${untrackedPath} b/${untrackedPath}`,
              "new file mode 100644",
              "index 0000000..1111111",
              "--- /dev/null",
              `+++ b/${untrackedPath}`,
              "@@ -0,0 +1,1 @@",
              "+export const finalized = true;",
            ].join("\n"),
            stderr: "",
          };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: "https://github.com/DevwareUK/prs/pull/1517\n",
            stderr: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber), "--jdi"];
    await run();

    expect(generateCommitMessage).not.toHaveBeenCalled();
    expect(generatePRDescription).not.toHaveBeenCalled();
    expect(generatePRAssistant).not.toHaveBeenCalled();
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" && Array.isArray(args) && args[0] === "commit"
      )
    ).toBe(true);
    expect(messages.join("\n")).toContain("Pull request: https://github.com/DevwareUK/prs/pull/1517");
    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-1517$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    expect(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "commit-message.txt"),
        "utf8"
      )
    ).toContain("feat: address issue #1517");
    expect(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "pull-request-title.txt"),
        "utf8"
      )
    ).toContain("Provider-free unattended finalization");
    expect(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "pull-request-body.md"),
        "utf8"
      )
    ).toContain("Closes #1517");
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(metadata.outcome).toMatchObject({
      issueNumber,
      branchName,
      committed: true,
      pullRequest: {
        status: "created",
      },
    });
    const orchestrationState = JSON.parse(
      readFileSync(
        resolve(
          REPO_ROOT,
          ".prs",
          "runs",
          createdRunDir as string,
          "issue-orchestration-state.json"
        ),
        "utf8"
      )
    ) as {
      issueNumber: number;
      prNumber: number;
      stages: Array<{ name: string; status: string }>;
    };
    expect(orchestrationState).toMatchObject({
      issueNumber,
      prNumber: 1517,
    });
    expect(orchestrationState.stages.map((stage) => [stage.name, stage.status])).toEqual([
      ["prepare", "complete"],
      ["implement", "complete"],
      ["local-verify", "complete"],
      ["open-pr", "complete"],
      ["pr-ready", "complete"],
      ["pr-review", "skipped"],
      ["publish-review", "skipped"],
      ["address-comments", "skipped"],
      ["wait-ci", "skipped"],
      ["fix-ci", "skipped"],
      ["final-audit", "skipped"],
      ["ready-for-review", "skipped"],
    ]);
  });

  it("records a skipped no-changes outcome when an unattended issue run produces no changes", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 1514;
    const branchName = "feat/issue-1514-no-unattended-generated-changes";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "1514-no-unattended-generated-changes"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "No unattended generated changes",
          body: "The unattended workflow should complete as skipped when no files changed.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8514,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8514`,
          updated_at: "2026-04-26T12:24:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 1514,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-1514`,
          updated_at: "2026-04-26T12:25:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(message === undefined ? "" : String(message));
    });

    const { run, generateCommitMessage, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "diff") {
          return "";
        }

        if (
          command === "git" &&
          args[0] === "ls-files" &&
          args[1] === "--others" &&
          args[2] === "--exclude-standard"
        ) {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return {
            status: 1,
            error: new Error("force API fallback"),
          };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber), "--mode", "unattended"];
    await run();

    const output = messages.join("\n");
    expect(output).toContain("The interactive runtime completed without producing any file changes to commit.");
    expect(output).toContain("Pull request: skipped (no-changes)");
    expect(generateCommitMessage).not.toHaveBeenCalled();
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" && Array.isArray(args) && args[0] === "commit"
      )
    ).toBe(false);
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "gh" &&
          Array.isArray(args) &&
          args[0] === "pr" &&
          args[1] === "create"
      )
    ).toBe(false);
    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-1514$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(metadata.outcome).toMatchObject({
      issueNumber,
      branchName,
      committed: false,
      pullRequest: {
        status: "skipped",
        reason: "no-changes",
      },
    });
  });

  it("uses unattended Codex for Superpowers plan preflight during unattended issue runs", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 1516;
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "1516-superpowers-plan-preflight"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    createMockCodexSuperpowersHome();

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Superpowers plan preflight",
          body: "The unattended issue workflow should generate plans without a terminal.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        return createFetchResponse({
          id: 1516,
          body: JSON.parse(String(init.body)).body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-1516`,
          updated_at: "2026-05-12T15:10:00Z",
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    const codexExecArgs: string[][] = [];

    await withRepositoryConfig(
      JSON.stringify({
        ai: {
          issue: {
            useCodexSuperpowers: true,
          },
          runtime: {
            type: "codex",
          },
          provider: {
            type: "openai",
          },
        },
        baseBranch: "main",
        buildCommand: ["pnpm", "build"],
        forge: {
          type: "github",
        },
      }),
      async () => {
        const { run, generateCommitMessage, spawnSync } = await loadCli({
          execFileSyncImpl: (command, args) => {
            if (command === "git" && args[0] === "status") {
              return "";
            }

            if (command === "git" && args[0] === "diff") {
              return "";
            }

            if (
              command === "git" &&
              args[0] === "ls-files" &&
              args[1] === "--others" &&
              args[2] === "--exclude-standard"
            ) {
              return "";
            }

            if (command === "git" && args[0] === "remote") {
              return "git@github.com:DevwareUK/prs.git\n";
            }

            throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
          },
          spawnSyncImpl: (command, args) => {
            if (command === "gh" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "gh" && args[0] === "auth" && args[1] === "status") {
              return { status: 0 };
            }

            if (command === "gh" && args[0] === "issue" && args[1] === "view") {
              return {
                status: 1,
                error: new Error("force API fallback"),
              };
            }

            if (command === "git" && args[0] === "rev-parse") {
              return { status: 1 };
            }

            if (command === "git" && args[0] === "checkout" && args[1] === "main") {
              return { status: 0 };
            }

            if (command === "git" && args[0] === "pull") {
              return { status: 0 };
            }

            if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
              return { status: 0 };
            }

            if (command === "codex" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "codex" && args[0] === "exec") {
              codexExecArgs.push([...args]);
              const { metadata, runDir } = readLatestRunMetadata();
              if (String(metadata.runDir).includes(`issue-plan-${issueNumber}`)) {
                writeFileSync(
                  resolve(REPO_ROOT, metadata.runDir as string, "superpowers-plan.md"),
                  "# Superpowers Plan\n\n- Use the unattended plan preflight.\n",
                  "utf8"
                );
                cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
              }
              return { status: 0 };
            }

            if (command === "pnpm" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "pnpm" && args[0] === "build") {
              return { status: 0, stdout: "built\n", stderr: "" };
            }

            throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
          },
        });

        process.argv = ["node", "prs", "issue", String(issueNumber), "--mode", "unattended"];
        await run();

        expect(codexExecArgs[0]).toContain("--full-auto");
        expect(codexExecArgs[0]).toContain("--cd");
        expect(codexExecArgs[0]).toContain(REPO_ROOT);
        expect(
          spawnSync.mock.calls.some(
            ([command, args]) =>
              command === "codex" &&
              Array.isArray(args) &&
              args[0] === "--sandbox"
          )
        ).toBe(false);
        expect(generateCommitMessage).not.toHaveBeenCalled();
      }
    );

    for (const runDir of listRunDirectories().filter((entry) => !beforeRuns.includes(entry))) {
      cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
    }
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/issues/${issueNumber}/comments`),
      expect.objectContaining({
        method: "POST",
      })
    );
    const postedCommentBodies = fetchMock.mock.calls
      .filter(
        ([input, init]) =>
          String(input).endsWith(`/issues/${issueNumber}/comments`) &&
          (init as RequestInit | undefined)?.method === "POST"
      )
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)).body as string);
    expect(postedCommentBodies).toEqual(
      expect.arrayContaining([
        expect.stringContaining(UNATTENDED_GITHUB_OUTPUT_NOTE),
      ])
    );
    expect(postedCommentBodies.every((body) => body.startsWith("<!-- prs:"))).toBe(true);
  });

  it("summarizes manual pull request creation when GitHub authentication is unavailable", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 1511;
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "1511-manual-pr-when-github-auth-is-unavailable"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Manual PR when GitHub auth is unavailable",
          body: "The workflow should preserve manual PR guidance and summarize the outcome.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 1511,
            body: "<!-- prs:issue-plan -->\nGenerated plan.",
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-1511`,
            updated_at: "2026-04-26T12:10:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "";
    process.env.GH_TOKEN = "";
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(message === undefined ? "" : String(message));
    });

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const auth = "before";',
            '+const auth = "after";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh unavailable") };
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return {
            status: 1,
            error: new Error("force API fallback"),
          };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const output = messages.join("\n");
    expect(output).toContain("GitHub CLI is unavailable or not authenticated.");
    expect(output).toContain("Pull request: manual creation required");
    expect(output).toContain("PR title file: .prs/runs/");
    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-1511$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(metadata.outcome).toMatchObject({
      issueNumber,
      committed: true,
      pullRequest: {
        status: "manual",
      },
    });
  });

  it("does not use provider PR description generation during full issue runs", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 147;
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "147-persist-pr-description-diagnostics-in-issue-runs"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Persist PR description diagnostics in issue runs",
          body: "The issue workflow should preserve failed PR description payloads locally.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8147,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8147`,
          updated_at: "2026-04-26T11:14:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 9147,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9147`,
          updated_at: "2026-04-26T11:15:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

    const { run, generatePRDescription, StructuredGenerationError, spawnSync } =
      await loadCli({
        execFileSyncImpl: (command, args) => {
          if (command === "git" && args[0] === "status") {
            gitStatusCallCount += 1;
            return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
          }

          if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
            return "packages/cli/src/index.ts\n";
          }

          if (
            command === "git" &&
            args[0] === "diff" &&
            args[1] === "HEAD" &&
            args[2] === "--" &&
            args[3] === "packages/cli/src/index.ts"
          ) {
            return [
              "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
              "--- a/packages/cli/src/index.ts",
              "+++ b/packages/cli/src/index.ts",
              "@@ -1,1 +1,1 @@",
              '-const state = "before";',
              '+const state = "after";',
            ].join("\n");
          }

          if (command === "git" && args[0] === "remote") {
            return "git@github.com:DevwareUK/prs.git\n";
          }

          throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
        },
        spawnSyncImpl: (command, args) => {
          if (command === "gh" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "auth" && args[1] === "status") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "issue" && args[1] === "view") {
            return {
              status: 1,
              error: new Error("force API fallback"),
            };
          }

          if (command === "git" && args[0] === "rev-parse") {
            return { status: 1 };
          }

          if (command === "git" && args[0] === "checkout" && args[1] === "main") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "pull") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
            return { status: 0 };
          }

          if (command === "codex" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "codex") {
            return { status: 0 };
          }

          if (command === "pnpm" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "pnpm" && args[0] === "build") {
            return { status: 0, stdout: "built\n", stderr: "" };
          }

          if (command === "git" && args[0] === "add") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "commit") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "push") {
            return { status: 0, stdout: "", stderr: "" };
          }

          if (command === "gh" && args[0] === "pr" && args[1] === "create") {
            return {
              status: 0,
              stdout: "https://github.com/DevwareUK/prs/pull/1470\n",
              stderr: "",
            };
          }

          throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
        },
      });

    generatePRDescription.mockRejectedValue(
      new StructuredGenerationError({
        kind: "schema_validation",
        message: [
          "Model output failed PR description schema validation:",
          "- body: Invalid input: expected string, received undefined",
        ].join("\n"),
        rawResponse: '{"title":"feat: broken"}',
        parsedJson: {
          title: "feat: broken",
        },
        normalizedJson: {
          title: "feat: broken",
        },
        validationIssues: [
          {
            path: "body",
            message: "Invalid input: expected string, received undefined",
            code: "invalid_type",
          },
        ],
      })
    );

    process.argv = ["node", "prs", "issue", String(issueNumber)];

    await run();

    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-147$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const artifactRelativePath = `.prs/runs/${createdRunDir}/pr-description-generation-error.json`;
    expect(existsSync(resolve(REPO_ROOT, artifactRelativePath))).toBe(false);
    expect(generatePRDescription).not.toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledWith(
      "pnpm",
      ["build"],
      expect.objectContaining({
        encoding: "utf8",
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 30_000);

  it("uses repository config for issue build verification and pull request base branch", async () => {
    const issueNumber = 144;
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "144-use-repository-config-in-issue-runs"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    const configPath = resolve(REPO_ROOT, ".prs", "config.json");
    const hadOriginalConfig = existsSync(configPath);
    const originalConfig = hadOriginalConfig ? readFileSync(configPath, "utf8") : undefined;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          baseBranch: "develop",
          buildCommand: ["npm", "run", "verify"],
        },
        null,
        2
      )
    );

    let gitStatusCallCount = 0;
    const gitCommands: string[][] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Use repository config in issue runs",
          body: "Verify issue automation reads .prs/config.json.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8144,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8144`,
          updated_at: "2026-04-26T11:19:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 9144,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9144`,
          updated_at: "2026-04-26T11:20:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

    try {
      const { run, spawnSync } = await loadCli({
        prDescriptionResult: {
          title: "refactor: use configured issue run defaults",
          body: [
            "Use repository config defaults throughout the issue workflow.",
            "",
            "- Read the configured base branch before preparing the issue branch.",
            "- Use the configured build command before finalizing issue work.",
          ].join("\n"),
        },
        prAssistantResult: {
          summary: "Keeps issue-created pull requests aligned with repository configuration.",
          riskAreas: [],
          filesChanged: ["packages/cli/src/index.ts"],
          testingNotes: ["npm run verify"],
          rolloutConcerns: [],
          reviewerChecklist: [
            "Verify the workflow honors the configured base branch and build command.",
          ],
        },
        execFileSyncImpl: (command, args) => {
          if (command === "git" && args[0] === "status") {
            gitStatusCallCount += 1;
            return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
          }

          if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
            return "packages/cli/src/index.ts\n";
          }

          if (
            command === "git" &&
            args[0] === "diff" &&
            args[1] === "HEAD" &&
            args[2] === "--" &&
            args[3] === "packages/cli/src/index.ts"
          ) {
            return [
              "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
              "--- a/packages/cli/src/index.ts",
              "+++ b/packages/cli/src/index.ts",
              "@@ -1,1 +1,2 @@",
              "-const config = defaultConfig;",
              "+const config = loadConfig();",
              '+const baseBranch = "develop";',
            ].join("\n");
          }

          if (command === "git" && args[0] === "remote") {
            return "git@github.com:DevwareUK/prs.git\n";
          }

          throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
        },
        spawnSyncImpl: (command, args) => {
          if (command === "gh" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "auth" && args[1] === "status") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "issue" && args[1] === "view") {
            return {
              status: 1,
              error: new Error("force API fallback"),
            };
          }

          if (
            command === "git" &&
            args[0] === "rev-parse" &&
            args[1] === "--verify" &&
            args[2] === "refs/heads/develop"
          ) {
            gitCommands.push(args);
            return { status: 0, stdout: "develop-local-tip\n", stderr: "" };
          }

          if (
            command === "git" &&
            args[0] === "fetch" &&
            args[1] === "origin" &&
            args[2] === "develop"
          ) {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (
            command === "git" &&
            args[0] === "rev-parse" &&
            args[1] === "--verify" &&
            args[2] === "refs/remotes/origin/develop"
          ) {
            gitCommands.push(args);
            return { status: 0, stdout: "develop-remote-tip\n", stderr: "" };
          }

          if (command === "git" && args[0] === "rev-parse") {
            gitCommands.push(args);
            return { status: 1 };
          }

          if (command === "git" && args[0] === "checkout" && args[1] === "develop") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (
            command === "git" &&
            args[0] === "merge-base" &&
            args[1] === "--is-ancestor" &&
            args[2] === "develop-remote-tip" &&
            args[3] === "HEAD"
          ) {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "git" && args[0] === "pull") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "codex" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "codex") {
            return { status: 0 };
          }

          if (command === "npm" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "npm" && args[0] === "run" && args[1] === "verify") {
            return { status: 0, stdout: "verified\n", stderr: "" };
          }

          if (command === "git" && args[0] === "add") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "commit") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "push") {
            return { status: 0, stdout: "", stderr: "" };
          }

          if (command === "gh" && args[0] === "pr" && args[1] === "create") {
            return { status: 0, stdout: "", stderr: "" };
          }

          throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
        },
      });

      process.argv = ["node", "prs", "issue", String(issueNumber)];
      await run();

      expect(gitCommands).toEqual([
        ["rev-parse", "--verify", "refs/heads/develop"],
        ["fetch", "origin", "develop"],
        ["rev-parse", "--verify", "refs/remotes/origin/develop"],
        ["rev-parse", "--verify", "feat/issue-144-use-repository-config-in-issue-runs"],
        ["checkout", "develop"],
        ["merge-base", "--is-ancestor", "develop-remote-tip", "HEAD"],
        ["checkout", "-b", "feat/issue-144-use-repository-config-in-issue-runs"],
      ]);
      expect(spawnSync).toHaveBeenCalledWith(
        "npm",
        ["run", "verify"],
        expect.objectContaining({
          encoding: "utf8",
        })
      );
      const prCreateCall = spawnSync.mock.calls.find(
        ([command, args]) =>
          command === "gh" &&
          Array.isArray(args) &&
          args[0] === "pr" &&
          args[1] === "create"
      );
      expect(prCreateCall).toBeDefined();
      const prArgs = prCreateCall?.[1] as string[];
      expect(prArgs[prArgs.indexOf("--title") + 1]).toBe(
        "Use repository config in issue runs"
      );
      expect(prArgs[prArgs.indexOf("--base") + 1]).toBe("develop");
      const prBodyFilePath = prArgs[prArgs.indexOf("--body-file") + 1];
      const prBody = readFileSync(prBodyFilePath, "utf8");
      expect(prBody).toContain(`Implements #${issueNumber}: Use repository config in issue runs.`);
      expect(prBody).toContain(`Closes #${issueNumber}`);
      expect(prBody).toContain(
        "<!-- prs:pr-assistant:start -->"
      );
    } finally {
      if (hadOriginalConfig && originalConfig !== undefined) {
        writeFileSync(configPath, originalConfig);
      } else {
        rmSync(configPath, { force: true });
      }
    }
  });

  it("adds the linked source issue closing reference for PRS-created linked issues", async () => {
    const issueNumber = 245;
    const sourceIssueNumber = 244;
    const beforeRuns = listRunDirectories();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "245-implement-linked-source-work"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Implement linked source work",
          body: [
            "<!-- prs:managed-issue -->",
            "",
            `Refined from source issue #${sourceIssueNumber}.`,
            "",
            "## Summary",
            "Implement the linked source request.",
          ].join("\n"),
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8245,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8245`,
          updated_at: "2026-04-26T11:44:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 9245,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9245`,
          updated_at: "2026-04-26T11:45:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

    const { run, spawnSync } = await loadCli({
      prDescriptionResult: {
        title: "feat: implement linked source work",
        body: "Implements the linked source request.",
      },
      prAssistantResult: {
        summary: "Implements the linked source request.",
        riskAreas: [],
        filesChanged: ["packages/cli/src/index.ts"],
        testingNotes: ["pnpm exec vitest run packages/cli/src/index.test.ts"],
        rolloutConcerns: [],
        reviewerChecklist: ["Confirm both linked issues close from the PR body."],
      },
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }
        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }
        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts";
        }
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }
        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") return { status: 0 };
        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }
        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return { status: 1 };
        }
        if (command === "git" && args[0] === "rev-parse") return { status: 1 };
        if (command === "git" && args[0] === "checkout") return { status: 0 };
        if (command === "git" && args[0] === "fetch") return { status: 0 };
        if (command === "git" && args[0] === "merge-base") return { status: 0 };
        if (command === "git" && args[0] === "add") return { status: 0 };
        if (command === "git" && args[0] === "commit") return { status: 0 };
        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }
        if (command === "codex" && args[0] === "--version") return { status: 0 };
        if (command === "codex") return { status: 0 };
        if (command === "pnpm" && args[0] === "--version") return { status: 0 };
        if (command === "pnpm" && args[0] === "build") return { status: 0 };
        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return { status: 0 };
        }
        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-245$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const prCreateCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "gh" &&
        Array.isArray(args) &&
        args[0] === "pr" &&
        args[1] === "create"
    );
    expect(prCreateCall).toBeDefined();
    const prArgs = prCreateCall?.[1] as string[];
    const prBody = readFileSync(prArgs[prArgs.indexOf("--body-file") + 1], "utf8");

    expect(prBody).toContain(`Closes #${issueNumber}`);
    expect(prBody).toContain(`Closes #${sourceIssueNumber}`);
  });

  it("creates PRs from the generated body file so markdown newlines are preserved", async () => {
    const issueNumber = 248;
    const beforeRuns = listRunDirectories();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "248-preserve-pr-body-file-markdown-newlines"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Preserve PR body markdown newlines",
          body: [
            "Keep the PR body formatting intact.",
            "",
            "This issue description includes a hard line break.",
          ].join("\n"),
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8248,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8248`,
          updated_at: "2026-04-26T11:47:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 9248,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9248`,
          updated_at: "2026-04-26T11:48:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

    const { run, spawnSync } = await loadCli({
      prDescriptionResult: {
        title: "feat: preserve PR body markdown newlines",
        body: "Generated PR body.",
      },
      prAssistantResult: {
        summary: "Preserves markdown formatting in the generated PR body file.",
        riskAreas: [],
        filesChanged: ["packages/cli/src/index.ts"],
        testingNotes: ["pnpm exec vitest run packages/cli/src/issue-run.test.ts"],
        rolloutConcerns: [],
        reviewerChecklist: ["Confirm the body file keeps its markdown line breaks."],
      },
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }
        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }
        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts";
        }
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }
        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") return { status: 0 };
        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }
        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return { status: 1 };
        }
        if (command === "git" && args[0] === "rev-parse") return { status: 1 };
        if (command === "git" && args[0] === "checkout") return { status: 0 };
        if (command === "git" && args[0] === "fetch") return { status: 0 };
        if (command === "git" && args[0] === "merge-base") return { status: 0 };
        if (command === "git" && args[0] === "add") return { status: 0 };
        if (command === "git" && args[0] === "commit") return { status: 0 };
        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }
        if (command === "codex" && args[0] === "--version") return { status: 0 };
        if (command === "codex") return { status: 0 };
        if (command === "pnpm" && args[0] === "--version") return { status: 0 };
        if (command === "pnpm" && args[0] === "build") return { status: 0 };
        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return { status: 0 };
        }
        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-248$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    const runDir = resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string);
    cleanupTargets.add(runDir);

    const bodyFilePath = resolve(runDir, "pull-request-body.md");
    expect(readFileSync(bodyFilePath, "utf8")).toContain(
      "\n\n<!-- prs:pr-assistant:start -->\n## PR Assistant\n\n### Summary\n"
    );

    const prCreateCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "gh" &&
        Array.isArray(args) &&
        args[0] === "pr" &&
        args[1] === "create"
    );
    expect(prCreateCall).toBeDefined();
    const prArgs = prCreateCall?.[1] as string[];
    expect(prArgs).toContain("--body-file");
    expect(prArgs).not.toContain("--body");
    expect(prArgs[prArgs.indexOf("--body-file") + 1]).toBe(bodyFilePath);
  });

  it("does not duplicate existing closing references for PRS-created linked issues", async () => {
    const issueNumber = 246;
    const sourceIssueNumber = 244;
    const beforeRuns = listRunDirectories();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "246-deduplicate-linked-source-work"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Deduplicate linked source work",
          body: [
            "<!-- prs:managed-issue -->",
            "",
            `Refined from source issue #${sourceIssueNumber}.`,
            "",
            "## Summary",
            "Implement the linked source request.",
          ].join("\n"),
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8246,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8246`,
          updated_at: "2026-04-26T11:45:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 9246,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9246`,
          updated_at: "2026-04-26T11:46:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

    const { run, spawnSync } = await loadCli({
      prDescriptionResult: {
        title: "feat: deduplicate linked source work",
        body: [
          "Implements the linked source request.",
          "",
          `Closes #${sourceIssueNumber}`,
        ].join("\n"),
      },
      prAssistantResult: {
        summary: "Implements the linked source request.",
        riskAreas: [],
        filesChanged: ["packages/cli/src/index.ts"],
        testingNotes: ["pnpm exec vitest run packages/cli/src/index.test.ts"],
        rolloutConcerns: [],
        reviewerChecklist: ["Confirm duplicate closing references are not added."],
      },
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }
        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }
        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts";
        }
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }
        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") return { status: 0 };
        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }
        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return { status: 1 };
        }
        if (command === "git" && args[0] === "rev-parse") return { status: 1 };
        if (command === "git" && args[0] === "checkout") return { status: 0 };
        if (command === "git" && args[0] === "fetch") return { status: 0 };
        if (command === "git" && args[0] === "merge-base") return { status: 0 };
        if (command === "git" && args[0] === "add") return { status: 0 };
        if (command === "git" && args[0] === "commit") return { status: 0 };
        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }
        if (command === "codex" && args[0] === "--version") return { status: 0 };
        if (command === "codex") return { status: 0 };
        if (command === "pnpm" && args[0] === "--version") return { status: 0 };
        if (command === "pnpm" && args[0] === "build") return { status: 0 };
        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return { status: 0 };
        }
        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-246$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const prCreateCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "gh" &&
        Array.isArray(args) &&
        args[0] === "pr" &&
        args[1] === "create"
    );
    expect(prCreateCall).toBeDefined();
    const prArgs = prCreateCall?.[1] as string[];
    const prBody = readFileSync(prArgs[prArgs.indexOf("--body-file") + 1], "utf8");

    expect(prBody.match(new RegExp(`Closes #${issueNumber}`, "g"))).toHaveLength(1);
    expect(prBody.match(new RegExp(`Closes #${sourceIssueNumber}`, "g"))).toHaveLength(1);
  });

  it("ignores linked source issue text in non-managed issues", async () => {
    const issueNumber = 247;
    const sourceIssueNumber = 244;
    const beforeRuns = listRunDirectories();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "247-ignore-freeform-linked-source-text"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Ignore freeform linked source text",
          body: [
            `Refined from source issue #${sourceIssueNumber}.`,
            "",
            "This is ordinary issue text, not PRS-owned metadata.",
          ].join("\n"),
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 8247,
          body: "<!-- prs:issue-spec -->\nGenerated spec.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-8247`,
          updated_at: "2026-04-26T11:46:00Z",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 9247,
          body: "<!-- prs:issue-plan -->\nGenerated plan.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9247`,
          updated_at: "2026-04-26T11:47:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

    const { run, spawnSync } = await loadCli({
      prDescriptionResult: {
        title: "feat: ignore freeform linked source text",
        body: "Implements the ordinary issue request.",
      },
      prAssistantResult: {
        summary: "Implements the ordinary issue request.",
        riskAreas: [],
        filesChanged: ["packages/cli/src/index.ts"],
        testingNotes: ["pnpm exec vitest run packages/cli/src/index.test.ts"],
        rolloutConcerns: [],
        reviewerChecklist: ["Confirm non-managed metadata is ignored."],
      },
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }
        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }
        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts";
        }
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }
        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") return { status: 0 };
        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }
        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return { status: 1 };
        }
        if (command === "git" && args[0] === "rev-parse") return { status: 1 };
        if (command === "git" && args[0] === "checkout") return { status: 0 };
        if (command === "git" && args[0] === "fetch") return { status: 0 };
        if (command === "git" && args[0] === "merge-base") return { status: 0 };
        if (command === "git" && args[0] === "add") return { status: 0 };
        if (command === "git" && args[0] === "commit") return { status: 0 };
        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }
        if (command === "codex" && args[0] === "--version") return { status: 0 };
        if (command === "codex") return { status: 0 };
        if (command === "pnpm" && args[0] === "--version") return { status: 0 };
        if (command === "pnpm" && args[0] === "build") return { status: 0 };
        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return { status: 0 };
        }
        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find(
      (entry) => !beforeRuns.includes(entry) && /-issue-247$/.test(entry)
    );
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const prCreateCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "gh" &&
        Array.isArray(args) &&
        args[0] === "pr" &&
        args[1] === "create"
    );
    expect(prCreateCall).toBeDefined();
    const prArgs = prCreateCall?.[1] as string[];
    const prBody = readFileSync(prArgs[prArgs.indexOf("--body-file") + 1], "utf8");

    expect(prBody).toContain(`Closes #${issueNumber}`);
    expect(prBody).not.toContain(`Closes #${sourceIssueNumber}`);
  });

  it("fails issue preparation clearly when fast-forwarding the configured base branch fails", async () => {
    const issueNumber = 146;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Surface git pull failures during issue prep",
          body: "The issue workflow should stop if updating the base branch fails.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 616,
            body: "<!-- prs:issue-plan -->\nGenerated plan without likely files.",
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-616`,
            updated_at: "2026-04-26T10:55:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
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

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "refs/heads/main"
        ) {
          return { status: 0, stdout: "main-local-tip\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "main"
        ) {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "refs/remotes/origin/main"
        ) {
          return { status: 0, stdout: "main-remote-tip\n", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "main-remote-tip" &&
          args[3] === "HEAD"
        ) {
          return { status: 1 };
        }

        if (
          command === "git" &&
          args[0] === "merge" &&
          args[1] === "--ff-only" &&
          args[2] === "origin/main"
        ) {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          throw new Error("Issue branch should not be created after a failed fast-forward.");
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "prepare", String(issueNumber)];

    await expect(run()).rejects.toThrow(
      'Failed to fast-forward base branch "main" to origin/main.'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

});
