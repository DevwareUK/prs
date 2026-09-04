import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

export type LaunchEnvironment = { get(key: string): string | undefined; set(key: string, value: string): void; unset(key: string): void; unload(label: string): void };
export type CopilotTelemetryOptions = { home?: string; platform?: string; launchEnvironment?: LaunchEnvironment };
export type CopilotTelemetryResult = { status: "enabled" | "disabled" | "pending" | "not-configured" | "unsupported" | "skipped"; message: string; outputFile?: string };
type State = { version: 1; status: "enabled" | "disabled" | "pending"; preexisting: Record<string, boolean> };
const PREFIX = "uk.devware.prs.copilot-usage";
function launch(args: string[]) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8", timeout: 10000 });
  if (result.error || result.signal) throw new Error("Could not access macOS launch services");
  return result;
}
function launchRequired(args: string[]): void {
  if (launch(args).status !== 0) throw new Error("macOS launch service operation failed: " + args[0]);
}
const systemEnvironment: LaunchEnvironment = {
  get(key) {
    const result = launch(["getenv", key]);
    if (result.status === 1) return undefined;
    if (result.status !== 0) throw new Error("Could not read macOS launch environment");
    return result.stdout.replace(/\n$/, "");
  },
  set(key, value) { launchRequired(["setenv", key, value]); },
  unset(key) { launchRequired(["unsetenv", key]); },
  unload(label) {
    const target = "gui/" + process.getuid!() + "/" + label, result = launch(["print", target]);
    if (result.status === 113 || result.status === 3) return; // No registered job in this login.
    if (result.status !== 0) throw new Error("Could not inspect managed macOS login job");
    launchRequired(["bootout", target]);
  },
};
/** Only fixed descendants of the selected home are writable; do not follow links. */
function safePath(home: string, path: string): void {
  const parts = relative(home, path).split(sep);
  if (parts.includes("..")) throw new Error("Telemetry configuration must remain under the selected home");
  let current = home;
  for (const part of parts) {
    current = join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (stat.isSymbolicLink()) throw new Error("Refusing symlinked telemetry configuration");
    if (current === path ? (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1) : !stat.isDirectory()) throw new Error("Unsafe telemetry configuration path");
  }
}
function atomicJson(path: string, state: State): void {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function xml(value: string): string {
  if ([...value].some(c => c.charCodeAt(0) < 32)) throw new Error("Unsupported control character in telemetry path");
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}
export function manageCopilotAppTelemetry(action: "enable" | "disable" | "status", options: CopilotTelemetryOptions = {}): CopilotTelemetryResult {
  if ((options.platform ?? process.platform) !== "darwin") return { status: "unsupported", message: "Automatic Copilot app telemetry setup currently supports macOS only; skills are still available." };
  const home = realpathSync(options.home ?? homedir()), root = join(home, "Library/Application Support/prs/copilot-usage");
  const stateFile = join(root, "state.json"), outputFile = join(root, "usage.jsonl"), agents = join(home, "Library/LaunchAgents");
  const values: Record<string, string> = { COPILOT_OTEL_FILE_EXPORTER_PATH: outputFile, COPILOT_OTEL_EXPORTER_TYPE: "file", OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "false" };
  const jobs = Object.entries(values).map(([key, value], index) => {
    const label = PREFIX + "." + index;
    const body = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>' + label + '</string><key>ProgramArguments</key><array>' + ["/bin/launchctl", "setenv", key, value].map(v => "<string>" + xml(v) + "</string>").join("") + '</array><key>RunAtLoad</key><true/></dict></plist>\n';
    return { label, path: join(agents, label + ".plist"), body };
  });
  for (const path of [root, stateFile, outputFile, agents, ...jobs.map(j => j.path)]) safePath(home, path);
  const readState = (): State | undefined => {
    if (!existsSync(stateFile)) return undefined;
    const value = JSON.parse(readFileSync(stateFile, "utf8")) as State;
    if (value.version !== 1 || !["enabled", "disabled", "pending"].includes(value.status) || !value.preexisting || Object.keys(value.preexisting).length !== 3 || Object.keys(values).some(k => typeof value.preexisting[k] !== "boolean")) throw new Error("Invalid managed telemetry state; preserve it for inspection");
    return value;
  };
  const statusResult = (state?: State): CopilotTelemetryResult => ({ status: state?.status ?? "not-configured", outputFile,
    message: state?.status === "enabled" ? "Copilot app usage export is configured. Fully quit and reopen Copilot normally. Live export/session attribution is not yet verified."
      : state?.status === "pending" ? "Copilot telemetry setup is incomplete; rerun with --copilot-telemetry enable or disable."
        : "Copilot app usage export is not enabled by PRS." });
  if (action === "status") {
    const state = readState();
    if (state?.status === "enabled" && jobs.some(job => !existsSync(job.path) || readFileSync(job.path, "utf8") !== job.body)) return statusResult({ ...state, status: "pending" });
    return statusResult(state);
  }
  if (action === "disable" && !readState()) return { status: "not-configured", message: "No PRS-managed telemetry configuration to disable." };
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if ((lstatSync(root).mode & 0o077) !== 0) throw new Error("Telemetry directory must be private (mode 0700)");
  const lock = join(root, "setup.lock"); safePath(home, lock);
  writeFileSync(lock, "setup", { flag: "wx", mode: 0o600 });
  try {
    const prior = readState(), env = options.launchEnvironment ?? systemEnvironment;
    for (const job of jobs) {
      if (existsSync(job.path) && (!prior || readFileSync(job.path, "utf8") !== job.body)) throw new Error("Managed login job is custom or changed; refusing to replace or remove it");
    }
    if (action === "disable") {
      if (prior!.status === "disabled") return { status: "disabled", outputFile, message: "Copilot app telemetry is already disabled; usage logs were retained." };
      for (const job of jobs) env.unload(job.label);
      const preserved: string[] = [];
      for (const [key, value] of Object.entries(values)) {
        const current = env.get(key);
        if (!prior!.preexisting[key] && current === value) env.unset(key);
        else if (current !== undefined) preserved.push(key);
      }
      for (const job of jobs) if (existsSync(job.path)) unlinkSync(job.path);
      atomicJson(stateFile, { ...prior!, status: "disabled" });
      return { status: "disabled", outputFile, message: "Removed PRS's three login jobs; retained usage logs and pre-existing or subsequently changed settings. Restart Copilot. " + (preserved.length ? "Preserved keys: " + preserved.join(", ") : "") };
    }
    const before = Object.fromEntries(Object.keys(values).map(key => [key, env.get(key)]));
    if (Object.entries(values).some(([key, value]) => before[key] !== undefined && before[key] !== value)) throw new Error("Existing Copilot launch environment conflicts with PRS; no settings were replaced");
    if (existsSync(outputFile) && (!lstatSync(outputFile).isFile() || (lstatSync(outputFile).mode & 0o077) !== 0)) throw new Error("Existing usage output must be a private regular file");
    const state: State = { version: 1, status: "pending", preexisting: prior && prior.status !== "disabled" ? prior.preexisting : Object.fromEntries(Object.keys(values).map(key => [key, before[key] !== undefined])) };
    atomicJson(stateFile, state); // Keep a recovery record before any launch-environment mutation.
    mkdirSync(agents, { recursive: true });
    if (!existsSync(outputFile)) writeFileSync(outputFile, "", { flag: "wx", mode: 0o600 });
    for (const job of jobs) if (!existsSync(job.path)) writeFileSync(job.path, job.body, { flag: "wx", mode: 0o600 });
    try {
      // The plists apply on future logins; apply directly now without launching an app.
      for (const [key, value] of Object.entries(values)) env.set(key, value);
      for (const [key, value] of Object.entries(values)) if (env.get(key) !== value) throw new Error("Launch environment did not retain the requested setting");
    } catch {
      throw new Error("Copilot telemetry activation incomplete. Rerun with --copilot-telemetry enable or disable; usage logs were preserved.");
    }
    state.status = "enabled"; atomicJson(stateFile, state);
    return statusResult(state);
  } finally { unlinkSync(lock); }
}
