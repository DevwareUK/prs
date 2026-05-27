import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

import { execFileSync, spawnSync } from "node:child_process";
import { parseSetupCommandArgs, runSetupCommand } from "./setup";

const cleanupTargets = new Set<string>();
const execFileSyncMock = vi.mocked(execFileSync);
const spawnSyncMock = vi.mocked(spawnSync);

function createRepo(prefix: string): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), prefix));
  cleanupTargets.add(repoRoot);
  return repoRoot;
}

function createCodexHome(prefix: string): string {
  const codexHome = mkdtempSync(resolve(tmpdir(), prefix));
  cleanupTargets.add(codexHome);
  process.env.CODEX_HOME = codexHome;
  return codexHome;
}

function writeSuperpowersPlugin(codexHome: string): void {
  const pluginRoot = resolve(
    codexHome,
    "plugins",
    "cache",
    "openai-curated",
    "superpowers",
    "test-version"
  );
  mkdirSync(resolve(pluginRoot, "skills", "brainstorming"), { recursive: true });
  mkdirSync(resolve(pluginRoot, "skills", "writing-plans"), { recursive: true });
  writeFileSync(resolve(pluginRoot, "skills", "brainstorming", "SKILL.md"), "# test\n");
  writeFileSync(resolve(pluginRoot, "skills", "writing-plans", "SKILL.md"), "# test\n");
}

function createPrompt(answers: string[], prompts: string[] = []) {
  return async (prompt: string): Promise<string> => {
    prompts.push(prompt);
    return answers.shift() ?? "";
  };
}

function mockChildProcess(
  repoRoot: string,
  responses: Record<string, string | Error>,
  options: {
    codexAvailable?: boolean;
    ghAuthStatus?: string | Error;
  } = {}
): void {
  execFileSyncMock.mockImplementation((command, args) => {
    if (command === "gh") {
      const ghArgs = Array.isArray(args) ? args.map((value) => String(value)) : [];
      if (ghArgs.join(" ") !== "auth status") {
        throw new Error(`Unexpected gh arguments: ${ghArgs.join(" ")}`);
      }

      if (options.ghAuthStatus instanceof Error) {
        throw options.ghAuthStatus;
      }

      return options.ghAuthStatus ?? "";
    }

    if (command !== "git") {
      throw new Error(`Unexpected command: ${String(command)}`);
    }

    const gitArgs = Array.isArray(args) ? args.map((value) => String(value)) : [];
    const key = gitArgs.slice(2).join(" ");
    const response = responses[key];

    if (gitArgs[0] !== "-C" || gitArgs[1] !== repoRoot) {
      throw new Error(`Unexpected git arguments: ${gitArgs.join(" ")}`);
    }

    if (response instanceof Error) {
      throw response;
    }

    if (typeof response === "string") {
      return response;
    }

    throw new Error(`Unexpected execFileSync call: ${command} ${gitArgs.join(" ")}`);
  });

  spawnSyncMock.mockImplementation((command, args) => {
    const runtimeArgs = Array.isArray(args) ? args.map((value) => String(value)) : [];
    if (command === "codex" && runtimeArgs[0] === "--version") {
      return options.codexAvailable === false
        ? { status: 1, error: new Error("codex unavailable") }
        : { status: 0 };
    }

    if (command === "claude" && runtimeArgs[0] === "--version") {
      return { status: 1, error: new Error("claude unavailable") };
    }

    throw new Error(`Unexpected spawnSync call: ${String(command)} ${runtimeArgs.join(" ")}`);
  });
}

