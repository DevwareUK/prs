import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordCopilotCaptureBinding, resolveCopilotCaptureBinding } from "./copilot-session-bridge";

const roots: string[] = [];
const at = "2026-09-17T12:23:49.000Z";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "prs-copilot-bridge-"));
  roots.push(root);
  const home = join(root, "home"), repoPath = join(root, "repo");
  mkdirSync(home); mkdirSync(repoPath);
  execFileSync("git", ["init", "-q", repoPath]);
  const repoRoot = realpathSync(repoPath);
  const payload = {
    sessionId: "copilot-session-1",
    timestamp: Date.parse(at),
    cwd: repoRoot,
    toolName: "bash",
    toolArgs: { command: "prs tool token-usage capture --host copilot --output .prs/runs/run/usage-evidence.json --json && prs tool token-usage render --input .prs/runs/run/usage-evidence.json --output .prs/runs/run/token-usage.md --json" },
  };
  return { home, repoRoot, payload, now: () => at };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("managed Copilot capture session bridge", () => {
  it("records only a minimal exact binding for the intended capture command", () => {
    const f = fixture();
    expect(recordCopilotCaptureBinding(f.payload, f)).toEqual({ status: "recorded" });
    expect(resolveCopilotCaptureBinding(f.repoRoot, f)).toEqual({ status: "resolved", sessionId: "copilot-session-1" });

    const bindings = join(f.home, "Library/Application Support/prs/copilot-usage/bindings");
    const file = join(bindings, readdirSync(bindings)[0]);
    expect(statSync(bindings).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      version: 1,
      sessionId: "copilot-session-1",
      repoRoot: f.repoRoot,
      observedAt: at,
      purpose: "token-usage-capture",
    });
    expect(readFileSync(file, "utf8")).not.toContain("toolArgs");
    expect(readFileSync(file, "utf8")).not.toContain("token-usage render");
  });

  it.each([
    ["malformed payload", null],
    ["non-shell tool", { toolName: "edit" }],
    ["unrelated command", { toolArgs: { command: "prs tool token-usage render --json" } }],
    ["wrong host", { toolArgs: { command: "prs tool token-usage capture --host codex --output x --json" } }],
  ])("ignores %s", (_name, patch) => {
    const f = fixture();
    const payload = patch === null ? null : { ...f.payload, ...patch };
    expect(recordCopilotCaptureBinding(payload, f)).toEqual({ status: "ignored" });
    expect(resolveCopilotCaptureBinding(f.repoRoot, f).status).toBe("missing");
  });

  it("ignores working directories outside a Git repository", () => {
    const f = fixture(), cwd = join(f.home, "plain"); mkdirSync(cwd);
    expect(recordCopilotCaptureBinding({ ...f.payload, cwd }, f)).toEqual({ status: "ignored" });
  });

  it("reports stale and repository-mismatched bindings without guessing", () => {
    const f = fixture(); recordCopilotCaptureBinding(f.payload, f);
    expect(resolveCopilotCaptureBinding(f.repoRoot, { ...f, now: () => "2026-09-17T12:24:50.000Z" })).toMatchObject({ status: "stale" });
    const other = join(dirname(f.repoRoot), "other"); mkdirSync(other); execFileSync("git", ["init", "-q", other]);
    expect(resolveCopilotCaptureBinding(other, f)).toMatchObject({ status: "missing" });
  });

  it("reports two fresh session identities as ambiguous", () => {
    const f = fixture();
    recordCopilotCaptureBinding(f.payload, f);
    recordCopilotCaptureBinding({ ...f.payload, sessionId: "copilot-session-2" }, f);
    expect(resolveCopilotCaptureBinding(f.repoRoot, f)).toMatchObject({ status: "ambiguous" });
  });

  it("rejects symlinked bridge state", () => {
    const f = fixture();
    const root = join(f.home, "Library/Application Support/prs/copilot-usage");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const elsewhere = join(dirname(f.home), "elsewhere"); mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(root, "bindings"));
    expect(() => recordCopilotCaptureBinding(f.payload, f)).toThrow(/symlink/i);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("reports malformed or publicly readable state as invalid", () => {
    const f = fixture(); recordCopilotCaptureBinding(f.payload, f);
    const bindings = join(f.home, "Library/Application Support/prs/copilot-usage/bindings");
    const file = join(bindings, readdirSync(bindings)[0]);
    chmodSync(file, 0o644);
    expect(resolveCopilotCaptureBinding(f.repoRoot, f)).toMatchObject({ status: "invalid" });
    expect(existsSync(file)).toBe(true);
  });
});
