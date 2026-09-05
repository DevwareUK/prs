import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSetupCommandArgs, runSetupCommand } from "./setup";

describe("provider-free setup", () => {
  it("parses Copilot telemetry opt-in and rejects contradictory or repeated options", () => {
    expect(parseSetupCommandArgs(["setup", "--skills", "all", "--copilot-telemetry=enable"])).toEqual({ skills: "all", copilotTelemetry: "enable" });
    expect(parseSetupCommandArgs(["setup", "--copilot-telemetry", "disable", "--skills=copilot"])).toEqual({ skills: "copilot", copilotTelemetry: "disable" });
    for (const args of [["--skills", "none", "--copilot-telemetry", "enable"], ["--skills=all", "--skills=copilot"], ["--skills=all", "--copilot-telemetry=no"]]) {
      expect(() => parseSetupCommandArgs(["setup", ...args])).toThrow();
    }
  });
  it("parses the setup surface", () => {
    expect(parseSetupCommandArgs(["setup"])).toEqual({});
    expect(parseSetupCommandArgs(["setup", "--skills", "all"])).toEqual({ skills: "all" });
    expect(parseSetupCommandArgs(["setup", "--skills=codex"])).toEqual({ skills: "codex" });
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

  it("installs all host adapters when selected without adding host configuration", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-setup-all-skills-"));
    execFileSync("git", ["init", repoRoot], { stdio: "ignore" });
    const installed: string[] = [];
    await runSetupCommand({
      repoRoot,
      skills: "all",
      promptForLine: async () => {
        throw new Error("explicit selection must not prompt");
      },
      installSkills: (host) => {
        installed.push(host);
        return {
          host,
          targetRoot: `/skills/${host}`,
          installed: [],
          updated: [],
          unchanged: [],
          skipped: [],
          retiredLegacy: [],
          legacySkipped: [],
        };
      },
    });

    expect(installed).toEqual(["codex", "claude-code", "copilot"]);
    const config = JSON.parse(readFileSync(join(repoRoot, ".prs/config.json"), "utf8"));
    expect(config).not.toHaveProperty("hosts");
    expect(config).not.toHaveProperty("skills");
  });

  it("offers host installation interactively when no setup flag is supplied", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-setup-prompt-skills-"));
    execFileSync("git", ["init", repoRoot], { stdio: "ignore" });
    const installed: string[] = [];
    await runSetupCommand({
      repoRoot,
      interactive: true,
      discoverAccounts: () => ({ accounts: [] }),
      promptForLine: async () => "claude-code",
      installSkills: (host) => {
        installed.push(host);
        return {
          host,
          targetRoot: `/skills/${host}`,
          installed: [],
          updated: [],
          unchanged: [],
          skipped: [],
          retiredLegacy: [],
          legacySkipped: [],
        };
      },
    });
    expect(installed).toEqual(["claude-code"]);
  });
});

function setupRepo(account?: string) {
  const root = mkdtempSync(join(tmpdir(), "prs-setup-account-"));
  execFileSync("git", ["init", root], { stdio: "ignore" });
  mkdirSync(join(root, ".prs"));
  writeFileSync(join(root, ".prs/.gitignore"), "custom/\n");
  if (account) writeFileSync(join(root, ".prs/config.local.json"), JSON.stringify({ forge: { githubAccount: account } }));
  return root;
}

describe("setup GitHub account selection", () => {
  it("offers saved accounts and writes only the selected local account", async () => {
    const repoRoot = setupRepo();
    const prompts: string[] = [];
    await runSetupCommand({ repoRoot, interactive: true, discoverAccounts: () => ({ accounts: ["personal", "work"] }),
      promptForLine: async prompt => { prompts.push(prompt); return prompts.length === 1 ? "none" : "2"; },
    });
    expect(prompts[1]).toContain("personal");
    expect(prompts[1]).toContain("work");
    expect(prompts[1]).toContain("Use the default account");
    expect(JSON.parse(readFileSync(join(repoRoot, ".prs/config.local.json"), "utf8"))).toEqual({ forge: { githubAccount: "work" } });
    expect(readFileSync(join(repoRoot, ".prs/config.json"), "utf8")).not.toContain("work");
    expect(readFileSync(join(repoRoot, ".prs/.gitignore"), "utf8")).toContain("custom/\n");
    expect(execFileSync("git", ["-C", repoRoot, "check-ignore", ".prs/config.local.json"], { encoding: "utf8" }).trim()).toBe(".prs/config.local.json");
  });

  it.each(["work", "unavailable"])("preserves existing %s selection when accepting defaults", async account => {
    const repoRoot = setupRepo(account);
    await runSetupCommand({ repoRoot, interactive: true, discoverAccounts: () => ({ accounts: ["work"] }), promptForLine: async () => "" });
    expect(JSON.parse(readFileSync(join(repoRoot, ".prs/config.local.json"), "utf8")).forge.githubAccount).toBe(account);
  });

  it("clears only account selection when the default is explicitly selected", async () => {
    const repoRoot = setupRepo("work");
    let step = 0;
    await runSetupCommand({ repoRoot, interactive: true, discoverAccounts: () => ({ accounts: ["work"] }), promptForLine: async () => ++step === 1 ? "none" : "0" });
    expect(JSON.parse(readFileSync(join(repoRoot, ".prs/config.local.json"), "utf8")).forge?.githubAccount).toBeUndefined();
  });

  it("does not create a local file when using the default", async () => {
    const repoRoot = setupRepo();
    await runSetupCommand({ repoRoot, interactive: true, discoverAccounts: () => ({ accounts: ["work"] }), promptForLine: async () => "" });
    expect(existsSync(join(repoRoot, ".prs/config.local.json"))).toBe(false);
  });

  it.each([{ interactive: false }, { interactive: true, skills: "none" as const }])("preserves account without prompts in scripted setup: %j", async mode => {
    const repoRoot = setupRepo("work");
    const before = readFileSync(join(repoRoot, ".prs/config.local.json"), "utf8");
    await runSetupCommand({ repoRoot, ...mode, discoverAccounts: () => { throw new Error("must not discover accounts"); }, promptForLine: async () => { throw new Error("must not prompt"); } });
    expect(readFileSync(join(repoRoot, ".prs/config.local.json"), "utf8")).toBe(before);
  });

  it("preserves an existing account when no accounts are available", async () => {
    const repoRoot = setupRepo("work");
    await runSetupCommand({ repoRoot, interactive: true, discoverAccounts: () => ({ accounts: [], guidance: "Install gh and log in" }), promptForLine: async () => "none" });
    expect(JSON.parse(readFileSync(join(repoRoot, ".prs/config.local.json"), "utf8")).forge.githubAccount).toBe("work");
  });

  it("skips account discovery for a disabled forge", async () => {
    const repoRoot = setupRepo();
    writeFileSync(join(repoRoot, ".prs/config.json"), JSON.stringify({ forge: { type: "none" } }));
    await runSetupCommand({ repoRoot, interactive: true, discoverAccounts: () => { throw new Error("must not discover accounts"); }, promptForLine: async () => "none" });
    expect(existsSync(join(repoRoot, ".prs/config.local.json"))).toBe(false);
  });
});
