import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
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
    expect(resolved.aiContext.excludePaths).toEqual([
      ...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
      "web/themes/**/css/**",
    ]);
  });
});
