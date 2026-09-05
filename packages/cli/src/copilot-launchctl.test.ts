import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manageCopilotAppTelemetry } from "./copilot-app-telemetry";

// Never invoke real launch services: exercise the production adapter against
// the command responses observed on macOS, with all files in a temporary home.
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const roots: string[] = [];
const exporter = "COPILOT_OTEL_FILE_EXPORTER_PATH";
function fixture(unsetStatus = 0, unsetOutput = "") {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "prs-launchctl-")));
  roots.push(home);
  const values = new Map<string, string>();
  vi.mocked(spawnSync).mockImplementation((file, args) => {
    if (file !== "/bin/launchctl") throw Error("Unexpected executable");
    const [command, key, value] = args as string[];
    let status = 0, stdout = "";
    if (command === "getenv") {
      status = values.has(key) ? 0 : unsetStatus;
      stdout = values.has(key) ? values.get(key)! + "\n" : unsetOutput;
    } else if (command === "setenv") values.set(key, value);
    else if (command === "unsetenv") values.delete(key);
    else if (command === "print") status = 113;
    else throw Error("Unexpected launch operation");
    return { pid: 1, output: [null, stdout, ""], stdout, stderr: "", status, signal: null };
  });
  return { home, platform: "darwin", values };
}
afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Copilot macOS launchctl boundary", () => {
  it.each([[0, ""], [0, "\n"], [1, ""]])("accepts unset settings returned with status %s and output %j", (status, output) => {
    const f = fixture(status, output);
    expect(manageCopilotAppTelemetry("enable", f).status).toBe("enabled");
    expect(f.values.get(exporter)).toBe(join(f.home, "Library/Application Support/prs/copilot-usage/usage.jsonl"));
    const state = JSON.parse(readFileSync(join(f.home, "Library/Application Support/prs/copilot-usage/state.json"), "utf8"));
    expect(Object.values(state.preexisting)).toEqual([false, false, false]);
    expect(manageCopilotAppTelemetry("disable", f).status).toBe("disabled");
    expect(f.values.size).toBe(0);
  });

  it.each(["/custom/usage.jsonl", " "])("preserves a nonempty conflicting setting %j", value => {
    const f = fixture(); f.values.set(exporter, value);
    expect(() => manageCopilotAppTelemetry("enable", f)).toThrow(/conflicts/);
    expect([...f.values]).toEqual([[exporter, value]]);
  });

  it("does not mistake a launch-service failure for an unset setting", () => {
    const f = fixture(2, "");
    expect(() => manageCopilotAppTelemetry("enable", f)).toThrow("Could not read macOS launch environment");
    expect(f.values.size).toBe(0);
  });
});
