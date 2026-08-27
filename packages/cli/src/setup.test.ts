import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSetupCommandArgs, runSetupCommand } from "./setup";

describe("provider-free setup", () => {
  it("parses the setup surface", () => {
    expect(parseSetupCommandArgs(["setup"])).toEqual({});
    expect(() => parseSetupCommandArgs(["setup", "--update-skills"])).toThrow("Unknown setup option");
    expect(() => parseSetupCommandArgs(["setup", "--actions"])).toThrow("Unknown setup option");
  });

  it("writes only agent-neutral repository configuration", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-setup-"));
    execFileSync("git", ["init", repoRoot], { stdio: "ignore" });
    await runSetupCommand({ repoRoot, promptForLine: async () => "" });
    const config = JSON.parse(readFileSync(join(repoRoot, ".prs/config.json"), "utf8"));
    expect(config).toMatchObject({ baseBranch: "main", forge: { type: "github" } });
    expect(config).not.toHaveProperty("ai");
    expect(config).not.toHaveProperty("githubActions");
    expect(readFileSync(join(repoRoot, ".prs/.gitignore"), "utf8")).toContain("runs/");
  });
});
