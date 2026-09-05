import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, existsSync, statSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { manageCopilotAppTelemetry, type LaunchEnvironment } from "./copilot-app-telemetry";

const roots: string[] = [];
const exporter = "COPILOT_OTEL_FILE_EXPORTER_PATH", content = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT";
function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "prs-app-telemetry-"))); roots.push(home);
  const values = new Map<string, string>(), unloaded: string[] = [];
  const launchEnvironment: LaunchEnvironment = {
    get: key => values.get(key), set: (key, value) => { values.set(key, value); }, unset: key => { values.delete(key); }, unload: label => { unloaded.push(label); },
  };
  return { home, platform: "darwin", launchEnvironment, values, unloaded, agents: join(home, "Library/LaunchAgents"), root: join(home, "Library/Application Support/prs/copilot-usage") };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("opt-in Copilot app launch environment", () => {
  it("detects missing login jobs instead of claiming a stale setup is enabled", () => {
    const f = fixture(); manageCopilotAppTelemetry("enable", f);
    rmSync(join(f.agents, readdirSync(f.agents)[0]));
    expect(manageCopilotAppTelemetry("status", f).status).toBe("pending");
    expect(manageCopilotAppTelemetry("enable", f).status).toBe("enabled");
    expect(readdirSync(f.agents)).toHaveLength(3);
  });
  it.skipIf(process.platform !== "darwin")("produces valid launchd argument arrays even with XML-sensitive path characters", () => {
    const f = fixture(), home = join(f.home, 'quotes " & <tag>'); mkdirSync(home);
    manageCopilotAppTelemetry("enable", { ...f, home });
    const agents = join(home, "Library/LaunchAgents");
    const parsed = readdirSync(agents).map(file => JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", join(agents, file)], { encoding: "utf8" })));
    expect(parsed.every(p => p.RunAtLoad === true && p.ProgramArguments[0] === "/bin/launchctl" && p.ProgramArguments[1] === "setenv")).toBe(true);
    expect(parsed.find(p => p.ProgramArguments[2] === exporter).ProgramArguments[3]).toBe(join(home, "Library/Application Support/prs/copilot-usage/usage.jsonl"));
  });
  it("enables local-only export with private artifacts and three shell-free login jobs", () => {
    const f = fixture(), result = manageCopilotAppTelemetry("enable", f);
    expect(result.status).toBe("enabled");
    expect(f.values.get(exporter)).toBe(join(f.root, "usage.jsonl"));
    expect(f.values.get(content)).toBe("false");
    expect(f.values.get("COPILOT_OTEL_EXPORTER_TYPE")).toBe("file");
    expect(f.values.size).toBe(3);
    expect(statSync(result.outputFile!).mode & 0o777).toBe(0o600);
    expect(statSync(f.root).mode & 0o777).toBe(0o700);
    const files = readdirSync(f.agents);
    expect(files).toHaveLength(3);
    // The launchd boundary must receive a literal executable and argument array, not shell code.
    for (const file of files) {
      const plist = readFileSync(join(f.agents, file), "utf8");
      expect(plist).toContain("<string>/bin/launchctl</string>");
      expect(plist).toContain("<string>setenv</string>");
      expect(plist).toContain("<key>RunAtLoad</key><true/>");
      expect(plist).not.toContain("/bin/sh");
    }
  });
  it("keeps repeat enable idempotent and disables only owned settings while retaining logs", () => {
    const f = fixture(); manageCopilotAppTelemetry("enable", f);
    writeFileSync(join(f.root, "usage.jsonl"), "saved usage\n");
    expect(manageCopilotAppTelemetry("enable", f).status).toBe("enabled");
    expect(manageCopilotAppTelemetry("status", f).status).toBe("enabled");
    f.values.set(content, "user-changed");
    expect(manageCopilotAppTelemetry("disable", f).status).toBe("disabled");
    expect(f.values.get(content)).toBe("user-changed");
    expect(f.values.has(exporter)).toBe(false);
    expect(f.values.has("COPILOT_OTEL_EXPORTER_TYPE")).toBe(false);
    expect(readFileSync(join(f.root, "usage.jsonl"), "utf8")).toBe("saved usage\n");
    expect(readdirSync(f.agents)).toEqual([]);
    expect(f.unloaded).toHaveLength(3);
    expect(manageCopilotAppTelemetry("disable", f).status).toBe("disabled");
  });
  it("preserves compatible settings that existed before PRS setup", () => {
    const f = fixture(); f.values.set(content, "false");
    manageCopilotAppTelemetry("enable", f); manageCopilotAppTelemetry("disable", f);
    expect(f.values.get(content)).toBe("false");
  });
  it("refuses conflicting environment settings before enabling anything", () => {
    const f = fixture(); f.values.set(exporter, "/custom/usage.jsonl");
    expect(() => manageCopilotAppTelemetry("enable", f)).toThrow(/existing|conflict/i);
    expect(f.values.size).toBe(1);
    expect(f.values.get(exporter)).toBe("/custom/usage.jsonl");
    expect(existsSync(join(f.root, "state.json"))).toBe(false);
  });
  it("preserves customized managed job files on enable and disable", () => {
    const f = fixture(); manageCopilotAppTelemetry("enable", f);
    const file = join(f.agents, readdirSync(f.agents)[0]); writeFileSync(file, "customized");
    for (const action of ["enable", "disable"] as const) expect(() => manageCopilotAppTelemetry(action, f)).toThrow(/custom|changed/i);
    expect(readFileSync(file, "utf8")).toBe("customized");
    expect(f.values.has(exporter)).toBe(true);
  });
  it("does not follow a symlinked configuration directory", () => {
    const f = fixture(), elsewhere = join(f.home, "elsewhere"); mkdirSync(elsewhere); symlinkSync(elsewhere, join(f.home, "Library"));
    expect(() => manageCopilotAppTelemetry("enable", f)).toThrow(/symlink/i);
    expect(readdirSync(elsewhere)).toEqual([]);
    expect(f.values.size).toBe(0);
  });
  it("does not call launch services on unsupported systems or read-only status", () => {
    const f = fixture();
    const launchEnvironment: LaunchEnvironment = { get() { throw Error("unexpected launch service call"); }, set() { throw Error("unexpected call"); }, unset() { throw Error("unexpected call"); }, unload() { throw Error("unexpected call"); } };
    expect(manageCopilotAppTelemetry("enable", { ...f, platform: "linux", launchEnvironment }).status).toBe("unsupported");
    expect(manageCopilotAppTelemetry("status", { ...f, launchEnvironment }).status).toBe("not-configured");
    expect(readdirSync(f.home)).toEqual([]);
  });
  it("reports incomplete activation and supports recovery after a launch-service failure", () => {
    const f = fixture(); let count = 0;
    const launchEnvironment = { ...f.launchEnvironment, set(key: string, value: string) { if (++count === 2) throw Error("launch service failed"); f.values.set(key, value); } };
    expect(() => manageCopilotAppTelemetry("enable", { ...f, launchEnvironment })).toThrow(/incomplete|failed/i);
    expect(manageCopilotAppTelemetry("status", f).status).toBe("pending");
    expect(manageCopilotAppTelemetry("disable", f).status).toBe("disabled");
    expect(f.values.size).toBe(0);
  });
});
