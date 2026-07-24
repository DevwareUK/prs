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

  it("accepts ordered PR local readiness commands", () => {
    expect(
      RepositoryConfig.parse({
        prReadiness: {
          commands: [
            {
              name: "Install dependencies",
              command: ["pnpm", "install"],
            },
            {
              name: "Run updates",
              command: ["ddev", "drush", "updb", "-y"],
            },
          ],
        },
      })
    ).toEqual({
      prReadiness: {
        commands: [
          {
            name: "Install dependencies",
            command: ["pnpm", "install"],
          },
          {
            name: "Run updates",
            "command": ["ddev", "drush", "updb", "-y"],
          },
        ],
      },
    });
  });

  it("rejects empty PR local readiness command names and segments", () => {
    expect(() =>
      RepositoryConfig.parse({
        prReadiness: {
          commands: [
            {
              name: "",
              command: ["pnpm", "install"],
            },
          ],
        },
      })
    ).toThrow();

    expect(() =>
      RepositoryConfig.parse({
        prReadiness: {
          commands: [
            {
              name: "Install dependencies",
              command: ["pnpm", ""],
            },
          ],
        },
      })
    ).toThrow();
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

  it("accepts ai.codex.preferSubagents as a boolean", () => {
    expect(
      RepositoryConfig.parse({
        ai: {
          codex: {
            preferSubagents: false,
          },
        },
      })
    ).toEqual({
      ai: {
        codex: {
          preferSubagents: false,
        },
      },
    });
  });

  it("requires ai.codex.preferSubagents to be a boolean when present", () => {
    expect(() =>
      RepositoryConfig.parse({
        ai: {
          codex: {
            preferSubagents: "yes",
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

  it("rejects legacy ai.models role overrides", () => {
    expect(() =>
      RepositoryConfig.parse({
        ai: {
          models: {
            planner: "gpt-5-plan",
          },
        },
      })
    ).toThrow();
  });

  it("rejects legacy ai.thinking role overrides", () => {
    expect(() =>
      RepositoryConfig.parse({
        ai: {
          thinking: {
            planner: "high",
          },
        },
      })
    ).toThrow();
  });

  it("rejects removed ai profiles and role routing", () => {
    expect(() =>
      RepositoryConfig.parse({
        ai: {
          profiles: {
            standard: { model: "gpt-5.4-mini", thinking: "medium" },
          },
        },
      })
    ).toThrow();

    expect(() =>
      RepositoryConfig.parse({
        ai: {
          roles: { implementer: "standard" },
        },
      })
    ).toThrow();
  });

  it("accepts ai cost estimate overrides", () => {
    expect(
      RepositoryConfig.parse({
        ai: {
          costEstimates: {
            currency: "USD",
            inputTokenRatio: 0.7,
            outputTokenRatio: 0.3,
            modelRates: {
              "gpt-5.4-mini": {
                inputPerMillionTokens: 1,
                outputPerMillionTokens: 5,
              },
            },
          },
        },
      })
    ).toEqual({
      ai: {
        costEstimates: {
          currency: "USD",
          inputTokenRatio: 0.7,
          outputTokenRatio: 0.3,
          modelRates: {
            "gpt-5.4-mini": {
              inputPerMillionTokens: 1,
              outputPerMillionTokens: 5,
            },
          },
        },
      },
    });
  });

  it("requires ai cost estimate ratios to add up to 1", () => {
    expect(() =>
      RepositoryConfig.parse({
        ai: {
          costEstimates: {
            inputTokenRatio: 0.8,
            outputTokenRatio: 0.3,
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
          codex: {
            preferSubagents: true,
          },
          profiles: {
            standard: {
              model: "gpt-5.4-mini",
              thinking: "medium",
            },
          },
          roles: {
            planner: "standard",
            implementer: "standard",
            reviewer: "standard",
            tester: "standard",
          },
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

  it("requires resolved ai.codex.preferSubagents to be present", () => {
    expect(() =>
      ResolvedRepositoryConfig.parse({
        ai: {
          issue: {
            useCodexSuperpowers: false,
          },
          profiles: {
            standard: {
              model: "gpt-5.4-mini",
              thinking: "medium",
            },
          },
          roles: {
            planner: "standard",
            implementer: "standard",
            reviewer: "standard",
            tester: "standard",
          },
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
        githubActions: {},
      })
    ).toThrow();
  });

  it("requires resolved ai profile models to be strings", () => {
    expect(() =>
      ResolvedRepositoryConfig.parse({
        ai: {
          codex: {
            preferSubagents: true,
          },
          issue: {
            useCodexSuperpowers: false,
          },
          issueDraft: {
            useCodexSuperpowers: false,
          },
          profiles: {
            standard: {
              model: 123,
              thinking: "medium",
            },
          },
          roles: {
            planner: "standard",
            implementer: "standard",
            reviewer: "standard",
            tester: "standard",
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

  it("requires resolved ai profile thinking values to be supported levels", () => {
    expect(() =>
      ResolvedRepositoryConfig.parse({
        ai: {
          codex: {
            preferSubagents: true,
          },
          issue: {
            useCodexSuperpowers: false,
          },
          issueDraft: {
            useCodexSuperpowers: false,
          },
          profiles: {
            standard: {
              model: "gpt-5.4-mini",
              thinking: "deep",
            },
          },
          roles: {
            planner: "standard",
            implementer: "standard",
            reviewer: "standard",
            tester: "standard",
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
