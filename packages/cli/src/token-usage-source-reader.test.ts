import { closeSync, mkdtempSync, mkdirSync, openSync, rmSync, symlinkSync, truncateSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readNativeUsageSource } from "./token-usage-source-reader";
import { captureUsage } from "./token-usage-capture";
import { aggregateUsageEvents } from "./token-usage-aggregate";

const roots: string[] = [];
function root() { const value = mkdtempSync(join(tmpdir(), "prs-source-reader-")); roots.push(value); return value; }
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });

function span(sessionId: string, spanId = "span-1") {
  return { type: "span", data: { traceId: "trace-1", spanId, endTimeUnixNano: "1788516001000000000", attributes: {
    "gen_ai.operation.name": "chat", "gen_ai.conversation.id": sessionId, "gen_ai.response.id": "response-" + spanId,
    "gen_ai.response.model": "copilot-test", "gen_ai.usage.input_tokens": 10, "gen_ai.usage.cache_read.input_tokens": 0,
    "gen_ai.usage.cache_creation.input_tokens": 0, "gen_ai.usage.output_tokens": 2,
  } } };
}
const line = (value: unknown) => JSON.stringify(value) + "\n";

describe("native usage source reader", () => {
  it("streams a Copilot JSONL export larger than 64 MiB and retains only exact-session chat records", () => {
    const path = join(root(), "usage.jsonl"), fd = openSync(path, "w");
    try {
      writeSync(fd, line(span("session-1", "first")));
      const unrelated = line({ ...span("other", "other"), padding: "x".repeat(900) });
      const batch = Buffer.from(unrelated.repeat(1024));
      for (let written = 0; written < 66 * 1024 * 1024; written += batch.length) writeSync(fd, batch);
      writeSync(fd, line(span("session-1", "last")));
    } finally { closeSync(fd); }
    const result = readNativeUsageSource({ host: "copilot", sessionId: "session-1", sourcePath: path });
    expect(result.records).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    const evidence = captureUsage(result.records, { host: "copilot", sessionId: "session-1", runId: "large", since: "2026-09-04T00:00:00Z", capturedAt: "2026-09-05T00:00:00Z" });
    expect(aggregateUsageEvents(evidence.events).modelTokens.totalTokens).toBe(24);
  });

  it("rejects a Copilot JSONL record larger than 8 MiB", () => {
    const path = join(root(), "usage.jsonl");
    writeFileSync(path, JSON.stringify({ ...span("session-1"), padding: "x".repeat(8 * 1024 * 1024) }) + "\n");
    expect(() => readNativeUsageSource({ host: "copilot", sessionId: "session-1", sourcePath: path })).toThrow(/8 MiB/);
  });

  it("rejects more than 100,000 retained Copilot records", () => {
    const path = join(root(), "usage.jsonl"), fd = openSync(path, "w"), batch = Buffer.from(line(span("session-1")).repeat(1000));
    try { for (let count = 0; count < 101; count++) writeSync(fd, batch); } finally { closeSync(fd); }
    expect(() => readNativeUsageSource({ host: "copilot", sessionId: "session-1", sourcePath: path })).toThrow(/100,000/);
  });

  it("preserves malformed-complete and trailing-partial semantics", () => {
    const path = join(root(), "usage.jsonl");
    writeFileSync(path, line(span("session-1")) + "not json\n");
    expect(() => readNativeUsageSource({ host: "copilot", sessionId: "session-1", sourcePath: path })).toThrow(/Invalid JSON/);
    writeFileSync(path, line(span("session-1")) + '{"type":');
    const result = readNativeUsageSource({ host: "copilot", sessionId: "session-1", sourcePath: path });
    expect(result.records).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/Incomplete trailing JSON/);
  });

  it("rejects symlinks, directories, and generic sources over 64 MiB", () => {
    const base = root(), path = join(base, "source.jsonl"), link = join(base, "link.jsonl"), directory = join(base, "directory");
    writeFileSync(path, ""); symlinkSync(path, link); mkdirSync(directory);
    expect(() => readNativeUsageSource({ host: "copilot", sessionId: "session-1", sourcePath: link })).toThrow(/symlink/i);
    expect(() => readNativeUsageSource({ host: "copilot", sessionId: "session-1", sourcePath: directory })).toThrow(/regular file/i);
    truncateSync(path, 64 * 1024 * 1024 + 1);
    expect(() => readNativeUsageSource({ host: "codex", sessionId: "session-1", sourcePath: path })).toThrow(/64 MiB/);
  });
});
