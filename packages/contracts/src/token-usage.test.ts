import { describe, expect, it } from "vitest";
import { UsageEvidence, UsageEvent, UsageRateCard } from "./token-usage";

const event = () => ({
  eventId: "e1", host: "codex", adapter: { name: "codex-session", version: 1 },
  source: { id: "synthetic", kind: "fixture" }, counterScopeId: "thread",
  measurementKind: "cumulative-snapshot", observedAt: "2026-09-03T10:00:00Z",
  workflow: { runId: "run-42", phase: "implement", phaseAttemptId: "implement:1" },
  status: "tracked", unit: "model-tokens",
  coverage: { id: "work", representationId: "session", disjoint: true },
  tokenSemantics: { reasoning: "included-in-output" },
  usage: { uncachedInputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 20 },
});
const evidence = (events: unknown[]) => ({ version: 1, kind: "usage-evidence", runId: "run-42", events });
const rate = () => ({
  id: "synthetic-rate", provider: "example", model: "example-model", currency: "USD",
  effectiveAt: "2026-09-01T00:00:00Z", retrievedAt: "2026-09-03T00:00:00Z",
  sourceUrl: "https://example.com/rates", contextTier: { name: "default", minTokens: 0 },
  reasoningBilling: "included-in-output",
  perMillion: { uncachedInputTokens: 2, cachedInputTokens: 0.5, cacheWriteTokens: 3, outputTokens: 10 },
});

describe("usage evidence contract", () => {
  it("accepts scoped tokens, cumulative tokens and credit-only observations from all hosts", () => {
    expect(UsageEvidence.parse(evidence([event()])).version).toBe(1);
    for (const host of ["claude-code", "copilot"]) {
      const base: Record<string, unknown> = event(); delete base.usage; delete base.tokenSemantics;
      expect(UsageEvent.parse({ ...base, host, unit: "credits", value: { amount: 2.5, unit: "github-ai-credit" } }).value?.amount).toBe(2.5);
    }
  });
  it.each([-1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid token counter %s", value => {
    expect(() => UsageEvent.parse({ ...event(), usage: { outputTokens: value } })).toThrow();
  });
  it.each(["counterScopeId", "source", "adapter", "coverage", "workflow"])("requires %s", key => {
    const value: Record<string, unknown> = event(); delete value[key];
    expect(() => UsageEvent.parse(value)).toThrow();
  });
  it("requires run agreement and rejects conflicting replays but permits identical replays", () => {
    expect(() => UsageEvidence.parse(evidence([event(), event()]))).not.toThrow();
    expect(() => UsageEvidence.parse(evidence([event(), { ...event(), usage: { outputTokens: 5 } }]))).toThrow();
    expect(() => UsageEvidence.parse({ ...evidence([event()]), runId: "other" })).toThrow();
  });
  it("accepts unsorted timestamps and rejects reversed intervals and future baselines", () => {
    const second = { ...event(), eventId: "e2", observedAt: "2026-09-03T11:00:00Z" };
    expect(() => UsageEvidence.parse(evidence([second, event()]))).not.toThrow();
    expect(() => UsageEvent.parse({ ...event(), interval: { start: second.observedAt, end: event().observedAt } })).toThrow();
    expect(() => UsageEvent.parse({ ...event(), baseline: { observedAt: second.observedAt, usage: event().usage } })).toThrow();
    expect(() => UsageEvidence.parse(evidence([event(), { ...second, observedAt: event().observedAt, usage: { outputTokens: 5 } }]))).toThrow();
  });
  it("keeps unavailable unknown and forbids mixed unit payloads", () => {
    const base: Record<string, unknown> = event(); delete base.usage; delete base.tokenSemantics;
    expect(UsageEvent.parse({ ...base, status: "unavailable", reason: "No native evidence" }).usage).toBeUndefined();
    expect(() => UsageEvent.parse({ ...base, status: "unavailable" })).toThrow();
    expect(() => UsageEvent.parse({ ...event(), status: "unavailable", reason: "missing" })).toThrow();
    expect(() => UsageEvent.parse({ ...event(), unit: "host-counter", value: { amount: 4, unit: "goal-tokens" } })).toThrow();
  });
  it("rejects included reasoning larger than output and inconsistent provider totals", () => {
    expect(() => UsageEvent.parse({ ...event(), usage: { outputTokens: 2, reasoningTokens: 3 } })).toThrow();
    expect(() => UsageEvent.parse({ ...event(), usage: { ...event().usage, providerTotalTokens: 1 } })).toThrow();
  });
  it("rejects native/normalized ambiguity and unsupported native versions", () => {
    const native = { version: 1, format: "codex-session", inputIncludesCacheRead: true, inputIncludesCacheWrite: false, reasoning: "included-in-output", values: { input_tokens: 100 } };
    expect(() => UsageEvent.parse({ ...event(), native })).toThrow();
    const base: Record<string, unknown> = event(); delete base.usage;
    expect(() => UsageEvent.parse({ ...base, native: { ...native, version: 2 } })).toThrow();
  });
  it("rejects cyclic parent coverage", () => {
    const a = { ...event(), coverage: { id: "work", representationId: "a", parentRepresentationId: "b" } };
    const b = { ...event(), eventId: "e2", counterScopeId: "child", coverage: { id: "work", representationId: "b", parentRepresentationId: "a" } };
    expect(() => UsageEvidence.parse(evidence([a, b]))).toThrow();
  });
  it.each(["sourceUrl", "effectiveAt", "retrievedAt", "currency", "contextTier", "model"])("rejects a rate without %s", key => {
    const value: Record<string, unknown> = rate(); delete value[key];
    expect(() => UsageRateCard.parse(value)).toThrow();
  });
  it("accepts sourced rates and rejects backwards promotion windows", () => {
    expect(UsageRateCard.parse(rate()).perMillion.outputTokens).toBe(10);
    expect(() => UsageRateCard.parse({ ...rate(), expiresAt: "2026-08-01T00:00:00Z" })).toThrow();
  });
});
