import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
  DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS,
  DEFAULT_REPOSITORY_AI_PROVIDER_TYPE,
  DEFAULT_REPOSITORY_AI_RUNTIME_TYPE,
} from "../../core/src/repository-config";
import {
  REPOSITORY_CONFIG_RELATIVE_PATH,
  formatCommandForDisplay,
  getRepositoryConfigPath,
  loadRepositoryConfig,
  loadResolvedRepositoryConfig,
} from "./config";

const cleanupTargets = new Set<string>();

function createRepoRoot(): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-config-"));
  mkdirSync(resolve(repoRoot, ".git-ai"), { recursive: true });
  cleanupTargets.add(repoRoot);
  return repoRoot;
}

function writeRepositoryConfig(repoRoot: string, content: string): void {
  writeFileSync(getRepositoryConfigPath(repoRoot), content);
}

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

describe("config helpers", () => {
  it("resolves the repository config path under .git-ai/config.json", () => {
    expect(getRepositoryConfigPath("/tmp/example-repo")).toBe(
      "/tmp/example-repo/.git-ai/config.json"
    );
  });

  it("returns undefined when the repository config file is missing", () => {
    const repoRoot = createRepoRoot();

    expect(loadRepositoryConfig(repoRoot)).toBeUndefined();
  });

  it("loads repository ai runtime and provider config from disk", () => {
    const repoRoot = createRepoRoot();
    writeRepositoryConfig(
      repoRoot,
      JSON.stringify({
        ai: {
          issueDraft: {
            useCodexSuperpowers: true,
          },
          runtime: {
            type: "claude-code",
          },
          provider: {
            type: "bedrock-claude",
            model: "anthropic.claude-3-7-sonnet-20250219-v1:0",
            region: "eu-west-1",
          },
        },
      })
    );

    expect(loadRepositoryConfig(repoRoot)).toEqual({
      ai: {
        issueDraft: {
          useCodexSuperpowers: true,
        },
        runtime: {
          type: "claude-code",
        },
        provider: {
          type: "bedrock-claude",
          model: "anthropic.claude-3-7-sonnet-20250219-v1:0",
          region: "eu-west-1",
        },
      },
    });
  });

  it("resolves ai defaults when no repository config file exists", () => {
    const repoRoot = createRepoRoot();

    expect(loadResolvedRepositoryConfig(repoRoot)).toEqual({
      ai: {
        issueDraft: {
          useCodexSuperpowers: DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS,
        },
        runtime: {
          type: DEFAULT_REPOSITORY_AI_RUNTIME_TYPE,
        },
        provider: {
          type: DEFAULT_REPOSITORY_AI_PROVIDER_TYPE,
        },
      },
      aiContext: {
        excludePaths: [...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS],
      },
      baseBranch: "main",
      buildCommand: ["pnpm", "build"],
      forge: {
        type: "github",
      },
    });
  });

  it("resolves configured ai runtime and provider values from repository config", () => {
    const repoRoot = createRepoRoot();
    writeRepositoryConfig(
      repoRoot,
      JSON.stringify({
        ai: {
          issueDraft: {
            useCodexSuperpowers: true,
          },
          runtime: {
            type: "claude-code",
          },
          provider: {
            type: "openai",
            model: "gpt-5-mini",
            baseUrl: "https://example.test/v1",
          },
        },
      })
    );

    expect(loadResolvedRepositoryConfig(repoRoot).ai).toEqual({
      issueDraft: {
        useCodexSuperpowers: true,
      },
      runtime: {
        type: "claude-code",
      },
      provider: {
        type: "openai",
        model: "gpt-5-mini",
        baseUrl: "https://example.test/v1",
      },
    });
  });

  it("fails clearly when the repository config contains malformed json", () => {
    const repoRoot = createRepoRoot();
    writeRepositoryConfig(repoRoot, "{invalid-json");

    expect(() => loadRepositoryConfig(repoRoot)).toThrow(
      `Failed to parse ${REPOSITORY_CONFIG_RELATIVE_PATH}`
    );
  });

  it("fails clearly when the repository config contains invalid ai settings", () => {
    const repoRoot = createRepoRoot();
    writeRepositoryConfig(
      repoRoot,
      JSON.stringify({
        ai: {
          runtime: {
            type: "invalid-runtime",
          },
        },
      })
    );

    expect(() => loadRepositoryConfig(repoRoot)).toThrow(
      `Invalid ${REPOSITORY_CONFIG_RELATIVE_PATH}`
    );
  });

  it("formats command segments for display and quotes whitespace", () => {
    expect(formatCommandForDisplay(["pnpm", "run test", "--reporter=dot"])).toBe(
      'pnpm "run test" --reporter=dot'
    );
  });
});
