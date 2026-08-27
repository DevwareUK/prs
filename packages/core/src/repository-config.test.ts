import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
  resolveRepositoryConfig,
} from "./repository-config";

describe("resolveRepositoryConfig", () => {
  it("provides provider-free defaults", () => {
    expect(resolveRepositoryConfig()).toEqual({
      aiContext: { excludePaths: [...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS] },
      baseBranch: "main",
      buildCommand: ["pnpm", "build"],
      forge: { type: "github" },
      localRuntime: undefined,
      prReadiness: { commands: [] },
    });
  });

  it("merges deterministic repository overrides", () => {
    expect(resolveRepositoryConfig({
      aiContext: { excludePaths: ["fixtures/**", "fixtures/**"] },
      baseBranch: "develop",
      buildCommand: ["make", "test"],
      forge: { type: "none" },
      prReadiness: { commands: [{ name: "smoke", command: ["make", "smoke"] }] },
    })).toMatchObject({
      aiContext: { excludePaths: expect.arrayContaining(["fixtures/**"]) },
      baseBranch: "develop",
      buildCommand: ["make", "test"],
      forge: { type: "none" },
      prReadiness: { commands: [{ name: "smoke", command: ["make", "smoke"] }] },
    });
  });
});
