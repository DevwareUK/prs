import { describe, expect, it } from "vitest";
import { RepositoryConfig, ResolvedRepositoryConfig } from "./repository-config";

describe("repository config schema", () => {
  it("accepts command-based local runtime readiness config", () => {
    expect(
      RepositoryConfig.parse({
        localRuntime: {
          type: "command",
          url: "https://example.ddev.site",
          statusCommand: ["ddev", "describe"],
          startCommand: ["ddev", "start"],
        },
      })
    ).toEqual({
      localRuntime: {
        type: "command",
        url: "https://example.ddev.site",
        statusCommand: ["ddev", "describe"],
        startCommand: ["ddev", "start"],
      },
    });
  });

  it("accepts an optional GitHub CLI path in forge config", () => {
    expect(
      RepositoryConfig.parse({
        forge: {
          type: "github",
          githubCliPath: "/opt/homebrew/bin/gh",
        },
      })
    ).toEqual({
      forge: {
        type: "github",
        githubCliPath: "/opt/homebrew/bin/gh",
      },
    });
  });

  it("rejects empty local runtime command segments", () => {
    expect(() =>
      RepositoryConfig.parse({
        localRuntime: {
          type: "command",
          startCommand: ["ddev", ""],
        },
      })
    ).toThrow();
  });

  it("accepts ai.issue.useCodexSuperpowers as a boolean", () => {
    expect(
      RepositoryConfig.parse({
        ai: {
          issue: {
            useCodexSuperpowers: true,
          },
        },
      })
    ).toEqual({
      ai: {
        issue: {
          useCodexSuperpowers: true,
        },
      },
    });
  });

  it("requires ai.issue.useCodexSuperpowers to be a boolean when present", () => {
    expect(() =>
      RepositoryConfig.parse({
        ai: {
          issue: {
            useCodexSuperpowers: "yes",
          },
        },
      })
    ).toThrow();
  });

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

  it("accepts managed GitHub Action workflow enablement config", () => {
    expect(
      RepositoryConfig.parse({
        githubActions: {
          workflows: {
            "pr-review": {
              enabled: true,
            },
            "test-suggestions": {
              enabled: false,
            },
          },
        },
      })
    ).toEqual({
      githubActions: {
        workflows: {
          "pr-review": {
            enabled: true,
          },
          "test-suggestions": {
            enabled: false,
          },
        },
      },
    });
  });

  it("requires managed GitHub Action workflow enabled values to be booleans", () => {
    expect(() =>
      RepositoryConfig.parse({
        githubActions: {
          workflows: {
            "pr-review": {
              enabled: "yes",
            },
          },
        },
      })
    ).toThrow();
  });

  it("requires managed GitHub Action workflow ids to be non-empty", () => {
    expect(() =>
      RepositoryConfig.parse({
        githubActions: {
          workflows: {
            "": {
              enabled: true,
            },
          },
        },
      })
    ).toThrow();
  });

  it("requires resolved ai.issueDraft.useCodexSuperpowers to be present", () => {
    expect(() =>
      ResolvedRepositoryConfig.parse({
        ai: {
          issueDraft: {
            useCodexSuperpowers: false,
          },
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
