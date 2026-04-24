import { describe, expect, it } from "vitest";
import { RepositoryConfig, ResolvedRepositoryConfig } from "./repository-config";

describe("repository config schema", () => {
  it("accepts ai.issueDraft.useCodexSuperpowers as a boolean", () => {
    expect(
      RepositoryConfig.parse({
        ai: {
          issueDraft: {
            useCodexSuperpowers: true,
          },
        },
      })
    ).toEqual({
      ai: {
        issueDraft: {
          useCodexSuperpowers: true,
        },
      },
    });
  });

  it("requires ai.issueDraft.useCodexSuperpowers to be a boolean when present", () => {
    expect(() =>
      RepositoryConfig.parse({
        ai: {
          issueDraft: {
            useCodexSuperpowers: "yes",
          },
        },
      })
    ).toThrow();
  });

  it("requires resolved ai.issueDraft.useCodexSuperpowers to be present", () => {
    expect(() =>
      ResolvedRepositoryConfig.parse({
        ai: {
          runtime: {
            type: "codex",
          },
          provider: {
            type: "openai",
          },
        },
        aiContext: {
          excludePaths: [],
        },
        baseBranch: "main",
        buildCommand: ["pnpm", "build"],
        forge: {
          type: "github",
        },
      })
    ).toThrow();
  });
});
