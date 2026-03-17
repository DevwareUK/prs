import { afterEach, describe, expect, it } from "vitest";

describe("parseTestBacklogCommandArgs", () => {
  afterEach(() => {
    delete process.env.GIT_AI_DISABLE_AUTO_RUN;
  });

  it("parses repo-level test-backlog flags for the CLI", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseTestBacklogCommandArgs } = await import("./index");

    const options = parseTestBacklogCommandArgs([
      "test-backlog",
      "--format",
      "json",
      "--top",
      "4",
      "--create-issues",
      "--max-issues",
      "8",
      "--label",
      "tests",
      "--labels",
      "cli, smoke",
      "--repo-root",
      "packages/core",
    ]);

    expect(options.format).toBe("json");
    expect(options.top).toBe(4);
    expect(options.createIssues).toBe(true);
    expect(options.maxIssues).toBe(4);
    expect(options.labels).toEqual(["tests", "cli", "smoke"]);
    expect(options.repoRoot).toMatch(/packages\/core$/);
  });
});
