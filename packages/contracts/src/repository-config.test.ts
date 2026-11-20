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
        issueTracker: undefined,
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
      issueTracker: { type: "github" },
      prReadiness: { commands: [] },
    })).toHaveProperty("baseBranch", "main");
  });
});

it("preserves explicit tracker configuration during migration and rejects unknown providers", () => {
  expect(migrateRepositoryConfigToAgentWorkflow({forge: {type: "none"}, issueTracker: {type: "github"}}).config)
    .toMatchObject({forge: {type: "none"}, issueTracker: {type: "github"}});
  expect(() => AgentRepositoryConfig.parse({issueTracker: {type: "linear"}})).toThrow();
});

it("accepts native Monday defaults independently of project scope", () => {
  const issueTracker = { type: "monday", defaults: { columnValues: { task_epic: { item_ids: ["3276311061"] } } }, monday: { boardId: "5105675010", scope: { columnRules: [{ columnId: "task_epic", operator: "any_of", compareValue: [3276311061] }] }, defaultsByBoard: { "5105675017": { columnValues: {} } } } };
  expect(AgentRepositoryConfig.parse({ issueTracker })).toMatchObject({ issueTracker });
});

it.each([
  { type: "monday" },
  { type: "monday", monday: { boardId: "0" } },
  { type: "github", monday: { boardId: "1" } },
  { type: "monday", monday: { boardId: "1", tokenEnv: "BAD-NAME" } },
  { type: "monday", defaults: { columnValues: "{}" }, monday: { boardId: "1" } },
  { type: "github", defaults: { columnValues: {} } },
])("rejects unusable provider defaults before network work: %j", (issueTracker) => {
  expect(() => AgentRepositoryConfig.parse({ issueTracker })).toThrow();
});
