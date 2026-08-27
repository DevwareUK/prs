import { describe, expect, it } from "vitest";
import {
  AgentRepositoryConfig,
  migrateRepositoryConfigToAgentWorkflow,
  ResolvedRepositoryConfig,
} from "./repository-config";

describe("agent repository configuration", () => {
  it("accepts only deterministic local workflow settings", () => {
    expect(AgentRepositoryConfig.parse({
      baseBranch: "develop",
      buildCommand: ["pnpm", "test"],
      forge: { type: "github" },
      localRuntime: { type: "command", startCommand: ["make", "up"] },
      prReadiness: { commands: [{ name: "build", command: ["pnpm", "build"] }] },
    })).toMatchObject({ baseBranch: "develop", forge: { type: "github" } });
    expect(() => AgentRepositoryConfig.parse({ ai: { provider: { type: "openai" } } })).toThrow();
    expect(() => AgentRepositoryConfig.parse({ githubActions: {} })).toThrow();
  });

  it("strips retired provider and Actions sections with one migration notice", () => {
    expect(migrateRepositoryConfigToAgentWorkflow({
      baseBranch: "main",
      ai: { runtime: { type: "codex" } },
      githubActions: { workflows: { prReview: true } },
    })).toEqual({
      config: {
        aiContext: undefined,
        baseBranch: "main",
        buildCommand: undefined,
        forge: undefined,
        localRuntime: undefined,
        prReadiness: undefined,
      },
      notices: [expect.stringContaining("ai, githubActions")],
    });
  });

  it("validates the fully resolved shape", () => {
    expect(ResolvedRepositoryConfig.parse({
      aiContext: { excludePaths: ["dist/**"] },
      baseBranch: "main",
      buildCommand: ["pnpm", "build"],
      forge: { type: "github" },
      prReadiness: { commands: [] },
    })).toHaveProperty("baseBranch", "main");
  });
});
