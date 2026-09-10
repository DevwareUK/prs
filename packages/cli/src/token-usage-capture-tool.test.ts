import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureTokenUsageTool } from "./token-usage-capture-tool";

const roots: string[] = [];
const since = "2026-09-04T10:00:00Z", now = "2026-09-04T10:02:00Z";
const header = { type: "session_meta", payload: { id: "s1", timestamp: since } };
const context = { type: "turn_context", payload: { turn_id: "t1", model: "gpt-test" } };
const record = (id = "r1", at = "2026-09-04T10:01:00Z") => ({ type: "token_usage_record", timestamp: at, payload: { thread_id: "s1", turn_id: "t1", response_id: id,
  usage: { input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 } } });
const jsonl = (...rows: unknown[]) => rows.map(row => JSON.stringify(row)).join("\n") + "\n";
function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "prs-capture-")); roots.push(repoRoot);
  mkdirSync(join(repoRoot, ".prs/runs/run-1"), { recursive: true });
  const sourcePath = join(repoRoot, "source.jsonl"), outputFilePath = join(repoRoot, ".prs/runs/run-1/usage-evidence.json");
  writeFileSync(sourcePath, jsonl(header, context, record()));
  return { repoRoot, sourcePath, outputFilePath, host: "codex" as const, sessionId: "s1", since, now: () => now, env: {} };
}
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { force: true, recursive: true }); });

