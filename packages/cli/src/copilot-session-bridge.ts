import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";

export type CopilotCaptureBinding = {
  version: 1;
  sessionId: string;
  repoRoot: string;
  observedAt: string;
  purpose: "token-usage-capture";
};

export type CopilotBridgeOptions = { home?: string; now?: () => string };
type Resolution =
  | { status: "resolved"; sessionId: string }
  | { status: "missing" | "stale" | "ambiguous" | "invalid"; warning: string };

const MAX_AGE_MS = 60_000;
const MAX_BINDING_BYTES = 16 * 1024;

function bridgeRoot(home: string): string {
  return join(home, "Library/Application Support/prs/copilot-usage");
}

function assertSafePath(home: string, path: string): void {
  const parts = relative(home, path).split(sep);
  if (parts.includes("..")) throw new Error("Copilot bridge state must remain under the selected home");
  let current = home;
  for (const part of parts) {
    if (!part) continue;
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error("Refusing symlinked Copilot bridge state");
      if (current === path ? (!stat.isFile() && !stat.isDirectory()) : !stat.isDirectory()) throw new Error("Unsafe Copilot bridge state path");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function privateDirectory(path: string): boolean {
  const stat = lstatSync(path);
  return stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0;
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\0\r\n]/.test(value);
}

function parseToolCommand(payload: Record<string, unknown>): string | undefined {
  if (payload.toolName !== "bash" && payload.toolName !== "powershell") return undefined;
  let args = payload.toolArgs;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return undefined; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const command = (args as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
}

function isCaptureCommand(command: string): boolean {
  return command.split(/\s*(?:&&|\|\||;|\n)\s*/).some(segment => {
    const value = segment.trim();
    if (!/^prs\s+tool\s+token-usage\s+capture(?:\s|$)/.test(value)) return false;
    return /(?:^|\s)--host(?:=|\s+)copilot(?:\s|$)/.test(value)
      && /(?:^|\s)--output(?:=|\s+)\S+/.test(value)
      && /(?:^|\s)--json(?:\s|$)/.test(value);
  });
}

function repositoryRoot(cwd: string): string | undefined {
  try {
    const value = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return value ? realpathSync(value) : undefined;
  } catch {
    return undefined;
  }
}

function bindingName(binding: CopilotCaptureBinding): string {
  return createHash("sha256").update(binding.repoRoot).update("\0").update(binding.sessionId).digest("hex") + ".json";
}

function atomicBinding(path: string, binding: CopilotCaptureBinding): void {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify(binding, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function isBinding(value: unknown): value is CopilotCaptureBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(",") === "observedAt,purpose,repoRoot,sessionId,version"
    && row.version === 1
    && row.purpose === "token-usage-capture"
    && validSessionId(row.sessionId)
    && typeof row.repoRoot === "string"
    && typeof row.observedAt === "string"
    && Number.isFinite(Date.parse(row.observedAt));
}

export function recordCopilotCaptureBinding(payload: unknown, options: CopilotBridgeOptions = {}): { status: "recorded" | "ignored" } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { status: "ignored" };
  const row = payload as Record<string, unknown>, command = parseToolCommand(row);
  if (!validSessionId(row.sessionId) || typeof row.cwd !== "string" || typeof row.timestamp !== "number" || !Number.isFinite(row.timestamp) || !command || !isCaptureCommand(command)) return { status: "ignored" };
  const now = Date.parse((options.now ?? (() => new Date().toISOString()))());
  if (!Number.isFinite(now) || Math.abs(now - row.timestamp) > MAX_AGE_MS) return { status: "ignored" };
  const repoRoot = repositoryRoot(row.cwd);
  if (!repoRoot) return { status: "ignored" };

  const home = realpathSync(options.home ?? homedir()), root = bridgeRoot(home), bindings = join(root, "bindings");
  for (const path of [root, bindings]) assertSafePath(home, path);
  mkdirSync(bindings, { recursive: true, mode: 0o700 });
  if (!privateDirectory(root) || !privateDirectory(bindings)) throw new Error("Copilot bridge directories must be private (mode 0700)");
  const binding: CopilotCaptureBinding = { version: 1, sessionId: row.sessionId, repoRoot, observedAt: new Date(row.timestamp).toISOString(), purpose: "token-usage-capture" };
  const path = join(bindings, bindingName(binding)); assertSafePath(home, path);
  atomicBinding(path, binding);
  return { status: "recorded" };
}

export function resolveCopilotCaptureBinding(repoRoot: string, options: CopilotBridgeOptions = {}): Resolution {
  try {
    const home = realpathSync(options.home ?? homedir()), root = bridgeRoot(home), bindings = join(root, "bindings");
    for (const path of [root, bindings]) assertSafePath(home, path);
    if (!existsSync(bindings)) return { status: "missing", warning: "No fresh managed Copilot session binding is available for this repository." };
    if (!privateDirectory(root) || !privateDirectory(bindings)) throw new Error("state directories are not private");
    const canonicalRepo = realpathSync(repoRoot), matching: CopilotCaptureBinding[] = [];
    for (const name of readdirSync(bindings)) {
      const path = join(bindings, name); assertSafePath(home, path);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > MAX_BINDING_BYTES) throw new Error("unsafe binding file");
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isBinding(parsed)) throw new Error("invalid binding file");
      if (parsed.repoRoot === canonicalRepo) matching.push(parsed);
    }
    if (!matching.length) return { status: "missing", warning: "No managed Copilot session binding exists for this repository." };
    const now = Date.parse((options.now ?? (() => new Date().toISOString()))());
    if (!Number.isFinite(now)) throw new Error("invalid current time");
    const fresh = matching.filter(binding => Math.abs(now - Date.parse(binding.observedAt)) <= MAX_AGE_MS);
    if (!fresh.length) return { status: "stale", warning: "The managed Copilot session binding is older than 60 seconds; run capture again from the active session." };
    const sessions = [...new Set(fresh.map(binding => binding.sessionId))];
    if (sessions.length !== 1) return { status: "ambiguous", warning: "Multiple fresh Copilot sessions are bound to this repository; pass --session explicitly." };
    return { status: "resolved", sessionId: sessions[0] };
  } catch {
    return { status: "invalid", warning: "Managed Copilot session state is invalid or unsafe; pass --session explicitly and repair telemetry setup." };
  }
}