afterEach(() => {
  delete process.env.CODEX_HOME;

  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("setup command", () => {
  it("runs setup with repo-aware defaults without creating AGENTS guidance by default", async () => {
    const repoRoot = createRepo("prs-setup-node-");
    const codexHome = createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, ".github", "workflows"), { recursive: true });
    mkdirSync(resolve(repoRoot, "coverage"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
            test: "vitest",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");
    writeFileSync(resolve(repoRoot, "tsconfig.json"), "{}\n");
    writeFileSync(resolve(repoRoot, ".gitignore"), "node_modules/\n");

    mockChildProcess(
      repoRoot,
      {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
      },
      { ghAuthStatus: new Error("not logged in") }
    );

    const prompts: string[] = [];
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await runSetupCommand({
      cliFallbackCommand: [
        "/usr/local/bin/node",
        "/Users/tester/Projects/prs/packages/cli/dist/index.js",
      ],
      promptForLine: createPrompt(["", "", "", "", ""], prompts),
      repoRoot,
    });

    expect(prompts).toEqual([
      "Use the recommended setup values shown above [Y/n]: ",
      "Enable PR review GitHub Action workflow [Y/n]: ",
      "Enable PR assistant GitHub Action workflow [Y/n]: ",
      "Enable test suggestions GitHub Action workflow [Y/n]: ",
      "Create an optional AGENTS.md scaffold for repo-specific agent guidance [y/N]: ",
    ]);
    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toEqual({
      ai: {
        issue: {
          useCodexSuperpowers: false,
        },
        runtime: {
          type: "codex",
        },
      },
      aiContext: {
        excludePaths: ["**/coverage/**"],
      },
      baseBranch: "main",
      buildCommand: ["pnpm", "build"],
      forge: {
        type: "github",
      },
      githubActions: {
        workflows: {
          "pr-assistant": {
            enabled: true,
          },
          "pr-review": {
            enabled: true,
          },
          "test-suggestions": {
            enabled: true,
          },
        },
      },
    });
    expect(readFileSync(resolve(repoRoot, ".gitignore"), "utf8")).toBe("node_modules/\n");
    expect(readFileSync(resolve(repoRoot, ".prs", ".gitignore"), "utf8")).toBe(
      ["runs/", "issues/", "worktrees/", "batches/", ""].join("\n")
    );
    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"), "utf8")
    ).toContain("DevwareUK/prs/actions/pr-review@main");
    const prReviewWorkflow = readFileSync(
      resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"),
      "utf8"
    );
    expect(prReviewWorkflow).toContain("prs:pr-review-inline");
    expect(prReviewWorkflow).toContain("findingKey");
    expect(prReviewWorkflow).toContain("buildFindingKey(rawComment)");
    expect(prReviewWorkflow).toContain("Fetch existing PRS inline review threads");
    expect(prReviewWorkflow).toContain("resolveReviewThread");
    expect(prReviewWorkflow).toContain("existingFindingKeys");
    expect(prReviewWorkflow).toContain("hasLaterHumanReply");
    expect(prReviewWorkflow).toContain("prs automation note:");
    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-assistant.yml"), "utf8")
    ).toContain("DevwareUK/prs/actions/pr-assistant@main");
    const testSuggestionsWorkflow = readFileSync(
      resolve(repoRoot, ".github", "workflows", "prs-test-suggestions.yml"),
      "utf8"
    );
    expect(testSuggestionsWorkflow).toContain(
      "DevwareUK/prs/actions/test-suggestions@main"
    );
    expect(testSuggestionsWorkflow).toContain("Find existing managed comment");
    expect(testSuggestionsWorkflow).toContain(
      "existing_comment_file: ${{ steps.existing_comment.outputs.existing_comment_file }}"
    );
    expect(testSuggestionsWorkflow).toContain("comment_id:");
    expect(testSuggestionsWorkflow).toContain("github-script");
    expect(testSuggestionsWorkflow).toContain("updateComment");
    expect(testSuggestionsWorkflow).toContain("createComment");
    expect(messages.join("\n")).toContain(
      "Unified Codex entrypoint after skills are installed: /prs"
    );
    expect(messages.join("\n")).toContain(
      "Use the managed `prs` Codex skill as the /prs router once global skills are current."
    );
    expect(messages.join("\n")).toContain(
      "Workflow audit artifacts publish to GitHub; generated Superpowers docs are not committed."
    );
    expect(messages.join("\n")).not.toContain("Installed prs Codex skills:");
    expect(messages.join("\n")).not.toContain("Codex fallback CLI:");
    expect(messages.join("\n")).toContain(
      "Run `prs update skills` after installing or upgrading the CLI to refresh the global Codex /prs skills."
    );
    expect(existsSync(resolve(codexHome, "skills", "prs-start-issue-work", "SKILL.md"))).toBe(
      false
    );
    expect(existsSync(resolve(codexHome, "skills", "prs", "SKILL.md"))).toBe(false);
    expect(messages.join("\n")).toContain(
      "Recommended launch path: GitHub forge, OpenAI provider, and Codex runtime."
    );
    expect(messages.join("\n")).toContain(
      "Default workflow: Codex + Superpowers + GitHub audit"
    );
    expect(messages.join("\n")).toContain(
      "Superpowers worktrees and agents handle execution isolation."
    );
    expect(messages.join("\n")).toContain(
      "prs GitHub Actions are OpenAI-only today, and unattended issue runs remain Codex-specific."
    );
    expect(existsSync(resolve(repoRoot, "AGENTS.md"))).toBe(false);
    expect(messages.join("\n")).toContain("Next step: create `.env`");
    expect(messages.join("\n")).toContain("OPENAI_API_KEY` repository secret");
  });

  it("installs only enabled managed GitHub Actions during setup", async () => {
    const repoRoot = createRepo("prs-setup-action-toggles-");
    createCodexHome("prs-setup-codex-home-");
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");

    mockChildProcess(
      repoRoot,
      {
        "rev-parse --show-toplevel": `${repoRoot}\n`,
        "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
      },
      { ghAuthStatus: new Error("not logged in") }
    );

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", "", "n", "", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toMatchObject({
      githubActions: {
        workflows: {
          "pr-assistant": {
            enabled: false,
          },
          "pr-review": {
            enabled: true,
          },
          "test-suggestions": {
            enabled: true,
          },
        },
      },
    });
    expect(existsSync(resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"))).toBe(
      true
    );
    expect(
      existsSync(resolve(repoRoot, ".github", "workflows", "prs-pr-assistant.yml"))
    ).toBe(false);
    expect(
      existsSync(resolve(repoRoot, ".github", "workflows", "prs-test-suggestions.yml"))
    ).toBe(true);
    expect(messages.join("\n")).toContain(
      "Configured GitHub Actions: enabled PR review, test suggestions; disabled PR assistant"
    );
  });

  it("does not install managed GitHub Actions when all workflows are disabled during setup", async () => {
    const repoRoot = createRepo("prs-setup-action-toggles-all-disabled-");
    createCodexHome("prs-setup-codex-home-");
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");

    mockChildProcess(
      repoRoot,
      {
        "rev-parse --show-toplevel": `${repoRoot}\n`,
        "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
      },
      { ghAuthStatus: new Error("not logged in") }
    );

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", "n", "n", "n", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toMatchObject({
      githubActions: {
        workflows: {
          "pr-assistant": {
            enabled: false,
          },
          "pr-review": {
            enabled: false,
          },
          "test-suggestions": {
            enabled: false,
          },
        },
      },
    });
    expect(readdirSync(resolve(repoRoot, ".github", "workflows"))).toEqual([]);
    expect(messages.join("\n")).toContain(
      "Configured GitHub Actions: enabled none; disabled PR review, PR assistant, test suggestions"
    );
  });

  it("updates enabled managed GitHub Action workflows, removes disabled managed workflows, and leaves unmanaged files untouched", async () => {
    const repoRoot = createRepo("prs-setup-disable-managed-action-");
    createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, ".github", "workflows"), { recursive: true });
    mkdirSync(resolve(repoRoot, ".prs"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");
    writeFileSync(
      resolve(repoRoot, ".prs", "config.json"),
      JSON.stringify(
        {
          forge: {
            type: "github",
          },
          githubActions: {
            workflows: {
              "pr-review": {
                enabled: false,
              },
              "pr-assistant": {
                enabled: false,
              },
              "test-suggestions": {
                enabled: true,
              },
            },
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"),
      ["# Generated by prs setup", "name: Pull Request Smith PR Review", ""].join("\n")
    );
    writeFileSync(
      resolve(repoRoot, ".github", "workflows", "prs-test-suggestions.yml"),
      ["# Generated by prs setup", "name: Stale test suggestions workflow", ""].join("\n")
    );
    writeFileSync(
      resolve(repoRoot, ".github", "workflows", "prs-pr-assistant.yml"),
      ["name: Custom assistant workflow", "jobs: {}", ""].join("\n")
    );

    mockChildProcess(
      repoRoot,
      {
        "rev-parse --show-toplevel": `${repoRoot}\n`,
        "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
      },
      { ghAuthStatus: new Error("not logged in") }
    );

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", "", "", "", ""]),
      repoRoot,
    });

    expect(existsSync(resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"))).toBe(
      false
    );
    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-assistant.yml"), "utf8")
    ).toContain("Custom assistant workflow");
    expect(
      readFileSync(
        resolve(repoRoot, ".github", "workflows", "prs-test-suggestions.yml"),
        "utf8"
      )
    ).toContain("DevwareUK/prs/actions/test-suggestions@main");
    expect(
      readFileSync(
        resolve(repoRoot, ".github", "workflows", "prs-test-suggestions.yml"),
        "utf8"
      )
    ).not.toContain("Stale test suggestions workflow");
    expect(messages.join("\n")).toContain("Removed disabled managed workflow");
    expect(messages.join("\n")).toContain("Left disabled unmanaged workflow");
    expect(messages.join("\n")).toContain("Updated");
  });

  it("generates repository-specific config defaults from Drupal repository signals", async () => {
    const repoRoot = createRepo("prs-setup-drupal-defaults-");
    createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, "vendor", "bin"), { recursive: true });
    mkdirSync(resolve(repoRoot, "docroot", "sites", "default", "files"), {
      recursive: true,
    });
    mkdirSync(resolve(repoRoot, "docroot", "themes", "custom", "site", "css"), {
      recursive: true,
    });
    mkdirSync(resolve(repoRoot, "docroot", "themes", "custom", "site", "js"), {
      recursive: true,
    });
    writeFileSync(
      resolve(repoRoot, "composer.json"),
      JSON.stringify(
        {
          name: "acme/drupal-site",
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "vendor", "bin", "phpunit"), "");

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/develop\n",
      "remote get-url origin": "git@gitlab.com:acme/drupal-site.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toEqual({
      ai: {
        issue: {
          useCodexSuperpowers: false,
        },
        runtime: {
          type: "codex",
        },
      },
      aiContext: {
        excludePaths: [
          "docroot/sites/default/files/**",
          "docroot/themes/**/css/**",
          "docroot/themes/**/js/**",
        ],
      },
      baseBranch: "develop",
      buildCommand: ["vendor/bin/phpunit"],
      forge: {
        type: "none",
      },
    });
  });

  it("writes .prs/.gitignore idempotently on setup reruns", async () => {
    const repoRoot = createRepo("prs-setup-prs-gitignore-rerun-");
    createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, ".prs"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, ".prs", ".gitignore"),
      ["runs/", "custom-local-state/", ""].join("\n")
    );
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@gitlab.com:acme/fixture-node-repo.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", ""]),
      repoRoot,
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", ""]),
      repoRoot,
    });

    const prsGitignore = readFileSync(resolve(repoRoot, ".prs", ".gitignore"), "utf8");
    expect(prsGitignore).toBe(
      ["runs/", "custom-local-state/", "issues/", "worktrees/", "batches/", ""].join("\n")
    );
    expect(prsGitignore.match(/^runs\/$/gm) ?? []).toHaveLength(1);
    expect(prsGitignore.match(/^issues\/$/gm) ?? []).toHaveLength(1);
    expect(prsGitignore.match(/^worktrees\/$/gm) ?? []).toHaveLength(1);
    expect(prsGitignore.match(/^batches\/$/gm) ?? []).toHaveLength(1);
  });

  it("warns but does not modify a root .gitignore that blocks tracked .prs setup files", async () => {
    const repoRoot = createRepo("prs-setup-root-prs-ignore-warning-");
    createCodexHome("prs-setup-codex-home-");
    writeFileSync(resolve(repoRoot, ".gitignore"), ".prs/\nnode_modules/\n");
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@gitlab.com:acme/fixture-node-repo.git\n",
    });

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", ""]),
      repoRoot,
    });

    expect(readFileSync(resolve(repoRoot, ".gitignore"), "utf8")).toBe(
      ".prs/\nnode_modules/\n"
    );
    expect(messages.join("\n")).toContain(
      "Warning: root .gitignore pattern `.prs/` ignores setup-managed .prs/config.json and .prs/.gitignore"
    );
  });

  it("does not write DDEV local runtime config unless explicitly confirmed", async () => {
    const repoRoot = createRepo("prs-setup-ddev-runtime-");
    createCodexHome("prs-setup-codex-home-");
    const binDir = resolve(repoRoot, "bin");
    mkdirSync(resolve(repoRoot, ".ddev"), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(resolve(binDir, "ddev"), "");
    writeFileSync(resolve(repoRoot, ".ddev", "config.yaml"), "name: fixture\n");

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${originalPath ? `:${originalPath}` : ""}`;

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@gitlab.com:acme/drupal-site.git\n",
    });

    try {
      await runSetupCommand({
        promptForLine: createPrompt(["", "n", ""]),
        repoRoot,
      });
    } finally {
      process.env.PATH = originalPath;
    }

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
        .localRuntime
    ).toBeUndefined();
  });

  it("does not write DSM local runtime config unless explicitly confirmed", async () => {
    const repoRoot = createRepo("prs-setup-dsm-runtime-");
    createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, ".dsm"), { recursive: true });
    writeFileSync(resolve(repoRoot, ".dsm", "site.json"), '{"name":"fixture"}\n');

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@gitlab.com:acme/drupal-site.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", "n", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
        .localRuntime
    ).toBeUndefined();
  });

  it("writes custom command local runtime config after explicit setup confirmation", async () => {
    const repoRoot = createRepo("prs-setup-custom-runtime-");
    createCodexHome("prs-setup-codex-home-");
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@gitlab.com:acme/fixture-node-repo.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt([
        "n",
        "",
        "",
        "",
        "",
        "",
        "y",
        "http://localhost:8888",
        "make status",
        "make up",
        "",
      ]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
        .localRuntime
    ).toEqual({
      type: "command",
      url: "http://localhost:8888",
      statusCommand: ["make", "status"],
      startCommand: ["make", "up"],
    });
  });

  it("preserves existing local runtime config on setup rerun", async () => {
    const repoRoot = createRepo("prs-setup-preserve-local-runtime-");
    createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, ".prs"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, ".prs", "config.json"),
      JSON.stringify(
        {
          localRuntime: {
            type: "command",
            url: "http://existing.test",
            statusCommand: ["make", "status"],
            startCommand: ["make", "up"],
          },
        },
        null,
        2
      )
    );

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@gitlab.com:acme/fixture-node-repo.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
        .localRuntime
    ).toEqual({
      type: "command",
      url: "http://existing.test",
      statusCommand: ["make", "status"],
      startCommand: ["make", "up"],
    });
  });

  it("rejects unexpected setup arguments", () => {
    expect(parseSetupCommandArgs(["setup"])).toEqual({ updateSkills: false });
    expect(parseSetupCommandArgs(["setup", "--update-skills"])).toEqual({
      updateSkills: true,
    });
    expect(() => parseSetupCommandArgs(["setup", "--force"])).toThrow(
      'Unknown setup option "--force". Usage:\n  prs setup\n  prs setup --update-skills'
    );
  });

  it("updates an existing AGENTS managed section during setup and keeps manual guidance", async () => {
    const repoRoot = createRepo("prs-setup-agents-");
    createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, ".github", "workflows"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");
    writeFileSync(resolve(repoRoot, ".gitignore"), ".prs/\n");
    writeFileSync(
      resolve(repoRoot, "AGENTS.md"),
      [
        "# Repository Notes",
        "",
        "Keep this manual guidance.",
        "",
        "<!-- prs:setup:start -->",
        "Old managed setup guidance.",
        "<!-- prs:setup:end -->",
        "",
      ].join("\n")
    );

    mockChildProcess(
      repoRoot,
      {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
      },
      { ghAuthStatus: new Error("not logged in") }
    );

    await runSetupCommand({
      promptForLine: createPrompt([
        "n",
        "release",
        "github",
        "codex",
        "pnpm build",
        "coverage/**, generated/**",
        "n",
        "y",
        "y",
        "y",
        "y",
        "y",
      ]),
      repoRoot,
    });

    const gitignoreContent = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
    expect(gitignoreContent.match(/\.prs\//g) ?? []).toHaveLength(1);

    const agentsContent = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("# Repository Notes");
    expect(agentsContent).toContain("Keep this manual guidance.");
    expect(agentsContent).not.toContain("Old managed setup guidance.");
    expect(agentsContent).toContain("## Repository guidance for agents");
    expect(agentsContent).toContain("Protected paths or files:");
    expect(agentsContent).not.toContain("`release`");
    expect(agentsContent).not.toContain("`pnpm build`");
    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"), "utf8")
    ).toContain("# Generated by prs setup");
  });

  it("detects npm test when the repository has tests but no build script", async () => {
    const repoRoot = createRepo("prs-setup-npm-test-");
    createCodexHome("prs-setup-codex-home-");
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-npm-repo",
          scripts: {
            test: "vitest run",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "package-lock.json"), "{}\n");

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/trunk\n",
      "remote get-url origin": "git@gitlab.com:acme/fixture-npm-repo.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toEqual({
      ai: {
        issue: {
          useCodexSuperpowers: false,
        },
        runtime: {
          type: "codex",
        },
      },
      baseBranch: "trunk",
      buildCommand: ["npm", "test"],
      forge: {
        type: "none",
      },
    });
  });

  it("preserves existing ai provider settings when setup rewrites the repository config", async () => {
    const repoRoot = createRepo("prs-setup-preserve-ai-");
    createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, ".prs"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, ".prs", "config.json"),
      JSON.stringify(
        {
          ai: {
            provider: {
              type: "openai",
              model: "gpt-5-mini",
            },
            runtime: {
              type: "claude-code",
            },
          },
          baseBranch: "main",
          buildCommand: ["pnpm", "build"],
          forge: {
            type: "github",
          },
        },
        null,
        2
      )
    );

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", "", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toEqual({
      ai: {
        issue: {
          useCodexSuperpowers: false,
        },
        provider: {
          model: "gpt-5-mini",
          type: "openai",
        },
        runtime: {
          type: "claude-code",
        },
      },
      baseBranch: "main",
      buildCommand: ["pnpm", "build"],
      forge: {
        type: "github",
      },
      githubActions: {
        workflows: {
          "pr-assistant": {
            enabled: true,
          },
          "pr-review": {
            enabled: true,
          },
          "test-suggestions": {
            enabled: true,
          },
        },
      },
    });
  });

  it("creates the AGENTS scaffold only when explicitly requested", async () => {
    const repoRoot = createRepo("prs-setup-agents-scaffold-");
    createCodexHome("prs-setup-codex-home-");
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@gitlab.com:acme/fixture-node-repo.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", "y"]),
      repoRoot,
    });

    const agentsContent = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("## Repository guidance for agents");
    expect(agentsContent).toContain(
      "Fill in only repository-specific guidance that is not obvious from code or config."
    );
    expect(agentsContent).toContain("Protected paths or files:");
    expect(agentsContent).not.toContain("Forge integration");
    expect(agentsContent).not.toContain("Verification command after interactive agent work");
  });

  it("updates managed workflow files when setup is rerun", async () => {
    const repoRoot = createRepo("prs-setup-workflow-update-");
    createCodexHome("prs-setup-codex-home-");
    mkdirSync(resolve(repoRoot, ".github", "workflows"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");
    writeFileSync(
      resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"),
      [
        "# Generated by prs setup",
        "name: Pull Request Smith PR Review",
        "jobs:",
        "  pr-review:",
        "    steps:",
        "      - uses: DevwareUK/prs/actions/pr-review@old",
        "",
      ].join("\n")
    );

    mockChildProcess(
      repoRoot,
      {
        "rev-parse --show-toplevel": `${repoRoot}\n`,
        "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
      },
      { ghAuthStatus: new Error("not logged in") }
    );

    await runSetupCommand({
      promptForLine: createPrompt(["", "", ""]),
      repoRoot,
    });

    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"), "utf8")
    ).toContain("DevwareUK/prs/actions/pr-review@main");
    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"), "utf8")
    ).not.toContain("DevwareUK/prs/actions/pr-review@old");
  });

  it("writes useCodexSuperpowers true when Superpowers is detectable for Codex", async () => {
    const repoRoot = createRepo("prs-setup-superpowers-");
    const codexHome = createCodexHome("prs-setup-codex-home-");
    writeSuperpowersPlugin(codexHome);
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
    });

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", "", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toMatchObject({
      ai: {
        issue: {
          useCodexSuperpowers: true,
        },
      },
    });
    expect(messages.join("\n")).toContain(
      "Suggested Codex Superpowers-backed issue workflows: enabled"
    );
    expect(messages.join("\n")).toContain(
      "Configured Codex Superpowers-backed issue workflows: enabled"
    );
  });

  it("preserves an existing explicit useCodexSuperpowers value on setup rerun", async () => {
    const repoRoot = createRepo("prs-setup-preserve-superpowers-");
    const codexHome = createCodexHome("prs-setup-codex-home-");
    writeSuperpowersPlugin(codexHome);
    writeFileSync(
      resolve(repoRoot, "package.json"),
      JSON.stringify(
        {
          name: "fixture-node-repo",
          scripts: {
            build: "tsup",
          },
        },
        null,
        2
      )
    );
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");
    mkdirSync(resolve(repoRoot, ".prs"), { recursive: true });
    writeFileSync(
      resolve(repoRoot, ".prs", "config.json"),
      JSON.stringify(
        {
          ai: {
            issueDraft: {
              useCodexSuperpowers: false,
            },
          },
        },
        null,
        2
      )
    );

    mockChildProcess(repoRoot, {
      "rev-parse --show-toplevel": `${repoRoot}\n`,
      "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
      "remote get-url origin": "git@github.com:acme/fixture-node-repo.git\n",
    });

    await runSetupCommand({
      promptForLine: createPrompt(["", "", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toMatchObject({
      ai: {
        issue: {
          useCodexSuperpowers: false,
        },
        issueDraft: {
          useCodexSuperpowers: false,
        },
      },
    });
  });
});
