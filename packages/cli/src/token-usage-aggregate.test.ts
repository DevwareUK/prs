import { describe, expect, it } from "vitest";
import { makeEvent, makeEvidence, makeUsageFixture, tokens, zeroTokens } from "./token-usage.test-support";
import { normalizeUsageEvidence } from "./token-usage-normalize";
import { aggregateUsageEvents } from "./token-usage-aggregate";
import type { UsageEvent } from "@prs/contracts";

const aggregate = (events: UsageEvent[]) => aggregateUsageEvents(normalizeUsageEvidence(makeEvidence(events)).events);
const second = (overrides: Partial<UsageEvent> = {}) => makeEvent({ eventId: "e2", observedAt: "2026-09-03T10:02:00Z", baseline: undefined, usage: tokens(160), ...overrides });
describe("non-overlapping usage aggregation", () => {
  it("does not substitute a child when the authoritative parent is unavailable", () => {
    const coverage = { id: "work", authoritativeRepresentationId: "parent", disjoint: true };
    const result = aggregate([
      makeEvent({ status: "unavailable", reason: "No parent capture", usage: undefined, baseline: undefined,
        coverage: { ...coverage, representationId: "parent" } }),
      second({ counterScopeId: "child", baseline: { observedAt: "2026-09-03T10:00:00Z", usage: zeroTokens() }, usage: tokens(40),
        coverage: { ...coverage, representationId: "child", parentRepresentationId: "parent" } }),
    ]);
    expect(result.modelTokens.totalTokens).toBeNull();
  });
  it("keeps unrelated units usable without asserting their counters are disjoint", () => {
    const counter = makeEvent({ eventId: "host-counter", unit: "host-counter", measurementKind: "host-counter", usage: undefined, baseline: undefined,
      value: { amount: 250, unit: "goal-tokens" }, coverage: { id: "host-ui", representationId: "host-ui" } });
    const result = aggregate([makeEvent(), counter]);
    expect(result.modelTokens.totalTokens).toBe(100);
    expect(result.hostCounters[0].amount).toBe(250);
  });
  it("rejects a derived included-reasoning delta larger than its output delta", () => {
    const first = makeEvent({ usage: { ...zeroTokens(), outputTokens: 100, reasoningTokens: 0 }, baseline: undefined });
    const next = second({ usage: { ...zeroTokens(), outputTokens: 110, reasoningTokens: 100 } });
    expect(() => aggregate([first, next])).toThrow(/reasoning/i);
  });
  it("differences implementation/review snapshots and remains replay/order independent", () => {
    const events = makeUsageFixture("baseline-review").events;
    const result = aggregate(events);
    expect(result.modelTokens.totalTokens).toBe(160);
    expect(aggregate([...events, ...events])).toEqual(result);
    expect(aggregate(events.slice().reverse())).toEqual(result);
    expect(result.contributions[1].phase).toBe("shared/unattributed");
  });
  it("excludes the baseline-free first state but counts later differences", () => {
    const result = aggregate([makeEvent({ baseline: undefined }), second()]);
    expect(result.modelTokens.totalTokens).toBe(60);
    expect(result.modelTokens.status).toBe("partial");
    expect(result.warnings.map(w => w.code)).toContain("missing-baseline");
  });
  it.each([["zero", 120], [undefined, 100]] as const)("handles a reset with baseline %s", (baseline, want) => {
    const result = aggregate([makeEvent(), second({ usage: tokens(20), reset: { segmentId: "reset-1", at: "2026-09-03T10:01:30Z", baseline } })]);
    expect(result.modelTokens.totalTokens).toBe(want);
  });
  it("does not count an undeclared reset gap and resumes from the new observation", () => {
    const result = aggregate([makeEvent(), second({ usage: tokens(20) }),
      second({ eventId: "e3", observedAt: "2026-09-03T10:03:00Z", usage: tokens(35) })]);
    expect(result.modelTokens.totalTokens).toBe(115);
    expect(result.warnings.map(w => w.code)).toContain("counter-decrease");
  });
  it("invalidates the whole transition when a component decreases even if totals rise", () => {
    const result = aggregate([makeEvent({ usage: { ...zeroTokens(), uncachedInputTokens: 100, outputTokens: 20 } }),
      second({ usage: { ...zeroTokens(), uncachedInputTokens: 90, outputTokens: 100 } })]);
    expect(result.modelTokens.totalTokens).toBe(120);
  });
  it("does not invent a delta for a newly appearing class", () => {
    const result = aggregate([makeEvent({ usage: { outputTokens: 10 }, baseline: undefined }),
      second({ usage: { ...zeroTokens(), uncachedInputTokens: 90, outputTokens: 20 } })]);
    expect(result.modelTokens.knownTokens.outputTokens).toBe(10);
    expect(result.modelTokens.knownTokens.uncachedInputTokens).toBeNull();
    expect(result.modelTokens.status).toBe("partial");
  });
  it("uses parent authority instead of adding a nested child", () => {
    const result = aggregate([
      makeEvent({ usage: tokens(160), coverage: { id: "work", representationId: "parent", authoritativeRepresentationId: "parent", disjoint: true } }),
      second({ counterScopeId: "child", baseline: { observedAt: "2026-09-03T10:00:00Z", usage: zeroTokens() }, usage: tokens(40),
        coverage: { id: "work", representationId: "child", parentRepresentationId: "parent", authoritativeRepresentationId: "parent", disjoint: true } }),
    ]);
    expect(result.modelTokens.totalTokens).toBe(160);
    expect(result.contributions.filter(c => c.included)).toHaveLength(1);
  });
  it("counts only the authoritative snapshot when request evidence covers the same work", () => {
    const coverage = { id: "work", disjoint: true, authoritativeRepresentationId: "snapshot" };
    const result = aggregate([
      makeEvent({ usage: tokens(160), coverage: { ...coverage, representationId: "snapshot" } }),
      second({ counterScopeId: "requests", measurementKind: "provider-request", requestId: "r1", requestsDisjoint: true,
        interval: { start: "2026-09-03T10:00:00Z", end: "2026-09-03T10:01:00Z" }, usage: tokens(160),
        coverage: { ...coverage, representationId: "requests" } }),
    ]);
    expect(result.modelTokens.totalTokens).toBe(160);
  });
  it("adds explicitly disjoint scopes but excludes unresolved groups", () => {
    const other = second({ counterScopeId: "other", usage: tokens(60), baseline: { observedAt: "2026-09-03T10:00:00Z", usage: zeroTokens() },
      coverage: { id: "independent", representationId: "other", disjoint: true } });
    expect(aggregate([makeEvent(), other]).modelTokens.totalTokens).toBe(160);
    const unresolved = { ...other, coverage: { ...other.coverage, disjoint: false } };
    expect(aggregate([makeEvent(), unresolved]).modelTokens.totalTokens).toBeNull();
  });
  it("treats adjacent intervals as disjoint and rejects overlapped additive coverage", () => {
    const first = makeEvent({ measurementKind: "scoped-delta", baseline: undefined,
      interval: { start: "2026-09-03T10:00:00Z", end: "2026-09-03T10:01:00Z" } });
    const next = second({ measurementKind: "scoped-delta", usage: tokens(60),
      interval: { start: "2026-09-03T10:01:00Z", end: "2026-09-03T10:02:00Z" } });
    expect(aggregate([first, next]).modelTokens.totalTokens).toBe(160);
    expect(aggregate([first, { ...next, interval: { ...next.interval!, start: "2026-09-03T10:00:30Z" } }]).modelTokens.totalTokens).toBeNull();
  });
  it("adds declared independent concurrent requests and deduplicates stable request IDs", () => {
    const first = makeEvent({ measurementKind: "provider-request", baseline: undefined, requestId: "r1", requestsDisjoint: true,
      interval: { start: "2026-09-03T10:00:00Z", end: "2026-09-03T10:01:00Z" } });
    expect(aggregate([first, { ...first, eventId: "other-id" }]).modelTokens.totalTokens).toBe(100);
    expect(aggregate([first, { ...first, eventId: "e2", requestId: "r2" }]).modelTokens.totalTokens).toBe(200);
  });
  it("keeps unavailable and host-only totals out of model tokens", () => {
    expect(aggregate(makeUsageFixture("unavailable").events).modelTokens.totalTokens).toBeNull();
    const counter = makeEvent({ unit: "host-counter", measurementKind: "host-counter", usage: undefined, baseline: undefined, value: { amount: 250, unit: "goal-tokens" } });
    const result = aggregate([counter]);
    expect(result.hostCounters[0].amount).toBe(250);
    expect(result.modelTokens.totalTokens).toBeNull();
  });
  it("differences credits and keeps currencies and credit conversions separate", () => {
    const first = makeEvent({ unit: "credits", usage: undefined, value: { amount: 2, unit: "github-ai-credit" },
      baseline: { observedAt: "2026-09-03T10:00:00Z", value: { amount: 0, unit: "github-ai-credit" } } });
    const result = aggregate([first, second({ unit: "credits", usage: undefined, value: { amount: 2.5, unit: "github-ai-credit" } })]);
    expect(result.credits[0].amount).toBe(2.5);
    expect(result.charges).toEqual([]);
  });
});
