import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
    createCodexHome("prs-setup-codex-home-");
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
      promptForLine: createPrompt(["", "", ""], prompts),
      repoRoot,
    });

    expect(prompts).toHaveLength(3);
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
    });
    expect(readFileSync(resolve(repoRoot, ".gitignore"), "utf8")).toContain(".prs/\n");
    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"), "utf8")
    ).toContain("DevwareUK/prs/actions/pr-review@main");
    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-assistant.yml"), "utf8")
    ).toContain("DevwareUK/prs/actions/pr-assistant@main");
    expect(
      readFileSync(
        resolve(repoRoot, ".github", "workflows", "prs-test-suggestions.yml"),
        "utf8"
      )
    ).toContain("DevwareUK/prs/actions/test-suggestions@main");
    expect(messages.join("\n")).toContain(
      "Recommended launch path: GitHub forge, OpenAI provider, and Codex runtime."
    );
    expect(messages.join("\n")).toContain(
      "GitHub Actions in this repo are OpenAI-only today, and unattended issue runs plus `prs pr prepare-review` remain Codex-specific."
    );
    expect(existsSync(resolve(repoRoot, "AGENTS.md"))).toBe(false);
    expect(messages.join("\n")).toContain("Next step: create `.env`");
    expect(messages.join("\n")).toContain("OPENAI_API_KEY` repository secret");
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

  it("rejects unexpected setup arguments", () => {
    expect(() => parseSetupCommandArgs(["setup", "--force"])).toThrow(
      'Unknown setup option "--force". Usage:\n  prs setup'
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

  it("updates legacy generated workflow files when setup is rerun", async () => {
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
        "name: Git AI PR Review",
        "jobs:",
        "  pr-review:",
        "    steps:",
        "      - uses: DevwareUK/ai-actions/actions/pr-review@main",
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
    ).not.toContain("DevwareUK/ai-actions/actions/pr-review@main");
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
