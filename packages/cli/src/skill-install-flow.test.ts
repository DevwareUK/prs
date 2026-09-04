import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSkillsCommand } from "./commands/skills";
import { runSetupCommand } from "./setup";
import { installAgentSkills, type InstallableAgentHost } from "./agent-skills-installer";
import type { LaunchEnvironment } from "./copilot-app-telemetry";
const roots: string[] = [];
function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "prs-install-flow-"))); roots.push(home);
  const values = new Map<string, string>();
  const launchEnvironment: LaunchEnvironment = { get: k => values.get(k), set: (k, v) => { values.set(k, v); }, unset: k => { values.delete(k); }, unload: () => undefined };
  return { home, values, telemetryOptions: { home, platform: "darwin", launchEnvironment }, installSkills: (host: InstallableAgentHost) => installAgentSkills({ host, home, sourceRoot: resolve(".") }) };
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("shared skills/setup telemetry flow", () => {
  it("installs all portable hosts and emits one JSON result without prompts or telemetry writes", async () => {
    const f = fixture(), chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => { chunks.push(String(chunk)); return true; });
    await runSkillsCommand(["skills", "install", "all", "--json"], { ...f, interactive: true, promptForLine: async () => { throw Error("JSON must not prompt"); } });
    const output = JSON.parse(chunks.join(""));
    expect(output.hosts.map((r: { host: string }) => r.host)).toEqual(["codex", "claude-code", "copilot"]);
    expect(output.hosts[2].unchanged).toHaveLength(6);
    expect(existsSync(join(f.home, ".agents/skills/prs/SKILL.md"))).toBe(true);
    expect(existsSync(join(f.home, ".claude/skills/prs/SKILL.md"))).toBe(true);
    expect(f.values.size).toBe(0);
    expect(existsSync(join(f.home, "Library"))).toBe(false);
  });
  it("asks once for all and does not re-prompt after an accepted setup", async () => {
    const f = fixture(); let prompts = 0;
    const input = { ...f, interactive: true, promptForLine: async () => { prompts++; return "yes"; } };
    await runSkillsCommand(["skills", "install", "all"], input);
    await runSkillsCommand(["skills", "install", "copilot"], input);
    expect(prompts).toBe(1);
    expect(f.values.get("COPILOT_OTEL_EXPORTER_TYPE")).toBe("file");
    expect(readdirSync(join(f.home, "Library/LaunchAgents"))).toHaveLength(3);
  });
  it("does not configure telemetry on decline, non-interactive default, or non-Copilot installs", async () => {
    for (const [host, interactive, answer] of [["copilot", true, ""], ["all", false, "yes"], ["claude-code", true, "yes"], ["codex", true, "yes"]] as const) {
      const f = fixture(); let prompts = 0;
      await runSkillsCommand(["skills", "install", host], { ...f, interactive, promptForLine: async () => { prompts++; return answer; } });
      expect(prompts).toBe(host === "copilot" ? 1 : 0);
      expect(f.values.size).toBe(0);
      expect(existsSync(join(f.home, "Library"))).toBe(false);
    }
  });
  it("applies explicit enable/disable in JSON mode without prompting", async () => {
    const f = fixture(), chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => { chunks.push(String(chunk)); return true; });
    for (const action of ["enable", "disable"]) {
      chunks.length = 0;
      await runSkillsCommand(["skills", "install", "copilot", "--json", "--copilot-telemetry", action], { ...f, interactive: true, promptForLine: async () => { throw Error("explicit choice must not prompt"); } });
      expect(JSON.parse(chunks.join(""))).toMatchObject({ host: "copilot", copilotTelemetry: { status: action === "enable" ? "enabled" : "disabled" } });
    }
    expect(f.values.size).toBe(0);
  });
  it.each(["copilot", "all"])("offers telemetry when prs setup interactively selects %s", async selection => {
    const f = fixture(), repoRoot = join(f.home, "repo"); execFileSync("git", ["init", repoRoot], { stdio: "ignore" });
    const prompts: string[] = [];
    await runSetupCommand({ ...f, repoRoot, interactive: true, discoverAccounts: () => ({ accounts: [] }), promptForLine: async prompt => { prompts.push(prompt); return prompts.length === 1 ? selection : "yes"; } });
    expect(prompts).toHaveLength(2);
    expect(f.values.get("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT")).toBe("false");
    expect(JSON.parse(readFileSync(join(repoRoot, ".prs/config.json"), "utf8"))).not.toHaveProperty("telemetry");
  });
  it("respects explicit setup flags without extra prompts", async () => {
    const f = fixture(), repoRoot = join(f.home, "repo"); execFileSync("git", ["init", repoRoot], { stdio: "ignore" });
    await runSetupCommand({ ...f, repoRoot, skills: "all", copilotTelemetry: "enable", interactive: false, promptForLine: async () => { throw Error("must not prompt"); } });
    expect(f.values.size).toBe(3);
  });
});