describe("native capture local IO", () => {
  it("preserves manual pricing enrichment when native capture has no model label", () => {
    const f = fixture();
    writeFileSync(f.sourcePath, jsonl(header, record()));
    captureTokenUsageTool(f);
    const prior = JSON.parse(readFileSync(f.outputFilePath, "utf8"));
    const manual = {
      id: "manual:unknown-native:default", provider: "manual", model: "resolved-model", currency: "USD",
      effectiveAt: "2026-09-01T00:00:00Z", retrievedAt: "2026-09-04T00:00:00Z",
      sourceUrl: "https://example.com/manual-rate", contextTier: { name: "default", minTokens: 0 },
      reasoningBilling: "included-in-output",
      perMillion: { uncachedInputTokens: 1, cachedInputTokens: 0.1, cacheWriteTokens: 0, outputTokens: 2 },
    };
    prior.events[0].model = { provider: manual.provider, name: manual.model };
    prior.events[0].context = { tier: "default", tokens: 100 };
    prior.events[0].rateCardId = manual.id;
    prior.rateCards = [manual];
    writeFileSync(f.outputFilePath, JSON.stringify(prior, null, 2) + "\n");
    captureTokenUsageTool(f);
    const next = JSON.parse(readFileSync(f.outputFilePath, "utf8"));
    expect(next.events[0]).toMatchObject({ model: prior.events[0].model, context: prior.events[0].context, rateCardId: manual.id });
    expect(next.rateCards).toEqual([manual]);
  });

  it("keeps historical event pricing selections and unreferenced manual cards on recapture", () => {
    const f = fixture();
    const currentSince = "2026-09-08T10:00:00Z", currentNow = "2026-09-08T10:02:00Z";
    const currentHeader = { ...header, payload: { ...header.payload, timestamp: currentSince } };
    const currentContext = { ...context, payload: { ...context.payload, model: "gpt-5.6-sol" } };
    const currentRecord = (id: string, at: string) => ({ ...record(id, at), timestamp: at });
    writeFileSync(f.sourcePath, jsonl(currentHeader, currentContext, currentRecord("r1", "2026-09-08T10:01:00Z")));
    captureTokenUsageTool({ ...f, since: currentSince, now: () => currentNow });

    const prior = JSON.parse(readFileSync(f.outputFilePath, "utf8"));
    const manual = {
      ...prior.rateCards[0], id: "manual:gpt-5.6-sol:default",
      sourceUrl: "https://example.com/manual-rate", retrievedAt: "2026-09-08T09:00:00Z",
    };
    const unreferenced = {
      ...manual, id: "manual:future-model:default", model: "future-model",
    };
    prior.events[0].rateCardId = manual.id;
    prior.events[0].context = { tier: "default", tokens: 100 };
    prior.rateCards = [manual, unreferenced];
    writeFileSync(f.outputFilePath, JSON.stringify(prior, null, 2) + "\n");
    const stableSelection = JSON.stringify({
      model: prior.events[0].model, context: prior.events[0].context,
      rateCardId: prior.events[0].rateCardId, rateCard: manual,
    });

    writeFileSync(f.sourcePath, jsonl(currentHeader, currentContext,
      currentRecord("r1", "2026-09-08T10:01:00Z"), currentRecord("r2", "2026-09-08T10:01:30Z")));
    captureTokenUsageTool({ ...f, sessionId: undefined, sourcePath: undefined, since: undefined, now: () => "2026-09-08T10:03:00Z" });
    const next = JSON.parse(readFileSync(f.outputFilePath, "utf8"));
    expect(JSON.stringify({
      model: next.events[0].model, context: next.events[0].context,
      rateCardId: next.events[0].rateCardId,
      rateCard: next.rateCards.find((rate: { id: string }) => rate.id === manual.id),
    })).toBe(stableSelection);
    expect(next.events[1].rateCardId).toMatch(/^openai:gpt-5\.6-sol:/);
    expect(next.rateCards.map((rate: { id: string }) => rate.id)).toEqual(expect.arrayContaining([
      manual.id, unreferenced.id, next.events[1].rateCardId,
    ]));
  });

  it("does not replace evidence when combined totals overflow", () => {
    const f = fixture(); captureTokenUsageTool(f);
    const before = readFileSync(f.outputFilePath, "utf8");
    const huge = record("huge");
    huge.payload.usage = { input_tokens: Number.MAX_SAFE_INTEGER, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: Number.MAX_SAFE_INTEGER };
    writeFileSync(f.sourcePath, jsonl(header, context, record(), huge));
    expect(() => captureTokenUsageTool(f)).toThrow();
    expect(readFileSync(f.outputFilePath, "utf8")).toBe(before);
  });
  it("keeps existing evidence when counters are corrected across calls or a writer lock exists", () => {
    const f = fixture(); captureTokenUsageTool(f);
    const before = readFileSync(f.outputFilePath, "utf8");
    const changed = record(); changed.payload.usage.output_tokens = 11; changed.payload.usage.total_tokens = 111;
    writeFileSync(f.sourcePath, jsonl(header, context, changed));
    expect(() => captureTokenUsageTool(f)).toThrow(/conflict/i);
    expect(readFileSync(f.outputFilePath, "utf8")).toBe(before);
    writeFileSync(f.outputFilePath + ".lock", "other writer");
    expect(() => captureTokenUsageTool(f)).toThrow();
    expect(readFileSync(f.outputFilePath + ".lock", "utf8")).toBe("other writer");
    expect(readFileSync(f.outputFilePath, "utf8")).toBe(before);
  });
  it("writes renderable evidence, retains source and cutoff on recapture, and adds only new responses", () => {
    const f = fixture();
    expect(captureTokenUsageTool(f)).toMatchObject({ status: "captured", modelTokens: { totalTokens: 110 } });
    writeFileSync(f.sourcePath, jsonl(header, context, record(), record(), record("r2")));
    const result = captureTokenUsageTool({ ...f, sessionId: undefined, sourcePath: undefined, since: undefined });
    expect(result.modelTokens.totalTokens).toBe(220);
    const evidence = JSON.parse(readFileSync(f.outputFilePath, "utf8"));
    expect(evidence.events).toHaveLength(2);
    expect(evidence.capture.since).toBe("2026-09-04T10:00:00.000Z");
    expect(evidence.capture.sourcePath).toBe(f.sourcePath);
    expect(JSON.stringify(result)).not.toContain("source.jsonl");
  });
  it("defaults first capture to now rather than importing the entire reused session", () => {
    const f = fixture();
    const first = captureTokenUsageTool({ ...f, since: undefined });
    expect(first.status).toBe("unavailable");
    writeFileSync(f.sourcePath, jsonl(header, context, record(), record("r2", "2026-09-04T10:03:00Z")));
    expect(captureTokenUsageTool({ ...f, since: undefined, now: () => "2026-09-04T10:04:00Z" }).modelTokens.totalTokens).toBe(110);
  });
  it("preserves existing evidence on binding changes, conflicts, malformed files and source truncation", () => {
    const f = fixture(); captureTokenUsageTool(f);
    const before = readFileSync(f.outputFilePath, "utf8");
    for (const patch of [{ sessionId: "other" }, { since: "2026-09-04T09:00:00Z" }, { sourcePath: join(f.repoRoot, "another.jsonl") }, { host: "copilot" as const }]) {
      expect(() => captureTokenUsageTool({ ...f, ...patch })).toThrow(/binding/i);
      expect(readFileSync(f.outputFilePath, "utf8")).toBe(before);
    }
    writeFileSync(f.sourcePath, jsonl(header, context) + "not json\n");
    expect(() => captureTokenUsageTool(f)).toThrow(/JSON/i);
    expect(readFileSync(f.outputFilePath, "utf8")).toBe(before);
    writeFileSync(f.sourcePath, jsonl(header, context));
    expect(() => captureTokenUsageTool(f)).toThrow(/lost|truncat/i);
    expect(readFileSync(f.outputFilePath, "utf8")).toBe(before);
  });
  it("keeps a partial trailing write out of counts and reports capture partial", () => {
    const f = fixture(); writeFileSync(f.sourcePath, jsonl(header, context, record()) + '{"type":');
    const result = captureTokenUsageTool(f);
    expect(result.modelTokens.totalTokens).toBe(110);
    expect(result.status).toBe("partial");
    expect(result.capture.warnings.join(" ")).toMatch(/incomplete/i);
  });
  it("resolves Codex by exact session filename only, never by newest file", () => {
    const f = fixture(), codexHome = join(f.repoRoot, "codex");
    mkdirSync(join(codexHome, "sessions/2026/09/04"), { recursive: true });
    writeFileSync(join(codexHome, "sessions/2026/09/04/rollout-date-s1.jsonl"), jsonl(header, context, record()));
    writeFileSync(join(codexHome, "sessions/2026/09/04/rollout-newer-other.jsonl"), "NEVER READ THIS");
    expect(captureTokenUsageTool({ ...f, sourcePath: undefined, sessionId: undefined, env: { CODEX_HOME: codexHome, CODEX_THREAD_ID: "s1" } }).modelTokens.totalTokens).toBe(110);
  });
  it("reports actionable missing setup without fetching credentials or launching anything", () => {
    const f = fixture();
    const result = captureTokenUsageTool({ ...f, host: "copilot", sourcePath: undefined, sessionId: undefined, since: undefined });
    expect(result.status).toBe("unavailable");
    expect(result.capture.warnings.join(" ")).toMatch(/PRS_USAGE_SESSION_ID/);
    expect(result.capture.warnings.join(" ")).toMatch(/COPILOT_OTEL_FILE_EXPORTER_PATH/);
  });
  it("rejects output traversal, symlink escape, source aliases and source symlinks", () => {
    const f = fixture();
    expect(() => captureTokenUsageTool({ ...f, outputFilePath: "outside.json" })).toThrow();
    symlinkSync(f.sourcePath, f.outputFilePath);
    expect(() => captureTokenUsageTool(f)).toThrow();
    rmSync(f.outputFilePath); linkSync(f.sourcePath, f.outputFilePath);
    expect(() => captureTokenUsageTool(f)).toThrow();
    rmSync(f.outputFilePath); const link = join(f.repoRoot, "linked.jsonl"); symlinkSync(f.sourcePath, link);
    expect(() => captureTokenUsageTool({ ...f, sourcePath: link })).toThrow(/symlink/i);
  });
});
