import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parsePrsToolCommandArgs } from "./prs-tool-command";
import {
  createIssuePlanWorkspace,
  createIssueRefineWorkspace,
  formatRunTimestamp,
  getIssuePlanRunDir,
  getIssueRefineRunDir,
  getIssueRefineSessionStateFilePath,
  loadIssueRefineSessionState,
  writeIssueRefineSessionState,
} from "./run-artifacts";
import {
  createFeatureBacklogAnalysis,
  createFetchResponse,
  captureStdout,
  createTempRepoRoot,
  createTempWorktreeRepoRoot,
  withRepositoryConfig,
  loadCli,
} from "./index-test-support";

describe("CLI command surface", () => {
  it("keeps the process entrypoint small and free of embedded workflow runners", () => {
    const entrypoint = readFileSync(
      resolve(process.cwd(), "packages/cli/src/index.ts"),
      "utf8"
    );
    const lines = entrypoint.split(/\r?\n/);

    expect(lines.length).toBeLessThanOrEqual(220);
    expect(entrypoint).not.toContain("async function runIssueCommand");
    expect(entrypoint).not.toContain("async function runPrCommand");
    expect(entrypoint).not.toContain("async function runToolCommand");
    expect(entrypoint).not.toContain("async function runAuditCommand");
    expect(entrypoint).not.toContain("async function runTestBacklogCommand");
    expect(entrypoint).not.toContain("async function runFeatureBacklogCommand");
  });

  it("keeps CLI behavior split across focused domain modules instead of a catch-all runtime", () => {
    const entrypoint = readFileSync(
      resolve(process.cwd(), "packages/cli/src/index.ts"),
      "utf8"
    );

    expect(existsSync(resolve(process.cwd(), "packages/cli/src/cli-runtime.ts"))).toBe(
      false
    );
    expect(entrypoint).not.toContain("./cli-runtime");
    expect(existsSync(resolve(process.cwd(), "packages/cli/src/cli-context.ts"))).toBe(
      true
    );
    expect(existsSync(resolve(process.cwd(), "packages/cli/src/cli-git.ts"))).toBe(
      true
    );
    expect(existsSync(resolve(process.cwd(), "packages/cli/src/cli-notices.ts"))).toBe(
      true
    );
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/workflows/issue/runner.ts"))
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/workflows/issue/drafts.ts"))
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/workflows/issue/publication.ts"))
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/workflows/issue/session.ts"))
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/commands/review-runner.ts"))
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/commands/audit-runner.ts"))
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/commands/backlog-runner.ts"))
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/commands/pr-runner.ts"))
    ).toBe(true);
    expect(
      existsSync(resolve(process.cwd(), "packages/cli/src/commands/tool-runner.ts"))
    ).toBe(true);
  });

  it("documents no-number /prs issue and /prs pr URL display", () => {
    const docs = [
      readFileSync(resolve(process.cwd(), "README.md"), "utf8"),
      readFileSync(resolve(process.cwd(), "docs/cli-reference.md"), "utf8"),
      readFileSync(resolve(process.cwd(), "docs/codex-prs-workflows.md"), "utf8"),
    ].join("\n");

    expect(docs).toContain("prs tool issue list [--actionable] --json");
    expect(docs).toContain("prs tool pr list [--actionable] --json");
    expect(docs).toContain("prs tool worktrees cleanup [--apply] --json");
    expect(docs).toContain("number, title, and GitHub URL");
    expect(docs).toContain("include a `url` field");
  });

  it("parses issue draft caller and runtime modes", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(
      parseIssueCommandArgs([
        "issue",
        "draft",
        "--draft-file",
        "draft.md",
        "--rough-idea",
        "Preserve caller context.",
        "--context-file",
        "context.md",
        "--media-manifest",
        ".prs/runs/create/media.json",
      ])
    ).toEqual({
      action: "draft",
      mode: "caller",
      draftFilePath: "draft.md",
      issueSetFilePath: undefined,
      roughIdea: "Preserve caller context.",
      roughIdeaFilePath: undefined,
      contextValues: [],
      contextFilePaths: ["context.md"],
      superpowersSpecFilePath: undefined,
      superpowersPlanFilePath: undefined,
      mediaManifestFilePath: ".prs/runs/create/media.json",
    });
    expect(parseIssueCommandArgs(["issue", "draft", "--runtime"])).toEqual({
      action: "draft",
      mode: "runtime",
    });
  });

  it("parses issue plan as a dedicated issue subcommand", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(parseIssueCommandArgs(["issue", "plan", "42"])).toEqual({
      action: "plan",
      issueNumber: 42,
      mode: "local",
      refresh: false,
    });
  });

  it("parses issue estimate as a dedicated issue subcommand", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(parseIssueCommandArgs(["issue", "estimate", "42"])).toEqual({
      action: "estimate",
      issueNumber: 42,
      mode: "local",
    });
    expect(() =>
      parseIssueCommandArgs(["issue", "estimate", "42", "--refresh"])
    ).toThrow('Unknown issue option "--refresh"');
  });

  it("parses issue plan refresh aliases", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(parseIssueCommandArgs(["issue", "plan", "42", "--refresh"])).toEqual({
      action: "plan",
      issueNumber: 42,
      mode: "local",
      refresh: true,
    });
    expect(parseIssueCommandArgs(["issue", "plan", "42", "--update"])).toEqual({
      action: "plan",
      issueNumber: 42,
      mode: "local",
      refresh: true,
    });
  });

  it("parses direct issue unattended mode aliases", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    for (const alias of ["--unattended", "--auto", "--jdi"]) {
      expect(parseIssueCommandArgs(["issue", "42", alias])).toEqual({
        action: "run",
        issueNumber: 42,
        mode: "unattended",
      });
    }
    expect(() => parseIssueCommandArgs(["issue", "42", "--all"])).toThrow(
      'Unknown issue option "--all".'
    );
  });

  it("extracts concrete likely files from managed issue plan comments", async () => {
    const { extractIssuePlanLikelyFiles } = await loadCli();

    expect(
      extractIssuePlanLikelyFiles(
        [
          "<!-- prs:issue-plan -->",
          "## Issue Resolution Plan",
          "",
          "### Likely files",
          "",
          "- `packages/cli/src/index.ts`",
          "- ./packages/cli/src/github.ts",
          "- README.md",
          "- Open Questions",
          "- `packages/cli/src/index.ts`",
          "",
          "### Test Plan",
          "",
          "- Run vitest.",
        ].join("\n")
      )
    ).toEqual([
      "packages/cli/src/index.ts",
      "packages/cli/src/github.ts",
      "README.md",
    ]);
  });

  it("matches planned files to open pull requests and recommends a stacked base", async () => {
    const { findOverlappingPullRequests, recommendIssueBranchBase } = await loadCli();
    const overlappingPullRequests = findOverlappingPullRequests(
      ["packages/cli/src/index.ts", "README.md"],
      [
        {
          number: 123,
          title: "Existing issue workflow change",
          url: "https://github.com/DevwareUK/prs/pull/123",
          baseRefName: "main",
          headRefName: "feat/existing-issue-workflow-change",
          files: ["./packages/cli/src/index.ts"],
        },
        {
          number: 124,
          title: "Unrelated docs",
          url: "https://github.com/DevwareUK/prs/pull/124",
          baseRefName: "main",
          headRefName: "docs/unrelated",
          files: ["docs/notes.md"],
        },
      ]
    );

    expect(overlappingPullRequests).toEqual([
      {
        number: 123,
        title: "Existing issue workflow change",
        url: "https://github.com/DevwareUK/prs/pull/123",
        baseRefName: "main",
        headRefName: "feat/existing-issue-workflow-change",
        matchingFiles: ["packages/cli/src/index.ts"],
      },
    ]);
    expect(
      recommendIssueBranchBase({
        configuredBaseBranch: "main",
        overlappingPullRequests,
        plannedFiles: ["packages/cli/src/index.ts", "README.md"],
      })
    ).toMatchObject({
      branchName: "feat/existing-issue-workflow-change",
      pullRequestBaseBranch: "feat/existing-issue-workflow-change",
      source: "pull-request-head",
    });
  });

  it("detects file overlap by normalized repository path and ignores unrelated open PR files", async () => {
    const { findOverlappingPullRequests } = await loadCli();

    expect(
      findOverlappingPullRequests(
        ["./packages/cli/src/index.ts", "README.md"],
        [
          {
            number: 123,
            title: "Existing issue workflow change",
            url: "https://github.com/DevwareUK/prs/pull/123",
            baseRefName: "main",
            headRefName: "feat/existing-issue-workflow-change",
            files: ["packages/cli/src/index.ts", "docs/notes.md"],
          },
          {
            number: 124,
            title: "Unrelated docs",
            url: "https://github.com/DevwareUK/prs/pull/124",
            baseRefName: "main",
            headRefName: "docs/unrelated",
            files: ["docs/notes.md"],
          },
        ]
      )
    ).toEqual([
      {
        number: 123,
        title: "Existing issue workflow change",
        url: "https://github.com/DevwareUK/prs/pull/123",
        baseRefName: "main",
        headRefName: "feat/existing-issue-workflow-change",
        matchingFiles: ["packages/cli/src/index.ts"],
      },
    ]);
  });

  it("falls back to the configured base when open PR overlap is ambiguous", async () => {
    const { findOverlappingPullRequests, recommendIssueBranchBase } = await loadCli();
    const overlappingPullRequests = findOverlappingPullRequests(
      ["packages/cli/src/index.ts", "README.md"],
      [
        {
          number: 123,
          title: "Existing CLI change",
          url: "https://github.com/DevwareUK/prs/pull/123",
          baseRefName: "main",
          headRefName: "feat/existing-cli-change",
          files: ["packages/cli/src/index.ts"],
        },
        {
          number: 124,
          title: "Existing docs change",
          url: "https://github.com/DevwareUK/prs/pull/124",
          baseRefName: "main",
          headRefName: "docs/existing-docs-change",
          files: ["README.md"],
        },
      ]
    );

    expect(
      recommendIssueBranchBase({
        configuredBaseBranch: "main",
        overlappingPullRequests,
        plannedFiles: ["packages/cli/src/index.ts", "README.md"],
      })
    ).toMatchObject({
      branchName: "main",
      pullRequestBaseBranch: "main",
      source: "configured-base",
    });
  });

  it("parses issue refine as a dedicated issue subcommand", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(parseIssueCommandArgs(["issue", "refine", "42"])).toEqual({
      action: "refine",
      issueNumber: 42,
    });
  });

  it("rejects extra issue refine arguments", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(() => parseIssueCommandArgs(["issue", "refine", "42", "extra"])).toThrow(
      'Unknown issue option "extra".'
    );
  });

  it("builds issue refine artifact paths under the issue namespace", () => {
    const repoRoot = createTempRepoRoot();
    const date = new Date("2026-04-24T12:34:56.789Z");

    expect(getIssueRefineSessionStateFilePath(repoRoot, 42)).toBe(
      resolve(repoRoot, ".prs", "issues", "42", "refine-session.json")
    );
    expect(getIssueRefineRunDir(repoRoot, 42, date)).toBe(
      resolve(
        repoRoot,
        ".prs",
        "runs",
        `${formatRunTimestamp(date)}-issue-refine-42`
      )
    );
  });

  it("creates issue refine workspaces with timestamped run artifacts", async () => {
    const repoRoot = createTempRepoRoot();
    const workspace = createIssueRefineWorkspace(repoRoot, 42);

    expect(existsSync(workspace.runDir)).toBe(true);
    expect(workspace).toMatchObject({
      runDir: expect.stringMatching(/\.prs\/runs\/.+-issue-refine-42$/),
      draftFilePath: expect.stringMatching(/issue-refine-42\.md$/),
      issueSetFilePath: expect.stringMatching(/issue-set\.json$/),
      promptFilePath: expect.stringMatching(/prompt\.md$/),
      metadataFilePath: expect.stringMatching(/metadata\.json$/),
      outputLogPath: expect.stringMatching(/output\.log$/),
    });
  });

  it("creates issue plan workspaces with timestamped run artifacts", async () => {
    const repoRoot = createTempRepoRoot();
    const date = new Date("2026-04-26T10:11:12.345Z");

    expect(getIssuePlanRunDir(repoRoot, 42, date)).toBe(
      resolve(repoRoot, ".prs", "runs", `${formatRunTimestamp(date)}-issue-plan-42`)
    );

    const workspace = createIssuePlanWorkspace(repoRoot, 42);

    expect(existsSync(workspace.runDir)).toBe(true);
    expect(workspace).toMatchObject({
      runDir: expect.stringMatching(/\.prs\/runs\/.+-issue-plan-42$/),
      promptFilePath: expect.stringMatching(/prompt\.md$/),
      metadataFilePath: expect.stringMatching(/metadata\.json$/),
      outputLogPath: expect.stringMatching(/output\.log$/),
      superpowersSpecFilePath: expect.stringMatching(/superpowers-spec\.md$/),
      superpowersPlanFilePath: expect.stringMatching(/superpowers-plan\.md$/),
    });
  });

  it("writes and reloads issue refine session state from refine-session.json", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const state = {
      issueNumber: 42,
      runtimeType: "codex" as const,
      runDir,
      promptFile: resolve(runDir, "prompt.md"),
      outputLog: resolve(runDir, "output.log"),
      latestDraftFile: resolve(runDir, "issue-refine-42.md"),
      sessionId: "session-123",
      completionMode: "kept-on-disk" as const,
      createdAt: "2026-04-24T12:34:56.789Z",
      updatedAt: "2026-04-24T12:35:56.789Z",
    };

    writeIssueRefineSessionState(repoRoot, state);

    expect(existsSync(statePath)).toBe(true);
    expect(loadIssueRefineSessionState(repoRoot, 42)).toEqual(state);
  });

  it("normalizes whitespace-padded issue refine path and session values", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const state = {
      issueNumber: 42,
      runtimeType: "codex" as const,
      runDir: `  ${runDir}  `,
      promptFile: `  ${resolve(runDir, "prompt.md")}  `,
      outputLog: `  ${resolve(runDir, "output.log")}  `,
      latestDraftFile: `  ${resolve(runDir, "issue-refine-42.md")}  `,
      sessionId: "  session-123  ",
      createdAt: "2026-04-24T12:34:56.789Z",
      updatedAt: "2026-04-24T12:35:56.789Z",
    };

    writeIssueRefineSessionState(repoRoot, state);

    expect(existsSync(statePath)).toBe(true);
    expect(loadIssueRefineSessionState(repoRoot, 42)).toEqual({
      ...state,
      runDir,
      promptFile: resolve(runDir, "prompt.md"),
      outputLog: resolve(runDir, "output.log"),
      latestDraftFile: resolve(runDir, "issue-refine-42.md"),
      sessionId: "session-123",
    });
  });

  it("accepts completed issue refine session state with a normalized valid completion URL", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const state = {
      issueNumber: 42,
      runtimeType: "codex" as const,
      runDir,
      promptFile: resolve(runDir, "prompt.md"),
      outputLog: resolve(runDir, "output.log"),
      latestDraftFile: resolve(runDir, "issue-refine-42.md"),
      completionMode: "updated-existing" as const,
      completedIssueNumber: 42,
      completedIssueUrl: "  https://github.com/DevwareUK/prs/issues/42  ",
      createdAt: "2026-04-24T12:34:56.789Z",
      updatedAt: "2026-04-24T12:35:56.789Z",
    };

    writeIssueRefineSessionState(repoRoot, state);

    expect(loadIssueRefineSessionState(repoRoot, 42)).toEqual({
      ...state,
      completedIssueUrl: "https://github.com/DevwareUK/prs/issues/42",
    });
  });

  it("rejects inconsistent issue refine completion metadata", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          issueNumber: 42,
          runtimeType: "codex",
          runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
          promptFile: "prompt.md",
          outputLog: "output.log",
          latestDraftFile: "issue-refine-42.md",
          completionMode: "updated-existing",
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
      "is malformed"
    );
  });

  it("rejects invalid JSON in issue refine-session.json with the malformed-state error", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, "{not-json\n", "utf8");

    expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
      "is malformed"
    );
  });

  it("rejects null JSON in issue refine-session.json with the malformed-state error", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, "null\n", "utf8");

    expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
      "is malformed"
    );
  });

  it("rejects malformed issue refine completion URLs", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });

    for (const completedIssueUrl of [
      "",
      "   ",
      "not-a-url",
      "javascript:alert(1)",
      "mailto:test@example.com",
    ]) {
      writeFileSync(
        statePath,
        `${JSON.stringify(
          {
            issueNumber: 42,
            runtimeType: "codex",
            runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
            promptFile: "prompt.md",
            outputLog: "output.log",
            latestDraftFile: "issue-refine-42.md",
            completionMode: "created-linked",
            completedIssueNumber: 77,
            completedIssueUrl,
            createdAt: "2026-04-24T12:34:56.789Z",
            updatedAt: "2026-04-24T12:35:56.789Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
        "is malformed"
      );
    }
  });

  it("rejects non-canonical GitHub issue refine completion URLs", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });

    for (const completedIssueUrl of [
      "http://example.com/issues/42",
      "https://github.com/issues/42",
      "https://github.com/foo/bar/baz/issues/42",
      "https://user:pass@github.com/DevwareUK/prs/issues/42",
      "https://github.com:443/DevwareUK/prs/issues/42",
      "https://github.com/DevwareUK/prs/issues/42/",
      "https://github.com/DevwareUK/prs/issues/42?foo=1",
      "https://github.com/DevwareUK/prs/issues/42#issuecomment-1",
    ]) {
      writeFileSync(
        statePath,
        `${JSON.stringify(
          {
            issueNumber: 42,
            runtimeType: "codex",
            runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
            promptFile: "prompt.md",
            outputLog: "output.log",
            latestDraftFile: "issue-refine-42.md",
            completionMode: "created-linked",
            completedIssueNumber: 77,
            completedIssueUrl,
            createdAt: "2026-04-24T12:34:56.789Z",
            updatedAt: "2026-04-24T12:35:56.789Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
        "is malformed"
      );
    }
  });

  it("rejects issue refine completion URLs from a different GitHub repository", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          issueNumber: 42,
          runtimeType: "codex",
          runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
          promptFile: resolve(
            repoRoot,
            ".prs",
            "runs",
            "20260424T123456789Z-issue-refine-42",
            "prompt.md"
          ),
          outputLog: resolve(
            repoRoot,
            ".prs",
            "runs",
            "20260424T123456789Z-issue-refine-42",
            "output.log"
          ),
          latestDraftFile: resolve(
            repoRoot,
            ".prs",
            "runs",
            "20260424T123456789Z-issue-refine-42",
            "issue-refine-42.md"
          ),
          completionMode: "created-linked",
          completedIssueNumber: 77,
          completedIssueUrl: "https://github.com/other/repo/issues/77",
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
      "is malformed"
    );
  });

  it("rejects issue refine completion URLs from a different GitHub repository in worktree-style repos", () => {
    const repoRoot = createTempWorktreeRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          issueNumber: 42,
          runtimeType: "codex",
          runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
          promptFile: resolve(
            repoRoot,
            ".prs",
            "runs",
            "20260424T123456789Z-issue-refine-42",
            "prompt.md"
          ),
          outputLog: resolve(
            repoRoot,
            ".prs",
            "runs",
            "20260424T123456789Z-issue-refine-42",
            "output.log"
          ),
          latestDraftFile: resolve(
            repoRoot,
            ".prs",
            "runs",
            "20260424T123456789Z-issue-refine-42",
            "issue-refine-42.md"
          ),
          completionMode: "created-linked",
          completedIssueNumber: 77,
          completedIssueUrl: "https://github.com/other/repo/issues/77",
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
      "is malformed"
    );
  });

  it("accepts same-repository issue refine completion URLs in worktree-style repos", () => {
    const repoRoot = createTempWorktreeRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const state = {
      issueNumber: 42,
      runtimeType: "codex" as const,
      runDir,
      promptFile: resolve(runDir, "prompt.md"),
      outputLog: resolve(runDir, "output.log"),
      latestDraftFile: resolve(runDir, "issue-refine-42.md"),
      completionMode: "updated-existing" as const,
      completedIssueNumber: 42,
      completedIssueUrl: "https://github.com/DevwareUK/prs/issues/42",
      createdAt: "2026-04-24T12:34:56.789Z",
      updatedAt: "2026-04-24T12:35:56.789Z",
    };

    writeIssueRefineSessionState(repoRoot, state);

    expect(loadIssueRefineSessionState(repoRoot, 42)).toEqual(state);
  });

  it("rejects issue refine state with blank required paths or session id on load", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });

    for (const override of [
      { runDir: "   " },
      { promptFile: "" },
      { outputLog: " " },
      { latestDraftFile: "\t" },
      { sessionId: "   " },
    ]) {
      writeFileSync(
        statePath,
        `${JSON.stringify(
          {
            issueNumber: 42,
            runtimeType: "codex",
            runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
            promptFile: "prompt.md",
            outputLog: "output.log",
            latestDraftFile: "issue-refine-42.md",
            createdAt: "2026-04-24T12:34:56.789Z",
            updatedAt: "2026-04-24T12:35:56.789Z",
            ...override,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
        "is malformed"
      );
    }
  });

  it("rejects issue refine state with workspace paths outside the refine run directory on load", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    mkdirSync(dirname(statePath), { recursive: true });

    for (const override of [
      { promptFile: resolve(repoRoot, ".prs", "runs", "other", "prompt.md") },
      { outputLog: resolve(repoRoot, ".prs", "runs", "other", "output.log") },
      { latestDraftFile: resolve(repoRoot, ".prs", "issues", "issue-refine-42.md") },
      { runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-99") },
    ]) {
      writeFileSync(
        statePath,
        `${JSON.stringify(
          {
            issueNumber: 42,
            runtimeType: "codex",
            runDir,
            promptFile: resolve(runDir, "prompt.md"),
            outputLog: resolve(runDir, "output.log"),
            latestDraftFile: resolve(runDir, "issue-refine-42.md"),
            createdAt: "2026-04-24T12:34:56.789Z",
            updatedAt: "2026-04-24T12:35:56.789Z",
            ...override,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
        "is malformed"
      );
    }
  });

  it("rejects invalid issue refine timestamps on load", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });

    for (const override of [
      { createdAt: "" },
      { createdAt: "not-a-date" },
      { createdAt: "2026-04-24 12:34:56.789Z" },
      { updatedAt: " " },
      { updatedAt: "2026-04-24T12:35:56Z" },
      { updatedAt: "2026-99-99T00:00:00.000Z" },
    ]) {
      writeFileSync(
        statePath,
        `${JSON.stringify(
          {
            issueNumber: 42,
            runtimeType: "codex",
            runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
            promptFile: "prompt.md",
            outputLog: "output.log",
            latestDraftFile: "issue-refine-42.md",
            createdAt: "2026-04-24T12:34:56.789Z",
            updatedAt: "2026-04-24T12:35:56.789Z",
            ...override,
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
        "is malformed"
      );
    }
  });

  it("rejects issue refine completion URL and issue number mismatches on load", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          issueNumber: 42,
          runtimeType: "codex",
          runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
          promptFile: "prompt.md",
          outputLog: "output.log",
          latestDraftFile: "issue-refine-42.md",
          completionMode: "created-linked",
          completedIssueNumber: 77,
          completedIssueUrl: "https://github.com/DevwareUK/prs/issues/78",
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
      "is malformed"
    );
  });

  it("rejects updated-existing issue refine state pointing at a different issue on load", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          issueNumber: 42,
          runtimeType: "codex",
          runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
          promptFile: "prompt.md",
          outputLog: "output.log",
          latestDraftFile: "issue-refine-42.md",
          completionMode: "updated-existing",
          completedIssueNumber: 77,
          completedIssueUrl: "https://github.com/DevwareUK/prs/issues/77",
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
      "is malformed"
    );
  });

  it("rejects created-linked issue refine state pointing back to the source issue on load", () => {
    const repoRoot = createTempRepoRoot();
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      `${JSON.stringify(
        {
          issueNumber: 42,
          runtimeType: "codex",
          runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42"),
          promptFile: "prompt.md",
          outputLog: "output.log",
          latestDraftFile: "issue-refine-42.md",
          completionMode: "created-linked",
          completedIssueNumber: 42,
          completedIssueUrl: "https://github.com/DevwareUK/prs/issues/42",
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(() => loadIssueRefineSessionState(repoRoot, 42)).toThrow(
      "is malformed"
    );
  });

  it("rejects invalid issue refine session state before writing", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const previousContents = existsSync(statePath)
      ? readFileSync(statePath, "utf8")
      : undefined;

    expect(() =>
      writeIssueRefineSessionState(repoRoot, {
        issueNumber: 42,
        runtimeType: "codex",
        runDir,
        promptFile: resolve(runDir, "prompt.md"),
        outputLog: resolve(runDir, "output.log"),
        latestDraftFile: resolve(runDir, "issue-refine-42.md"),
        completionMode: "created-linked",
        completedIssueNumber: 77,
        completedIssueUrl: "javascript:alert(1)",
        createdAt: "2026-04-24T12:34:56.789Z",
        updatedAt: "2026-04-24T12:35:56.789Z",
      })
    ).toThrow("is malformed");
    expect(existsSync(statePath)).toBe(previousContents !== undefined);
    if (previousContents !== undefined) {
      expect(readFileSync(statePath, "utf8")).toBe(previousContents);
    }
  });

  it("rejects issue refine completion URL and issue number mismatches before writing", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const previousContents = existsSync(statePath)
      ? readFileSync(statePath, "utf8")
      : undefined;

    expect(() =>
      writeIssueRefineSessionState(repoRoot, {
        issueNumber: 42,
        runtimeType: "codex",
        runDir,
        promptFile: resolve(runDir, "prompt.md"),
        outputLog: resolve(runDir, "output.log"),
        latestDraftFile: resolve(runDir, "issue-refine-42.md"),
        completionMode: "updated-existing",
        completedIssueNumber: 77,
        completedIssueUrl: "https://github.com/DevwareUK/prs/issues/78",
        createdAt: "2026-04-24T12:34:56.789Z",
        updatedAt: "2026-04-24T12:35:56.789Z",
      })
    ).toThrow("is malformed");
    expect(existsSync(statePath)).toBe(previousContents !== undefined);
    if (previousContents !== undefined) {
      expect(readFileSync(statePath, "utf8")).toBe(previousContents);
    }
  });

  it("rejects updated-existing issue refine state pointing at a different issue before writing", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const previousContents = existsSync(statePath)
      ? readFileSync(statePath, "utf8")
      : undefined;

    expect(() =>
      writeIssueRefineSessionState(repoRoot, {
        issueNumber: 42,
        runtimeType: "codex",
        runDir,
        promptFile: resolve(runDir, "prompt.md"),
        outputLog: resolve(runDir, "output.log"),
        latestDraftFile: resolve(runDir, "issue-refine-42.md"),
        completionMode: "updated-existing",
        completedIssueNumber: 77,
        completedIssueUrl: "https://github.com/DevwareUK/prs/issues/77",
        createdAt: "2026-04-24T12:34:56.789Z",
        updatedAt: "2026-04-24T12:35:56.789Z",
      })
    ).toThrow("is malformed");
    expect(existsSync(statePath)).toBe(previousContents !== undefined);
    if (previousContents !== undefined) {
      expect(readFileSync(statePath, "utf8")).toBe(previousContents);
    }
  });

  it("rejects created-linked issue refine state pointing back to the source issue before writing", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const previousContents = existsSync(statePath)
      ? readFileSync(statePath, "utf8")
      : undefined;

    expect(() =>
      writeIssueRefineSessionState(repoRoot, {
        issueNumber: 42,
        runtimeType: "codex",
        runDir,
        promptFile: resolve(runDir, "prompt.md"),
        outputLog: resolve(runDir, "output.log"),
        latestDraftFile: resolve(runDir, "issue-refine-42.md"),
        completionMode: "created-linked",
        completedIssueNumber: 42,
        completedIssueUrl: "https://github.com/DevwareUK/prs/issues/42",
        createdAt: "2026-04-24T12:34:56.789Z",
        updatedAt: "2026-04-24T12:35:56.789Z",
      })
    ).toThrow("is malformed");
    expect(existsSync(statePath)).toBe(previousContents !== undefined);
    if (previousContents !== undefined) {
      expect(readFileSync(statePath, "utf8")).toBe(previousContents);
    }
  });

  it("rejects issue refine state with blank required paths or session id before writing", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const previousContents = existsSync(statePath)
      ? readFileSync(statePath, "utf8")
      : undefined;

    for (const override of [
      { runDir: "   " },
      { promptFile: "" },
      { outputLog: " " },
      { latestDraftFile: "\t" },
      { sessionId: "   " },
    ]) {
      expect(() =>
        writeIssueRefineSessionState(repoRoot, {
          issueNumber: 42,
          runtimeType: "codex",
          runDir,
          promptFile: resolve(runDir, "prompt.md"),
          outputLog: resolve(runDir, "output.log"),
          latestDraftFile: resolve(runDir, "issue-refine-42.md"),
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
          ...override,
        })
      ).toThrow("is malformed");
    }
    expect(existsSync(statePath)).toBe(previousContents !== undefined);
    if (previousContents !== undefined) {
      expect(readFileSync(statePath, "utf8")).toBe(previousContents);
    }
  });

  it("rejects invalid issue refine timestamps before writing", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const previousContents = existsSync(statePath)
      ? readFileSync(statePath, "utf8")
      : undefined;

    for (const override of [
      { createdAt: "" },
      { createdAt: "not-a-date" },
      { createdAt: "2026-04-24 12:34:56.789Z" },
      { updatedAt: " " },
      { updatedAt: "2026-04-24T12:35:56Z" },
      { updatedAt: "2026-99-99T00:00:00.000Z" },
    ]) {
      expect(() =>
        writeIssueRefineSessionState(repoRoot, {
          issueNumber: 42,
          runtimeType: "codex",
          runDir,
          promptFile: resolve(runDir, "prompt.md"),
          outputLog: resolve(runDir, "output.log"),
          latestDraftFile: resolve(runDir, "issue-refine-42.md"),
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
          ...override,
        })
      ).toThrow("is malformed");
    }
    expect(existsSync(statePath)).toBe(previousContents !== undefined);
    if (previousContents !== undefined) {
      expect(readFileSync(statePath, "utf8")).toBe(previousContents);
    }
  });

  it("rejects issue refine state with workspace paths outside the refine run directory before writing", () => {
    const repoRoot = createTempRepoRoot();
    const runDir = resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-42");
    const statePath = getIssueRefineSessionStateFilePath(repoRoot, 42);
    const previousContents = existsSync(statePath)
      ? readFileSync(statePath, "utf8")
      : undefined;

    for (const override of [
      { promptFile: resolve(repoRoot, ".prs", "runs", "other", "prompt.md") },
      { outputLog: resolve(repoRoot, ".prs", "runs", "other", "output.log") },
      { latestDraftFile: resolve(repoRoot, ".prs", "issues", "issue-refine-42.md") },
      { runDir: resolve(repoRoot, ".prs", "runs", "20260424T123456789Z-issue-refine-99") },
    ]) {
      expect(() =>
        writeIssueRefineSessionState(repoRoot, {
          issueNumber: 42,
          runtimeType: "codex",
          runDir,
          promptFile: resolve(runDir, "prompt.md"),
          outputLog: resolve(runDir, "output.log"),
          latestDraftFile: resolve(runDir, "issue-refine-42.md"),
          createdAt: "2026-04-24T12:34:56.789Z",
          updatedAt: "2026-04-24T12:35:56.789Z",
          ...override,
        })
      ).toThrow("is malformed");
    }
    expect(existsSync(statePath)).toBe(previousContents !== undefined);
    if (previousContents !== undefined) {
      expect(readFileSync(statePath, "utf8")).toBe(previousContents);
    }
  });

  it("parses issue batch as an unattended issue subcommand", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(
      parseIssueCommandArgs(["issue", "batch", "123", "124", "--unattended"])
    ).toEqual({
      action: "batch",
      issueNumbers: [123, 124],
      mode: "unattended",
    });
  });

  it("parses multiple issue numbers as a parallel unattended issue run", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(parseIssueCommandArgs(["issue", "123", "124", "--jdi"])).toEqual({
      action: "batch",
      issueNumbers: [123, 124],
      mode: "unattended",
    });
  });

  it("parses unattended aliases for single issue runs", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    for (const flag of ["--unattended", "--auto", "--jdi"]) {
      expect(parseIssueCommandArgs(["issue", "123", flag])).toEqual({
        action: "run",
        issueNumber: 123,
        mode: "unattended",
      });
    }
  });

  it("rejects interactive batch issue mode", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(() =>
      parseIssueCommandArgs(["issue", "batch", "123", "124", "--mode", "interactive"])
    ).toThrow(
      "Batch issue runs only support `--mode unattended`. Interactive multi-issue mode is not supported."
    );
  });

  it("parses pr address-comments as the preferred review-comment subcommand", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parsePrCommandArgs } = await loadCli();

    expect(parsePrCommandArgs(["pr", "address-comments", "73"])).toEqual({
      action: "address-comments",
      prNumber: 73,
    });
    expect(parsePrCommandArgs(["pr", "fix-comments", "73"])).toEqual({
      action: "address-comments",
      prNumber: 73,
    });
  });

  it("parses pr fix-tests as the preferred failing-test repair subcommand", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parsePrCommandArgs } = await loadCli();

    expect(parsePrCommandArgs(["pr", "fix-tests", "74"])).toEqual({
      action: "fix-tests",
      prNumber: 74,
    });
    expect(parsePrCommandArgs(["pr", "fix-failing-tests", "91"])).toEqual({
      action: "fix-tests",
      prNumber: 91,
    });
    expect(() =>
      parsePrCommandArgs(["pr", "fix-failing-tests", "91", "--extra"])
    ).toThrow('Unknown pr option "--extra"');
  });

  it("parses pr add-tests as the suggested-test addition subcommand", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parsePrCommandArgs } = await loadCli();

    expect(parsePrCommandArgs(["pr", "add-tests", "92"])).toEqual({
      action: "add-tests",
      prNumber: 92,
    });
  });

  it("rejects retired direct pr prepare-review command", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parsePrCommandArgs } = await loadCli();

    expect(() => parsePrCommandArgs(["pr", "prepare-review", "75"])).toThrow(
      "`prs pr prepare-review <pr-number>` has been retired"
    );
  });

  it("parses pr resolve-conflicts as a dedicated pr subcommand", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parsePrCommandArgs } = await loadCli();

    expect(parsePrCommandArgs(["pr", "resolve-conflicts", "76"])).toEqual({
      action: "resolve-conflicts",
      prNumber: 76,
    });
  });

  it("rejects explicit codex launcher commands with migration guidance", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseCodexCommand } = await loadCli();

    for (const args of [
      ["codex", "issue", "77"],
      ["codex", "issue", "batch", "77", "78"],
      ["codex", "pr", "prepare-review", "79"],
      ["codex", "pr", "resolve-conflicts", "80"],
    ]) {
      expect(() => parseCodexCommand(args)).toThrow(
        "`prs codex ...` has been retired because prs is skill-first."
      );
    }
  });

  it("parses audit publish for issue artifacts", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseAuditCommandArgs } = await loadCli();

    expect(
      parseAuditCommandArgs([
        "audit",
        "publish",
        "--issue",
        "42",
        "--file",
        ".prs/runs/example/design.md",
        "--section",
        "Spec",
        "--media-manifest",
        ".prs/runs/example/media.json",
      ])
    ).toEqual({
      action: "publish",
      target: { type: "issue", number: 42 },
      filePath: ".prs/runs/example/design.md",
      sectionName: "Spec",
      localRun: undefined,
      mediaManifestFilePath: ".prs/runs/example/media.json",
    });
  });

  it("rejects audit publish without a target", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseAuditCommandArgs } = await loadCli();

    expect(() =>
      parseAuditCommandArgs([
        "audit",
        "publish",
        "--file",
        ".prs/runs/example/design.md",
        "--section",
        "Spec",
      ])
    ).toThrow("`prs audit publish` requires exactly one of --issue or --pr.");
  });

  it("parses token usage publish as a dedicated tool command", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";

    expect(
      parsePrsToolCommandArgs([
        "token-usage",
        "publish",
        "--issue",
        "269",
        "--file",
        ".prs/runs/create/codex-token-usage.json",
        "--json",
      ])
    ).toEqual({
      kind: "token-usage-publish",
      target: { type: "issue", number: 269 },
      filePath: ".prs/runs/create/codex-token-usage.json",
      json: true,
    });
    expect(
      parsePrsToolCommandArgs([
        "token-usage",
        "publish",
        "--pr",
        "88",
        "--file",
        ".prs/runs/pr-review/codex-token-usage.json",
        "--json",
      ])
    ).toEqual({
      kind: "token-usage-publish",
      target: { type: "pull-request", number: 88 },
      filePath: ".prs/runs/pr-review/codex-token-usage.json",
      json: true,
    });
  });

  it("publishes token usage artifacts to a dedicated managed comment", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "create",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          workflow: "prs:create",
          phase: "issue-draft",
          role: "planner",
          profile: {
            name: "premium",
            model: "gpt-5.5",
            thinking: "high",
            source: ".prs/config.json fallback provenance",
          },
          usage: {
            status: "unavailable",
          },
          capture: {
            capturedAt: "2026-06-12T20:08:23Z",
            runDir: ".prs/runs/20260612T200823Z-issue-draft-cleanup-local-branches",
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 269 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 5269,
          body: "<!-- prs:token-usage -->\n# Issue #269 token usage\n",
          html_url: "https://github.com/DevwareUK/prs/issues/269#issuecomment-5269",
          created_at: "2026-06-12T20:10:00Z",
          updated_at: "2026-06-12T20:10:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const stdout = captureStdout();
    process.argv = [
      "node",
      "prs",
      "tool",
      "token-usage",
      "publish",
      "--issue",
      "269",
      "--file",
      artifactPath,
      "--json",
    ];

    await run();

    expect(JSON.parse(stdout.output())).toEqual({
      status: "created",
      target: { type: "issue", number: 269 },
      url: "https://github.com/DevwareUK/prs/issues/269#issuecomment-5269",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).body as string;
    expect(body).toContain("<!-- prs:token-usage -->");
    expect(body).toContain("Codex token usage ledger for issue #269.");
    expect(body).toContain("| issue-draft | planner | gpt-5.5 | configured-fallback | unavailable |");
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).not.toContain('"workflow": "prs:create"');
  });

  it("publishes audit publish artifacts to managed GitHub comments", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(repoRoot, ".prs", "runs", "example", "design.md");
    const mediaManifestPath = resolve(repoRoot, ".prs", "runs", "example", "media.json");
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, "# Design\n\nShip the focused audit path.\n", "utf8");
    writeFileSync(
      mediaManifestPath,
      JSON.stringify({
        media: [
          {
            url: "https://example.com/after.png",
            kind: "image",
            caption: "After screenshot",
          },
        ],
      }),
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse({ number: 42 }))
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 42 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 4101,
          body: "<!-- prs:audit -->\n# Issue #42 audit\n",
          html_url: "https://github.com/DevwareUK/prs/issues/42#issuecomment-4101",
          created_at: "2026-05-11T10:00:00Z",
          updated_at: "2026-05-11T10:00:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [
      "node",
      "prs",
      "audit",
      "publish",
      "--issue",
      "42",
      "--file",
      artifactPath,
      "--section",
      "Spec",
      "--local-run",
      ".prs/runs/example",
      "--media-manifest",
      mediaManifestPath,
    ];

    await run();

    expect(consoleLog).toHaveBeenCalledWith(
      "Audit artifact created: https://github.com/DevwareUK/prs/issues/42#issuecomment-4101"
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/DevwareUK/prs/issues/42",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/DevwareUK/prs/issues/42",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining("## Spec"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).body).toContain(
      "## Visual Evidence"
    );
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).body).toContain(
      "![After screenshot](https://example.com/after.png)"
    );
  });

  it("renders token-usage JSON artifacts as the issue ledger table", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "create",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          workflow: "prs:create",
          phase: "issue-draft",
          role: "planner",
          profile: {
            name: "premium",
            model: "gpt-5.5",
            thinking: "high",
            source: ".prs/config.json fallback provenance",
          },
          actualModel: {
            status: "unavailable",
            notes: "The active Codex app session did not expose actual model metadata through get_goal.",
          },
          usage: {
            status: "unavailable",
            notes: "No active Codex goal exists for this create run, so token counts were not available.",
          },
          capture: {
            capturedAt: "2026-06-12T20:08:23Z",
            runDir: ".prs/runs/20260612T200823Z-issue-draft-cleanup-local-branches",
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 269 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 4269,
          body: "<!-- prs:token-usage -->\n# Issue #269 token usage\n",
          html_url: "https://github.com/DevwareUK/prs/issues/269#issuecomment-4269",
          created_at: "2026-06-12T20:10:00Z",
          updated_at: "2026-06-12T20:10:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [
      "node",
      "prs",
      "audit",
      "publish",
      "--issue",
      "269",
      "--file",
      artifactPath,
      "--section",
      "token-usage",
    ];

    await run();

    expect(consoleLog).toHaveBeenCalledWith(
      "Token usage artifact created: https://github.com/DevwareUK/prs/issues/269#issuecomment-4269"
    );
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).body as string;
    expect(body).toContain("<!-- prs:token-usage -->");
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).toContain("Codex token usage ledger for issue #269.");
    expect(body).toContain("| Phase | Role | Model | Model source | Status | Total tokens | Estimated cost | Elapsed | Captured |");
    expect(body).toContain("| issue-draft | planner | gpt-5.5 | configured-fallback | unavailable |");
    expect(body).not.toContain('"workflow": "prs:create"');
  });

  it("renders token-usage JSON artifacts as the PR ledger table", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "pr-review",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          version: 1,
          status: "tracked",
          target: {
            type: "pull-request",
            number: 88,
          },
          capturedAt: "2026-06-14T08:00:00.000Z",
          source: "codex-goal",
          workflow: {
            name: "pr-review",
            role: "reviewer",
            runDir: ".prs/runs/20260614T080000000Z-pr-88-review",
          },
          model: {
            profile: "premium",
            role: "reviewer",
            model: "gpt-5.5",
            thinking: "high",
            source: "codex-session",
          },
          usage: {
            totalTokens: 32100,
            timeUsedSeconds: 255,
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 88 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 4288,
          body: "<!-- prs:token-usage -->\n# Pull request #88 token usage\n",
          html_url: "https://github.com/DevwareUK/prs/issues/88#issuecomment-4288",
          created_at: "2026-06-14T08:01:00Z",
          updated_at: "2026-06-14T08:01:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [
      "node",
      "prs",
      "audit",
      "publish",
      "--pr",
      "88",
      "--file",
      artifactPath,
      "--section",
      "token-usage",
    ];

    await run();

    expect(consoleLog).toHaveBeenCalledWith(
      "Token usage artifact created: https://github.com/DevwareUK/prs/issues/88#issuecomment-4288"
    );
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).body as string;
    expect(body).toContain("<!-- prs:token-usage -->");
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).toContain("Codex token usage ledger for PR #88.");
    expect(body).toContain(
      "| pr-review | reviewer | gpt-5.5 | actual | tracked | 32,100 |"
    );
    expect(body).not.toContain('"target"');
  });

  it("renders legacy planner token-usage artifacts as the issue ledger table", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "create",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          status: "available",
          notes:
            "Token usage captured from the active Codex app goal after formal prs issue draft ingestion and before GitHub issue creation.",
          objective:
            "Draft GitHub Issue: Replace no-recipe rows with next-shop gap banner",
          tokensUsed: 279408,
          timeUsedSeconds: 263,
          configuredPlannerProfile: {
            role: "planner",
            profile: "premium",
            model: "gpt-5.5",
            thinking: "high",
          },
          actualSessionModel: "gpt-5",
          createdAt: "2026-06-13T10:15:42Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 270 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 4270,
          body: "<!-- prs:token-usage -->\n# Issue #270 token usage\n",
          html_url: "https://github.com/DevwareUK/prs/issues/270#issuecomment-4270",
          created_at: "2026-06-13T10:16:00Z",
          updated_at: "2026-06-13T10:16:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [
      "node",
      "prs",
      "audit",
      "publish",
      "--issue",
      "270",
      "--file",
      artifactPath,
      "--section",
      "token-usage",
    ];

    await run();

    expect(consoleLog).toHaveBeenCalledWith(
      "Token usage artifact created: https://github.com/DevwareUK/prs/issues/270#issuecomment-4270"
    );
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).body as string;
    expect(body).toContain("<!-- prs:token-usage -->");
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).toContain("Codex token usage ledger for issue #270.");
    expect(body).toContain(
      "| issue-create | planner | gpt-5 | actual | tracked | 279,408 |"
    );
    expect(body).toContain("4m 23s | 2026-06-13T10:15:42Z |");
    expect(body).not.toContain('"tokensUsed": 279408');
    expect(body).not.toContain("configuredPlannerProfile");
  });

  it("renders completed goal token-usage artifacts as the issue ledger table", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "create",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          status: "complete",
          phase: "issue-draft",
          objective:
            "Draft GitHub Issue: Configure Brevo Transactional Email For Production",
          usage: {
            tokensUsed: 188585,
            timeUsedSeconds: 227,
          },
          issue: {
            number: 139,
            url: "[#139](https://github.com/JamesDevware/dinner-bell/issues/139)",
          },
          notes:
            "Usage recorded from the completed Codex goal tool result for the approved PRS create run.",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 139 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 4139,
          body: "<!-- prs:token-usage -->\n# Issue #139 token usage\n",
          html_url: "https://github.com/JamesDevware/dinner-bell/issues/139#issuecomment-4139",
          created_at: "2026-06-13T11:15:00Z",
          updated_at: "2026-06-13T11:15:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:JamesDevware/dinner-bell.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [
      "node",
      "prs",
      "audit",
      "publish",
      "--issue",
      "139",
      "--file",
      artifactPath,
      "--section",
      "token-usage",
    ];

    await run();

    expect(consoleLog).toHaveBeenCalledWith(
      "Token usage artifact created: https://github.com/JamesDevware/dinner-bell/issues/139#issuecomment-4139"
    );
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).body as string;
    expect(body).toContain("<!-- prs:token-usage -->");
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).toContain("Codex token usage ledger for issue #139.");
    expect(body).toContain(
      "| issue-draft | planner |  | unavailable | tracked | 188,585 |"
    );
    expect(body).toContain("3m 47s | unavailable |");
    expect(body).not.toContain('"status": "complete"');
    expect(body).not.toContain('"tokensUsed": 188585');
  });

  it("renders Codex app goal tracker token-usage artifacts as the issue ledger table", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "create",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          status: "captured",
          source: "Codex app goal tracker",
          capturedAt: "2026-06-15",
          goal:
            "Draft GitHub Issue: Cloudflare DNS integration for server moves and site binding",
          tokensUsed: 136118,
          timeUsedSeconds: 191,
          model: {
            actual: null,
            notes:
              "The active Codex session model identifier was not exposed to this run. Do not treat configured PRS role metadata as the actual model.",
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 66 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 4066,
          body: "<!-- prs:token-usage -->\n# Issue #66 token usage\n",
          html_url: "https://github.com/DevwareUK/dsm/issues/66#issuecomment-4066",
          created_at: "2026-06-15T08:08:00Z",
          updated_at: "2026-06-15T08:08:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:DevwareUK/dsm.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [
      "node",
      "prs",
      "audit",
      "publish",
      "--issue",
      "66",
      "--file",
      artifactPath,
      "--section",
      "token-usage",
    ];

    await run();

    expect(consoleLog).toHaveBeenCalledWith(
      "Token usage artifact created: https://github.com/DevwareUK/dsm/issues/66#issuecomment-4066"
    );
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).body as string;
    expect(body).toContain("<!-- prs:token-usage -->");
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).toContain("Codex token usage ledger for issue #66.");
    expect(body).toContain(
      "| issue-create | planner |  | unavailable | tracked | 136,118 |"
    );
    expect(body).toContain("3m 11s | 2026-06-15 |");
    expect(body).not.toContain('"status": "captured"');
    expect(body).not.toContain('"tokensUsed": 136118');
    expect(body).not.toContain("Codex app goal tracker");
  });

  it("renders partial planner continuation token-usage artifacts as the issue ledger table", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "create",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          status: "partial",
          note:
            "Planner token usage is unavailable from the active Codex app session. Goal tool reported 97100 tokens used at continuation; exact run-scoped usage is not available.",
          capturedAt: "2026-06-15T12:24:57+01:00",
          objective:
            "Draft GitHub Issue: restore relevant backups after site assignment/deploy",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 68 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 4068,
          body: "<!-- prs:token-usage -->\n# Issue #68 token usage\n",
          html_url: "https://github.com/DevwareUK/dsm/issues/68#issuecomment-4068",
          created_at: "2026-06-15T11:29:36Z",
          updated_at: "2026-06-15T11:29:36Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:DevwareUK/dsm.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [
      "node",
      "prs",
      "audit",
      "publish",
      "--issue",
      "68",
      "--file",
      artifactPath,
      "--section",
      "token-usage",
    ];

    await run();

    expect(consoleLog).toHaveBeenCalledWith(
      "Token usage artifact created: https://github.com/DevwareUK/dsm/issues/68#issuecomment-4068"
    );
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).body as string;
    expect(body).toContain("<!-- prs:token-usage -->");
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).toContain("Codex token usage ledger for issue #68.");
    expect(body).toContain(
      "| issue-create | planner |  | unavailable | partial | 97,100 |"
    );
    expect(body).toContain("2026-06-15T12:24:57+01:00 |");
    expect(body).toContain("<!-- prs:token-usage-data");
    expect(body).toContain('"status": "partial"');
    expect(body).toContain('"totalTokens": 97100');
  });

  it("renders issue completion token-usage artifacts as the issue ledger table", async () => {
    const repoRoot = createTempRepoRoot();
    const artifactPath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "issue-133",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        {
          status: "tracked",
          objective:
            "Complete PRS issue #133: Replace pre-shop empty planner rows with a next-shop gap banner",
          tokensUsed: 172632,
          timeUsedSeconds: 646,
          workflowRole: "implementer",
          configuredProfile: "standard (gpt-5.4-mini, medium thinking)",
          configuredProfileSource:
            ".prs/config.json ai.roles.implementer -> ai.profiles.standard",
          actualSessionModel: "gpt-5",
          notes:
            "Usage captured from the active Codex app goal after implementation, verification, push, and PR creation.",
          createdAt: "2026-06-13T10:21:19Z",
          updatedAt: "2026-06-13T10:32:03Z",
          pullRequest: "https://github.com/JamesDevware/dinner-bell/pull/135",
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(createFetchResponse({ number: 133 }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 4133,
          body: "<!-- prs:token-usage -->\n# Issue #133 token usage\n",
          html_url: "https://github.com/JamesDevware/dinner-bell/issues/133#issuecomment-4133",
          created_at: "2026-06-13T10:33:00Z",
          updated_at: "2026-06-13T10:33:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:JamesDevware/dinner-bell.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [
      "node",
      "prs",
      "audit",
      "publish",
      "--issue",
      "133",
      "--file",
      artifactPath,
      "--section",
      "token-usage",
    ];

    await run();

    expect(consoleLog).toHaveBeenCalledWith(
      "Token usage artifact created: https://github.com/JamesDevware/dinner-bell/issues/133#issuecomment-4133"
    );
    const body = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).body as string;
    expect(body).toContain("<!-- prs:token-usage -->");
    expect(body).not.toContain("<!-- prs:audit -->");
    expect(body).toContain("Codex token usage ledger for issue #133.");
    expect(body).toContain(
      "| issue-implementation | implementer | gpt-5 | actual | tracked | 172,632 |"
    );
    expect(body).toContain("10m 46s | 2026-06-13T10:32:03Z |");
    expect(body).not.toContain('"workflowRole": "implementer"');
    expect(body).not.toContain('"tokensUsed": 172632');
  });

  it("publishes supplied managed spec and plan artifacts for tool-created issues", async () => {
    const repoRoot = createTempRepoRoot();
    const draftPath = resolve(repoRoot, ".prs", "issues", "draft.md");
    const specPath = resolve(repoRoot, ".prs", "runs", "create", "spec.md");
    const planPath = resolve(repoRoot, ".prs", "runs", "create", "plan.md");
    const tokenUsagePath = resolve(
      repoRoot,
      ".prs",
      "runs",
      "create",
      "codex-token-usage.json"
    );
    mkdirSync(dirname(draftPath), { recursive: true });
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(
      draftPath,
      "# Clarify create output\n\n## Summary\n\nMake hints explicit.\n",
      "utf8"
    );
    writeFileSync(specPath, "# Spec\n\nUse managed spec comments.\n", "utf8");
    writeFileSync(planPath, "# Plan\n\nUse managed plan comments.\n", "utf8");
    writeFileSync(
      tokenUsagePath,
      `${JSON.stringify(
        {
          version: 1,
          status: "partial",
          issueNumber: 269,
          capturedAt: "2026-06-12T18:00:00.000Z",
          source: "codex-goal",
          workflow: {
            name: "issue-create",
            role: "planner",
            runDir: ".prs/runs/create",
          },
          auditPublication: {
            status: "not-published",
            target: "issue",
            section: "token-usage",
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const postedComments: Array<{
      id: number;
      body: string;
      html_url: string;
      created_at: string;
      updated_at: string;
      user: { login: string; type: string };
    }> = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/issues?state=open&per_page=100")) {
        return createFetchResponse([]);
      }

      if (url.endsWith("/issues") && init?.method === "POST") {
        return createFetchResponse({
          number: 269,
          title: "Clarify create output",
          html_url: "https://github.com/DevwareUK/prs/issues/269",
        });
      }

      if (url.endsWith("/issues/269")) {
        return createFetchResponse({
          number: 269,
          title: "Clarify create output",
          html_url: "https://github.com/DevwareUK/prs/issues/269",
        });
      }

      if (url.endsWith("/issues/269/comments?per_page=100")) {
        return createFetchResponse(postedComments);
      }

      if (url.endsWith("/issues/269/comments") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        const id = 9269 + postedComments.length;
        const comment = {
          id,
          body: body.body,
          html_url: `https://github.com/DevwareUK/prs/issues/269#issuecomment-${id}`,
          created_at: "2026-06-12T15:00:00Z",
          updated_at: "2026-06-12T15:00:00Z",
          user: { login: "prs-bot", type: "Bot" },
        };
        postedComments.push(comment);
        return createFetchResponse(comment);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote" && args[1] === "get-url") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });
    const stdout = captureStdout();
    process.argv = [
      "node",
      "prs",
      "tool",
      "issue",
      "create",
      "--draft-file",
      draftPath,
      "--run-dir",
      resolve(repoRoot, ".prs", "runs", "create"),
      "--spec-file",
      specPath,
      "--plan-file",
      planPath,
      "--json",
    ];

    await run();

    const output = JSON.parse(stdout.output()) as {
      auditPublicationHints: Array<{
        issueNumber: number;
        file: string;
        section: string;
        mode: string;
      }>;
      tokenUsageComments: Array<{
        issueNumber: number;
        marker: string;
        status: string;
        file: string;
        id: number;
        url: string;
      }>;
      managedComments: Array<{
        issueNumber: number;
        marker: string;
        status: string;
        file: string;
        id: number;
        url: string;
      }>;
      managedCommentHints: Array<{
        issueNumber: number;
        marker: string;
        requiredFor: string;
        status: string;
        file?: string;
        nextAction: string;
      }>;
      estimatePublicationHints: Array<{
        issueNumber: number;
        status: string;
        url?: string;
        reason?: string;
      }>;
    };
    expect(output.auditPublicationHints).toEqual([]);
    expect(output.tokenUsageComments).toEqual([
      {
        issueNumber: 269,
        marker: "<!-- prs:token-usage -->",
        status: "published",
        file: tokenUsagePath,
        id: 9269,
        url: "https://github.com/DevwareUK/prs/issues/269#issuecomment-9269",
      },
    ]);
    expect(output.managedComments).toEqual([
      {
        issueNumber: 269,
        marker: "<!-- prs:issue-spec -->",
        status: "published",
        file: specPath,
        id: 9270,
        url: "https://github.com/DevwareUK/prs/issues/269#issuecomment-9270",
      },
      {
        issueNumber: 269,
        marker: "<!-- prs:issue-plan -->",
        status: "published",
        file: planPath,
        id: 9271,
        url: "https://github.com/DevwareUK/prs/issues/269#issuecomment-9271",
      },
    ]);
    expect(postedComments.map((comment) => comment.body.split("\n")[0])).toEqual([
      "<!-- prs:token-usage -->",
      "<!-- prs:issue-spec -->",
      "<!-- prs:issue-plan -->",
      "<!-- prs:audit -->",
    ]);
    expect(output.managedCommentHints).toEqual([]);
    expect(output.estimatePublicationHints).toEqual([
      {
        issueNumber: 269,
        status: "created",
        url: "https://github.com/DevwareUK/prs/issues/269#issuecomment-9272",
      },
    ]);
  });

  it("parses repo-level test-backlog flags for the CLI", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseTestBacklogCommandArgs } = await import("./index");

    const options = parseTestBacklogCommandArgs([
      "test-backlog",
      "--format",
      "json",
      "--top",
      "4",
      "--create-issues",
      "--max-issues",
      "8",
      "--label",
      "tests",
      "--labels",
      "cli, smoke",
      "--repo-root",
      "packages/core",
    ]);

    expect(options.format).toBe("json");
    expect(options.top).toBe(4);
    expect(options.createIssues).toBe(true);
    expect(options.maxIssues).toBe(4);
    expect(options.labels).toEqual(["tests", "cli", "smoke"]);
    expect(options.repoRoot).toMatch(/packages\/core$/);

    const aliasOptions = parseTestBacklogCommandArgs([
      "review",
      "tests",
      "--format=json",
      "--top=2",
    ]);

    expect(aliasOptions.format).toBe("json");
    expect(aliasOptions.top).toBe(2);
  });

  it("parses feature-backlog flags with an explicit repository path", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseFeatureBacklogCommandArgs } = await loadCli();

    const options = parseFeatureBacklogCommandArgs([
      "feature-backlog",
      "packages/cli",
      "--format=json",
      "--top=4",
      "--create-issues",
      "--max-issues=9",
      "--label",
      "product",
      "--labels",
      "backlog, discovery",
    ]);

    expect(options.format).toBe("json");
    expect(options.top).toBe(4);
    expect(options.createIssues).toBe(true);
    expect(options.maxIssues).toBe(4);
    expect(options.labels).toEqual(["product", "backlog", "discovery"]);
    expect(options.repoRoot).toMatch(/packages\/cli$/);

    const aliasOptions = parseFeatureBacklogCommandArgs([
      "review",
      "features",
      "packages/core",
      "--top=2",
    ]);

    expect(aliasOptions.top).toBe(2);
    expect(aliasOptions.repoRoot).toMatch(/packages\/core$/);
  });

  it("parses review flags for local PR review", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseReviewCommandArgs } = await import("./index");

    const options = parseReviewCommandArgs([
      "review",
      "--base",
      "origin/main",
      "--head",
      "HEAD",
      "--format=json",
      "--issue-number",
      "50",
    ]);

    expect(options).toEqual({
      base: "origin/main",
      head: "HEAD",
      format: "json",
      issueNumber: 50,
    });

    expect(
      parseReviewCommandArgs(["review", "diff", "--base", "origin/main"])
    ).toEqual({
      base: "origin/main",
      head: undefined,
      format: "markdown",
      issueNumber: undefined,
    });
  });

  it("prints launch-stage command tiers for top-level help", async () => {
    const { run } = await loadCli();

    process.argv = ["node", "prs", "--help"];

    const stdout = captureStdout();
    await run();

    expect(stdout.output()).toContain("GitHub-first AI workflows");
    expect(stdout.output()).toContain("Start here:");
    expect(stdout.output()).toContain("prs review tests [--top <count>]");
    expect(stdout.output()).toContain("prs tool pr review <pr-number> --json");
    expect(stdout.output()).toContain("prs tool pr publish-review <pr-number>");
    expect(stdout.output()).toContain("prs tool pr address-comments <pr-number> --json");
    expect(stdout.output()).toContain("prs tool pr fix-tests <pr-number> --json");
    expect(stdout.output()).toContain("prs tool pr add-tests <pr-number> --json");
    expect(stdout.output()).toContain("Advanced:");
    expect(stdout.output()).toContain("Beta:");
    expect(stdout.output()).toContain("prs issue draft");
    expect(stdout.output()).toContain("prs issue refine <number>");
    expect(stdout.output()).not.toContain("  prs pr prepare-review <pr-number>");
    expect(stdout.output()).toContain("prs review features [repo-path]");
    expect(stdout.output()).toContain("prs pr resolve-conflicts <pr-number>");
    expect(stdout.output()).not.toContain("Legacy interactive launchers:");
    expect(stdout.output()).not.toContain("prs codex");
    expect(stdout.output()).toContain("prs pr address-comments <pr-number>");
    expect(stdout.output()).toContain("prs pr add-tests <pr-number>");
  });

  it("prints a beta workflow notice before feature-backlog output", async () => {
    const { run } = await loadCli({
      featureAnalysisResult: createFeatureBacklogAnalysis(),
    });

    process.argv = ["node", "prs", "feature-backlog", ".", "--format", "json"];

    const stdout = captureStdout();
    await run();

    const output = stdout.output();
    expect(output).toContain("BETA WORKFLOW NOTICE");
    expect(output).toContain("`prs review features`");
    expect(output).toContain('"summary"');
    expect(output.indexOf("BETA WORKFLOW NOTICE")).toBeLessThan(
      output.indexOf('"summary"')
    );
  });

  it("prints an advanced workflow notice before issue-plan execution starts", async () => {
    const { run } = await loadCli();

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
        process.argv = ["node", "prs", "issue", "plan", "42"];

        const stdout = captureStdout();
        await expect(run()).rejects.toThrow(
          "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
        );

        const output = stdout.output();
        expect(output).toContain("ADVANCED WORKFLOW NOTICE");
        expect(output).toContain("`prs issue plan <number> [--refresh]`");
      }
    );
  });

  it("prints a beta workflow notice before pr resolve-conflicts execution starts", async () => {
    const { run } = await loadCli();

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
        process.argv = ["node", "prs", "pr", "resolve-conflicts", "76"];

        const stdout = captureStdout();
        await expect(run()).rejects.toThrow(
          "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
        );

        const output = stdout.output();
        expect(output).toContain("BETA WORKFLOW NOTICE");
        expect(output).toContain("`prs pr resolve-conflicts <pr-number>`");
      }
    );
  });

  it("includes the same help overview in unknown-command errors", async () => {
    const { run } = await loadCli();

    process.argv = ["node", "prs", "unknown-command"];

    await expect(run()).rejects.toThrow(
      "Unknown command: unknown-command.\n\nprs"
    );
  });

  it("rejects unexpected setup arguments", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseSetupCommandArgs } = await loadCli();

    expect(() => parseSetupCommandArgs(["setup", "--force"])).toThrow(
      'Unknown setup option "--force". Usage:\n  prs setup\n  prs setup --update-skills'
    );
  });

  it("parses update skills command", async () => {
    process.env.PRS_DISABLE_AUTO_RUN = "1";
    const { parseUpdateCommandArgs } = await loadCli();

    expect(parseUpdateCommandArgs(["update", "skills"])).toEqual({ action: "skills" });
    expect(() => parseUpdateCommandArgs(["update"])).toThrow("Usage:\n  prs update skills");
  });

});
