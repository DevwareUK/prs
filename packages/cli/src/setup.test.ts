import {
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
}));

import { execFileSync } from "node:child_process";
import { parseSetupCommandArgs, runSetupCommand } from "./setup";

const cleanupTargets = new Set<string>();
const execFileSyncMock = vi.mocked(execFileSync);

function createRepo(prefix: string): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), prefix));
  cleanupTargets.add(repoRoot);
  return repoRoot;
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
  options: { ghAuthStatus?: string | Error } = {}
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
}

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("setup command", () => {
  it("runs setup with repo-aware defaults and writes config, gitignore, and AGENTS guidance", async () => {
    const repoRoot = createRepo("git-ai-setup-node-");
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
      promptForLine: createPrompt(["", "", "", "", ""], prompts),
      repoRoot,
    });

    expect(prompts).toHaveLength(5);
    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".git-ai", "config.json"), "utf8"))
    ).toEqual({
      aiContext: {
        excludePaths: ["**/coverage/**"],
      },
      baseBranch: "main",
      buildCommand: ["pnpm", "build"],
      forge: {
        type: "github",
      },
    });
    expect(readFileSync(resolve(repoRoot, ".gitignore"), "utf8")).toContain(".git-ai/\n");

    const agentsContent = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("<!-- git-ai:setup:start -->");
    expect(agentsContent).toContain("Detected stack: TypeScript repository.");
    expect(agentsContent).toContain("`pnpm build`");
    expect(agentsContent).toContain("`github`");
    expect(messages.join("\n")).toContain("Next step: create `.env`");
  });

  it("generates repository-specific config defaults from Drupal repository signals", async () => {
    const repoRoot = createRepo("git-ai-setup-drupal-defaults-");
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
      promptForLine: createPrompt(["", "", "", "", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".git-ai", "config.json"), "utf8"))
    ).toEqual({
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
      'Unknown setup option "--force". Usage:\n  git-ai setup'
    );
  });

  it("updates an existing AGENTS managed section during setup and keeps manual guidance", async () => {
    const repoRoot = createRepo("git-ai-setup-agents-");
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
    writeFileSync(resolve(repoRoot, ".gitignore"), ".git-ai/\n");
    writeFileSync(
      resolve(repoRoot, "AGENTS.md"),
      [
        "# Repository Notes",
        "",
        "Keep this manual guidance.",
        "",
        "<!-- git-ai:setup:start -->",
        "Old managed setup guidance.",
        "<!-- git-ai:setup:end -->",
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
        "release",
        "github",
        "pnpm build",
        "coverage/**, generated/**",
        "y",
      ]),
      repoRoot,
    });

    const gitignoreContent = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
    expect(gitignoreContent.match(/\.git-ai\//g) ?? []).toHaveLength(1);

    const agentsContent = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("# Repository Notes");
    expect(agentsContent).toContain("Keep this manual guidance.");
    expect(agentsContent).not.toContain("Old managed setup guidance.");
    expect(agentsContent).toContain("`release`");
    expect(agentsContent).toContain("`pnpm build`");
    expect(agentsContent).toContain("`coverage/**`");
    expect(agentsContent).toContain("`generated/**`");
  });

  it("detects npm test when the repository has tests but no build script", async () => {
    const repoRoot = createRepo("git-ai-setup-npm-test-");
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
      promptForLine: createPrompt(["", "", "", "", ""]),
      repoRoot,
    });

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".git-ai", "config.json"), "utf8"))
    ).toEqual({
      baseBranch: "trunk",
      buildCommand: ["npm", "test"],
      forge: {
        type: "none",
      },
    });
  });
});
