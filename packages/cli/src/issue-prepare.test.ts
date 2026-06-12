import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  REPO_ROOT,
  cleanupTargets,
  getRepositoryIssueUrl,
  createIssueResolutionPlanResult,
  createFetchResponse,
  captureStdout,
  parseJsonPayloadFromOutput,
  loadCli,
} from "./index-test-support";

describe("Issue prepare workflow", () => {
  it("prepares an issue run and writes automation artifacts", async () => {
    const issueNumber = 91234;
    const issueTitle = "CLI issue prepare integration fixture";
    const outputDir = mkdtempSync(resolve(tmpdir(), "prs-cli-issue-prepare-"));
    const githubOutputPath = resolve(outputDir, "github-output.txt");
    writeFileSync(githubOutputPath, "");
    cleanupTargets.add(outputDir);
    const gitCommands: string[][] = [];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: issueTitle,
          body: "Ensure issue prepare writes the expected workspace files.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 613,
            body: [
              "<!-- prs:issue-plan -->",
              "## Issue Resolution Plan",
              "",
              "Edited plan from GitHub.",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-613`,
            updated_at: "2026-03-18T11:30:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      issueResolutionPlanResult: createIssueResolutionPlanResult(),
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
          return { status: 1, error: new Error("codex is unavailable") };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "refs/heads/main"
        ) {
          gitCommands.push(args);
          return { status: 0, stdout: "main-local-tip\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "main"
        ) {
          gitCommands.push(args);
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "refs/remotes/origin/main"
        ) {
          gitCommands.push(args);
          return { status: 0, stdout: "main-remote-tip\n", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse") {
          gitCommands.push(args);
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          gitCommands.push(args);
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "main-remote-tip" &&
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

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_OUTPUT = githubOutputPath;
    process.argv = [
      "node",
      "prs",
      "issue",
      "prepare",
      String(issueNumber),
      "--mode",
      "github-action",
    ];

    const stdout = captureStdout();
    await run();

    const output = parseJsonPayloadFromOutput(stdout.output()) as {
      branchName: string;
      issueFile: string;
      promptFile: string;
      metadataFile: string;
      outputLog: string;
      runDir: string;
      mode: string;
    };
    const issueFilePath = resolve(REPO_ROOT, output.issueFile);
    const promptFilePath = resolve(REPO_ROOT, output.promptFile);
    const metadataFilePath = resolve(REPO_ROOT, output.metadataFile);
    const outputLogPath = resolve(REPO_ROOT, output.outputLog);
    const runDirPath = resolve(REPO_ROOT, output.runDir);

    cleanupTargets.add(dirname(issueFilePath));
    cleanupTargets.add(runDirPath);

    expect(gitCommands).toEqual([
      ["rev-parse", "--verify", "refs/heads/main"],
      ["fetch", "origin", "main"],
      ["rev-parse", "--verify", "refs/remotes/origin/main"],
      ["rev-parse", "--verify", "feat/issue-91234-cli-issue-prepare-integration-fixture"],
      ["checkout", "main"],
      ["merge-base", "--is-ancestor", "main-remote-tip", "HEAD"],
      ["checkout", "-b", "feat/issue-91234-cli-issue-prepare-integration-fixture"],
    ]);
    expect(output.branchName).toBe("feat/issue-91234-cli-issue-prepare-integration-fixture");
    expect(output.mode).toBe("github-action");
    expect(readFileSync(issueFilePath, "utf8")).toContain(`- Issue number: ${issueNumber}`);
    expect(readFileSync(issueFilePath, "utf8")).toContain(`- Title: ${issueTitle}`);
    expect(readFileSync(issueFilePath, "utf8")).toContain("## Resolution Plan");
    expect(readFileSync(issueFilePath, "utf8")).toContain("Edited plan from GitHub.");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "You are running inside a GitHub Actions workflow via the configured interactive coding runtime."
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "if the issue snapshot includes a resolution plan, treat it as the latest plan of record"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      `Read the issue snapshot at \`${output.issueFile}\` before making changes.`
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain("✅ Implementation complete");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "Ready for the next automation step"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "do not ask for input or wait for a reply after printing the done state"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain("# prs issue run log");
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      issueNumber,
      issueTitle,
      branchName: output.branchName,
      issueFile: output.issueFile,
      promptFile: output.promptFile,
      outputLog: output.outputLog,
      issuePlanCommentUrl:
        `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-613`,
      mode: "github-action",
    });
    expect(readFileSync(githubOutputPath, "utf8")).toContain("branch_name<<");
    expect(readFileSync(githubOutputPath, "utf8")).toContain(output.branchName);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates a managed issue plan comment before issue prepare writes the snapshot", async () => {
    const issueNumber = 91235;
    const issueTitle = "Prepare missing issue plan fixture";
    const gitCommands: string[][] = [];
    const issuePlan = {
      ...createIssueResolutionPlanResult(),
      summary: "Generated plan summary for prepare.",
    };
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: issueTitle,
          body: "Ensure missing plans are created before snapshots.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        return createFetchResponse({
          id: 614,
          body: JSON.parse(String(init.body)).body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-614`,
          updated_at: "2026-04-26T10:35:00Z",
        });
      }

      if (url.endsWith("/pulls?state=open&per_page=100")) {
        return createFetchResponse([]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { run, generateIssueResolutionPlan } = await loadCli({
      issueResolutionPlanResult: issuePlan,
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
          return { status: 1, error: new Error("codex is unavailable") };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "refs/heads/main"
        ) {
          gitCommands.push(args);
          return { status: 0, stdout: "main-local-tip\n", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch") {
          gitCommands.push(args);
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "refs/remotes/origin/main"
        ) {
          gitCommands.push(args);
          return { status: 0, stdout: "main-remote-tip\n", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse") {
          gitCommands.push(args);
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout") {
          gitCommands.push(args);
          return { status: 0 };
        }

        if (command === "git" && args[0] === "merge-base") {
          gitCommands.push(args);
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "issue", "prepare", String(issueNumber)];

    const stdout = captureStdout();
    await run();

    const output = parseJsonPayloadFromOutput(stdout.output()) as {
      issueFile: string;
      runDir: string;
    };
    const issueFilePath = resolve(REPO_ROOT, output.issueFile);
    const runDirPath = resolve(REPO_ROOT, output.runDir);
    cleanupTargets.add(dirname(issueFilePath));
    cleanupTargets.add(runDirPath);

    expect(generateIssueResolutionPlan).toHaveBeenCalledWith(expect.any(Object), {
      issueNumber,
      issueTitle,
      issueBody: "Ensure missing plans are created before snapshots.",
      issueUrl: getRepositoryIssueUrl(issueNumber),
    });
    expect(readFileSync(issueFilePath, "utf8")).toContain("## Resolution Plan");
    expect(readFileSync(issueFilePath, "utf8")).toContain(
      `Latest editable plan comment: https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-614`
    );
    expect(readFileSync(issueFilePath, "utf8")).toContain(
      "Generated plan summary for prepare."
    );
  });

  it("stops interactive issue preparation before branch creation when review-first overlap remains", async () => {
    const issueNumber = 91236;
    const issueTitle = "Stop before overlapping PR branch";
    const gitCommands: string[][] = [];
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: issueTitle,
          body: "Avoid starting duplicate work while an open PR changes the same files.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([
          {
            id: 617,
            body: [
              "<!-- prs:issue-plan -->",
              "### Likely files",
              "",
              "- packages/cli/src/index.ts",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-617`,
            updated_at: "2026-04-26T13:05:00Z",
          },
        ]);
      }

      if (url.endsWith("/pulls?state=open&per_page=100")) {
        return createFetchResponse([
          {
            number: 123,
            title: "Existing issue workflow change",
            html_url: "https://github.com/DevwareUK/prs/pull/123",
            base: { ref: "main" },
            head: { ref: "feat/existing-issue-workflow-change" },
          },
        ]);
      }

      if (url.endsWith("/pulls/123/files?per_page=100")) {
        return createFetchResponse([{ filename: "packages/cli/src/index.ts" }]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { run } = await loadCli({
        readlineAnswers: [""],
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
            return { status: 1, error: new Error("codex is unavailable") };
          }

          if (command === "git" && args[0] === "rev-parse") {
            gitCommands.push(args);
            return { status: args[2] === "refs/heads/main" ? 0 : 1, stdout: "" };
          }

          if (command === "git" && args[0] === "fetch") {
            gitCommands.push(args);
            return { status: 0 };
          }

          throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
        },
      });

      process.env.GITHUB_TOKEN = "test-token";
      process.env.OPENAI_API_KEY = "test-key";
      process.argv = ["node", "prs", "issue", "prepare", String(issueNumber)];

      await expect(run()).rejects.toThrow(
        "Open pull requests still change planned files: #123 Existing issue workflow change"
      );
      expect(gitCommands).not.toContainEqual([
        "checkout",
        "-b",
        "feat/issue-91236-stop-before-overlapping-pr-branch",
      ]);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("continues interactive issue preparation from the configured base when review-first overlap clears", async () => {
    const issueNumber = 91238;
    const issueTitle = "Continue after overlap clears";
    const branchName = "feat/issue-91238-continue-after-overlap-clears";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "91238-continue-after-overlap-clears"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const gitCommands: string[][] = [];
    let openPullRequestListCalls = 0;
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: issueTitle,
          body: "Re-check overlapping PRs after the review-first prompt returns.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([
          {
            id: 619,
            body: [
              "<!-- prs:issue-plan -->",
              "### Likely files",
              "",
              "- packages/cli/src/index.ts",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-619`,
            updated_at: "2026-04-26T13:15:00Z",
          },
        ]);
      }

      if (url.endsWith("/pulls?state=open&per_page=100")) {
        openPullRequestListCalls += 1;
        return createFetchResponse(
          openPullRequestListCalls === 1
            ? [
                {
                  number: 123,
                  title: "Existing issue workflow change",
                  html_url: "https://github.com/DevwareUK/prs/pull/123",
                  base: { ref: "main" },
                  head: { ref: "feat/existing-issue-workflow-change" },
                },
              ]
            : []
        );
      }

      if (url.endsWith("/pulls/123/files?per_page=100")) {
        return createFetchResponse([{ filename: "packages/cli/src/index.ts" }]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { run } = await loadCli({
        readlineAnswers: [""],
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
            return { status: 1, error: new Error("codex is unavailable") };
          }

          if (command === "git" && args[0] === "rev-parse") {
            gitCommands.push(args);
            if (args[2] === branchName) return { status: 1 };
            if (args[2] === "refs/heads/main") return { status: 0, stdout: "main-tip\n" };
            if (args[2] === "refs/remotes/origin/main") {
              return { status: 0, stdout: "main-remote-tip\n" };
            }
            return { status: 1 };
          }

          if (command === "git" && args[0] === "fetch") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "git" && args[0] === "checkout") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "git" && args[0] === "merge-base") {
            return { status: 0 };
          }

          throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
        },
      });

      process.env.GITHUB_TOKEN = "test-token";
      process.env.OPENAI_API_KEY = "test-key";
      process.argv = ["node", "prs", "issue", "prepare", String(issueNumber)];

      const stdout = captureStdout();
      await run();

      const output = parseJsonPayloadFromOutput(stdout.output()) as {
        issueFile: string;
        runDir: string;
      };
      cleanupTargets.add(dirname(resolve(REPO_ROOT, output.issueFile)));
      cleanupTargets.add(resolve(REPO_ROOT, output.runDir));

      expect(openPullRequestListCalls).toBe(2);
      expect(gitCommands).toContainEqual(["checkout", "main"]);
      expect(gitCommands).toContainEqual(["checkout", "-b", branchName]);
      expect(gitCommands).not.toContainEqual([
        "checkout",
        "-b",
        "feat/existing-issue-workflow-change",
        "origin/feat/existing-issue-workflow-change",
      ]);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("continues interactive issue preparation from the recommended PR head when review-first is declined", async () => {
    const issueNumber = 91239;
    const issueTitle = "Continue from recommended stacked branch";
    const branchName = "feat/issue-91239-continue-from-recommended-stacked-branch";
    const stackedBaseBranch = "feat/existing-issue-workflow-change";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "91239-continue-from-recommended-stacked-branch"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const gitCommands: string[][] = [];
    let openPullRequestListCalls = 0;
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: issueTitle,
          body: "Decline the review-first prompt and continue from the recommended base.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([
          {
            id: 620,
            body: [
              "<!-- prs:issue-plan -->",
              "### Likely files",
              "",
              "- packages/cli/src/index.ts",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-620`,
            updated_at: "2026-04-26T13:20:00Z",
          },
        ]);
      }

      if (url.endsWith("/pulls?state=open&per_page=100")) {
        openPullRequestListCalls += 1;
        return createFetchResponse([
          {
            number: 123,
            title: "Existing issue workflow change",
            html_url: "https://github.com/DevwareUK/prs/pull/123",
            base: { ref: "main" },
            head: { ref: stackedBaseBranch },
          },
        ]);
      }

      if (url.endsWith("/pulls/123/files?per_page=100")) {
        return createFetchResponse([{ filename: "packages/cli/src/index.ts" }]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { run } = await loadCli({
        readlineAnswers: ["n", ""],
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
            return { status: 1, error: new Error("codex is unavailable") };
          }

          if (command === "git" && args[0] === "rev-parse") {
            gitCommands.push(args);
            if (args[2] === branchName || args[2] === stackedBaseBranch) {
              return { status: 1 };
            }
            if (args[2] === "refs/heads/main") return { status: 0, stdout: "main-tip\n" };
            if (args[2] === "refs/remotes/origin/main") {
              return { status: 0, stdout: "main-remote-tip\n" };
            }
            if (args[2] === `refs/remotes/origin/${stackedBaseBranch}`) {
              return { status: 0, stdout: "pr-head-tip\n" };
            }
            return { status: 1 };
          }

          if (command === "git" && args[0] === "fetch") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "git" && args[0] === "checkout") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "git" && args[0] === "merge-base") {
            return { status: 0 };
          }

          throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
        },
      });

      process.env.GITHUB_TOKEN = "test-token";
      process.env.OPENAI_API_KEY = "test-key";
      process.argv = ["node", "prs", "issue", "prepare", String(issueNumber)];

      const stdout = captureStdout();
      await run();

      const output = parseJsonPayloadFromOutput(stdout.output()) as {
        issueFile: string;
        runDir: string;
      };
      cleanupTargets.add(dirname(resolve(REPO_ROOT, output.issueFile)));
      cleanupTargets.add(resolve(REPO_ROOT, output.runDir));

      expect(openPullRequestListCalls).toBe(1);
      expect(gitCommands).toContainEqual([
        "checkout",
        "-b",
        stackedBaseBranch,
        `origin/${stackedBaseBranch}`,
      ]);
      expect(gitCommands).toContainEqual(["checkout", "-b", branchName]);
      expect(gitCommands).not.toContainEqual(["checkout", "main"]);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it(
    "stacks unattended issue runs on the recommended PR head and adds an overlap note",
    async () => {
    const issueNumber = 91237;
    const branchName = "feat/issue-91237-stack-on-overlapping-pr-head";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "91237-stack-on-overlapping-pr-head"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    let gitStatusCallCount = 0;
    const gitCommands: string[][] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Stack on overlapping PR head",
          body: "Continue non-interactively from the safest overlapping PR base.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([
          {
            id: 618,
            body: [
              "<!-- prs:issue-plan -->",
              "### Likely files",
              "",
              "- packages/cli/src/index.ts",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-618`,
            updated_at: "2026-04-26T13:10:00Z",
          },
        ]);
      }

      if (url.endsWith("/pulls?state=open&per_page=100")) {
        return createFetchResponse([
          {
            number: 123,
            title: "Existing issue workflow change",
            html_url: "https://github.com/DevwareUK/prs/pull/123",
            base: { ref: "main" },
            head: { ref: "feat/existing-issue-workflow-change" },
          },
        ]);
      }

      if (url.endsWith("/pulls/123/files?per_page=100")) {
        return createFetchResponse([{ filename: "packages/cli/src/index.ts" }]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

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
        if (command === "git" && args[0] === "rev-parse") {
          gitCommands.push(args);
          if (args[2] === "refs/heads/main") return { status: 0, stdout: "main-tip\n" };
          if (args[2] === "refs/remotes/origin/main") {
            return { status: 0, stdout: "main-remote-tip\n" };
          }
          if (args[2] === "refs/remotes/origin/feat/existing-issue-workflow-change") {
            return { status: 0, stdout: "pr-head-tip\n" };
          }
          return { status: 1 };
        }
        if (command === "git" && args[0] === "fetch") {
          gitCommands.push(args);
          return { status: 0 };
        }
        if (command === "git" && args[0] === "checkout") {
          gitCommands.push(args);
          return { status: 0 };
        }
        if (command === "git" && args[0] === "merge-base") return { status: 0 };
        if (command === "codex" && args[0] === "--version") return { status: 0 };
        if (command === "codex" && args[0] === "exec") return { status: 0 };
        if (command === "pnpm" && args[0] === "--version") return { status: 0 };
        if (command === "pnpm" && args[0] === "build") return { status: 0 };
        if (command === "git" && args[0] === "add") return { status: 0 };
        if (command === "git" && args[0] === "commit") return { status: 0 };
        if (command === "git" && args[0] === "push") return { status: 0 };
        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return { status: 0, stdout: "https://github.com/DevwareUK/prs/pull/91237\n" };
        }
        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber), "--mode", "unattended"];
    await run();

    expect(gitCommands).toContainEqual([
      "checkout",
      "-b",
      "feat/existing-issue-workflow-change",
      "origin/feat/existing-issue-workflow-change",
    ]);
    expect(gitCommands).toContainEqual(["checkout", "-b", branchName]);
    const prCreateCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "gh" &&
        Array.isArray(args) &&
        args[0] === "pr" &&
        args[1] === "create"
    );
    expect(prCreateCall).toBeDefined();
    const prArgs = prCreateCall?.[1] as string[];
    expect(prArgs[prArgs.indexOf("--base") + 1]).toBe(
      "feat/existing-issue-workflow-change"
    );
    const body = readFileSync(prArgs[prArgs.indexOf("--body-file") + 1], "utf8");
    expect(body).toContain("## Open PR File Overlap");
    expect(body).toContain("- #123 Existing issue workflow change");
    },
    180000
  );

  it(
    "keeps ambiguous unattended overlap on the configured base and adds a dependency warning",
    async () => {
    const issueNumber = 91240;
    const branchName = "feat/issue-91240-continue-with-ambiguous-open-pr-overlaps";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".prs",
      "issues",
      "91240-continue-with-ambiguous-open-pr-overlaps"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    let gitStatusCallCount = 0;
    const gitCommands: string[][] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Continue with ambiguous open PR overlaps",
          body: "Fall back to the configured base when no single overlap is safest.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([
          {
            id: 621,
            body: [
              "<!-- prs:issue-plan -->",
              "### Likely files",
              "",
              "- packages/cli/src/index.ts",
              "- README.md",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-621`,
            updated_at: "2026-04-26T13:25:00Z",
          },
        ]);
      }

      if (url.endsWith("/pulls?state=open&per_page=100")) {
        return createFetchResponse([
          {
            number: 123,
            title: "Existing issue workflow change",
            html_url: "https://github.com/DevwareUK/prs/pull/123",
            base: { ref: "main" },
            head: { ref: "feat/existing-issue-workflow-change" },
          },
          {
            number: 124,
            title: "Existing README change",
            html_url: "https://github.com/DevwareUK/prs/pull/124",
            base: { ref: "main" },
            head: { ref: "docs/existing-readme-change" },
          },
        ]);
      }

      if (url.endsWith("/pulls/123/files?per_page=100")) {
        return createFetchResponse([{ filename: "packages/cli/src/index.ts" }]);
      }

      if (url.endsWith("/pulls/124/files?per_page=100")) {
        return createFetchResponse([{ filename: "README.md" }]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

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
        if (command === "git" && args[0] === "rev-parse") {
          gitCommands.push(args);
          if (args[2] === branchName) return { status: 1 };
          if (args[2] === "refs/heads/main") return { status: 0, stdout: "main-tip\n" };
          if (args[2] === "refs/remotes/origin/main") {
            return { status: 0, stdout: "main-remote-tip\n" };
          }
          return { status: 1 };
        }
        if (command === "git" && args[0] === "fetch") {
          gitCommands.push(args);
          return { status: 0 };
        }
        if (command === "git" && args[0] === "checkout") {
          gitCommands.push(args);
          return { status: 0 };
        }
        if (command === "git" && args[0] === "merge-base") return { status: 0 };
        if (command === "codex" && args[0] === "--version") return { status: 0 };
        if (command === "codex" && args[0] === "exec") return { status: 0 };
        if (command === "pnpm" && args[0] === "--version") return { status: 0 };
        if (command === "pnpm" && args[0] === "build") return { status: 0 };
        if (command === "git" && args[0] === "add") return { status: 0 };
        if (command === "git" && args[0] === "commit") return { status: 0 };
        if (command === "git" && args[0] === "push") return { status: 0 };
        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return { status: 0, stdout: "https://github.com/DevwareUK/prs/pull/91240\n" };
        }
        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", String(issueNumber), "--mode", "unattended"];
    await run();

    expect(gitCommands).toContainEqual(["checkout", "main"]);
    expect(gitCommands).toContainEqual(["checkout", "-b", branchName]);
    expect(gitCommands).not.toContainEqual([
      "checkout",
      "-b",
      "feat/existing-issue-workflow-change",
      "origin/feat/existing-issue-workflow-change",
    ]);
    expect(gitCommands).not.toContainEqual([
      "checkout",
      "-b",
      "docs/existing-readme-change",
      "origin/docs/existing-readme-change",
    ]);
    const prCreateCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "gh" &&
        Array.isArray(args) &&
        args[0] === "pr" &&
        args[1] === "create"
    );
    expect(prCreateCall).toBeDefined();
    const prArgs = prCreateCall?.[1] as string[];
    expect(prArgs[prArgs.indexOf("--base") + 1]).toBe("main");
    const body = readFileSync(prArgs[prArgs.indexOf("--body-file") + 1], "utf8");
    expect(body).toContain("## Open PR File Overlap");
    expect(body).toContain(
      "Open PRs change planned files for this issue. Review them before merging if their changes are still open."
    );
    expect(body).toContain("- #123 Existing issue workflow change");
    expect(body).toContain("- #124 Existing README change");
    },
    60000
  );

  it("writes local issue prompts with plain-language next steps", async () => {
    const issueNumber = 91235;
    const issueTitle = "Local issue prompt uses conversational completion guidance";

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: issueTitle,
          body: "Ensure the local issue prompt does not require a separate /exit.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        return createFetchResponse({
          id: 616,
          body: JSON.parse(String(init.body)).body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-616`,
          updated_at: "2026-04-26T10:55:00Z",
        });
      }

      if (url.endsWith("/pulls?state=open&per_page=100")) {
        return createFetchResponse([]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
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

        if (command === "codex" && args[0] === "--version") {
          return { status: 1, error: new Error("codex is unavailable") };
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

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "prepare", String(issueNumber)];
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";

    const stdout = captureStdout();
    await run();

    const output = parseJsonPayloadFromOutput(stdout.output()) as {
      promptFile: string;
      runDir: string;
      mode: string;
    };
    const promptFilePath = resolve(REPO_ROOT, output.promptFile);
    const runDirPath = resolve(REPO_ROOT, output.runDir);

    cleanupTargets.add(dirname(promptFilePath));
    cleanupTargets.add(runDirPath);

    expect(output.mode).toBe("local");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "add a short explanation of how to see the change in action"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "continue by giving further instruction or type `/exit` when they are satisfied and want to hand control back to `prs`"
    );
    expect(readFileSync(promptFilePath, "utf8")).not.toContain("[1] Continue refining");
    expect(readFileSync(promptFilePath, "utf8")).not.toContain("/commit");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

});
