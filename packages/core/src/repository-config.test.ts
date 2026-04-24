import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
  DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS,
  DEFAULT_REPOSITORY_AI_PROVIDER_TYPE,
  DEFAULT_REPOSITORY_AI_RUNTIME_TYPE,
  resolveRepositoryConfig,
} from "./repository-config";

describe("resolveRepositoryConfig", () => {
  it("adds default AI context exclusions and merges repository patterns", () => {
    const resolved = resolveRepositoryConfig({
      aiContext: {
        excludePaths: ["web/themes/**/css/**", "*.map"],
      },
      baseBranch: "develop",
    });

    expect(resolved.baseBranch).toBe("develop");
    expect(resolved.ai).toEqual({
      issueDraft: {
        useCodexSuperpowers: DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS,
      },
      runtime: { type: DEFAULT_REPOSITORY_AI_RUNTIME_TYPE },
      provider: { type: DEFAULT_REPOSITORY_AI_PROVIDER_TYPE },
    });
    expect(resolved.aiContext.excludePaths).toEqual([
      ...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
      "web/themes/**/css/**",
    ]);
  });

  it("preserves configured ai runtime and provider options", () => {
    const resolved = resolveRepositoryConfig({
      ai: {
        runtime: {
          type: "claude-code",
        },
        provider: {
          type: "bedrock-claude",
          model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
          region: "eu-west-1",
        },
      },
    });

    expect(resolved.ai).toEqual({
      issueDraft: {
        useCodexSuperpowers: DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS,
      },
      runtime: {
        type: "claude-code",
      },
      provider: {
        type: "bedrock-claude",
        model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
        region: "eu-west-1",
      },
    });
  });

  it("defaults the missing ai selection while preserving the configured one", () => {
    expect(
      resolveRepositoryConfig({
        ai: {
          runtime: {
            type: "claude-code",
          },
        },
      }).ai
    ).toEqual({
      issueDraft: {
        useCodexSuperpowers: DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS,
      },
      runtime: {
        type: "claude-code",
      },
      provider: {
        type: DEFAULT_REPOSITORY_AI_PROVIDER_TYPE,
      },
    });

    expect(
      resolveRepositoryConfig({
        ai: {
          provider: {
            type: "openai",
            model: "gpt-5-mini",
            baseUrl: "https://example.test/v1",
          },
        },
      }).ai
    ).toEqual({
      issueDraft: {
        useCodexSuperpowers: DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS,
      },
      runtime: {
        type: DEFAULT_REPOSITORY_AI_RUNTIME_TYPE,
      },
      provider: {
        type: "openai",
        model: "gpt-5-mini",
        baseUrl: "https://example.test/v1",
      },
    });
  });

  it("defaults and preserves ai.issueDraft.useCodexSuperpowers", () => {
    expect(resolveRepositoryConfig().ai.issueDraft).toEqual({
      useCodexSuperpowers: DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS,
    });

    expect(
      resolveRepositoryConfig({
        ai: {
          issueDraft: {
            useCodexSuperpowers: true,
          },
        },
      }).ai.issueDraft
    ).toEqual({
      useCodexSuperpowers: true,
    });
  });
});
