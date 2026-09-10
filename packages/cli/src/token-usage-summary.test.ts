import { describe, expect, it } from "vitest";
import { aggregateUsageEvents } from "./token-usage-aggregate";
import { priceUsage } from "./token-usage-pricing";
import { summarizeUsageByModel } from "./token-usage-summary";
import { makeEvent, makeRate } from "./token-usage.test-support";

const rate = makeRate();
function request(eventId: string, requestId: string, usage: Parameters<typeof makeEvent>[0]["usage"], overrides: Parameters<typeof makeEvent>[0] = {}) {
  return makeEvent({
    eventId,
    measurementKind: "provider-request",
    baseline: undefined,
    requestId,
    requestsDisjoint: true,
    context: { tier: "default", tokens: 100 },
    rateCardId: rate.id,
    usage,
    ...overrides,
  });
}

describe("per-model token usage summaries", () => {
  it("groups requests for one model and does not add included reasoning twice", () => {
    const totals = aggregateUsageEvents([
      request("e1", "r1", { uncachedInputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 0, outputTokens: 10, reasoningTokens: 4 }),
      request("e2", "r2", { uncachedInputTokens: 50, cachedInputTokens: 30, cacheWriteTokens: 5, outputTokens: 20, reasoningTokens: 5 }),
    ]);
    const summaries = summarizeUsageByModel(totals, priceUsage(totals, [rate]));
    expect(summaries).toMatchObject([{
      host: "codex",
      model: "example-model",
      contextTiers: ["default"],
      rateCardIds: [rate.id],
      requests: 2,
      usage: { uncachedInputTokens: 150, cachedInputTokens: 50, cacheWriteTokens: 5, outputTokens: 30, reasoningTokens: 9 },
      knownTotalTokens: 235,
      status: "priced",
      estimates: [{ currency: "USD" }],
      unpricedReasons: [],
    }]);
    expect(summaries[0].estimates[0].amount).toBeCloseTo(0.00064);
  });

  it("combines historical tiers, propagates partial pricing, and preserves unknown buckets", () => {
    const longRate = makeRate({
      id: "synthetic:example-model:2026-09-03:long",
      contextTier: { name: "long", minTokens: 101 },
      perMillion: { uncachedInputTokens: 4, cachedInputTokens: 1, cacheWriteTokens: 6, outputTokens: 15 },
    });
    const rows = [
      request("e1", "r1", { uncachedInputTokens: 100, cachedInputTokens: 20, cacheWriteTokens: 0, outputTokens: 10, providerTotalTokens: 130 }),
      request("e2", "r2", { uncachedInputTokens: 50, cachedInputTokens: 30, cacheWriteTokens: 5, outputTokens: 20 }, {
        context: { tier: "long", tokens: 105 }, rateCardId: longRate.id,
      }),
      request("e3", "r3", { uncachedInputTokens: 10, cachedInputTokens: 5, outputTokens: 2 }, {
        status: "partial", rateCardId: undefined,
      }),
    ];
    const totals = aggregateUsageEvents(rows), summary = summarizeUsageByModel(totals, priceUsage(totals, [rate, longRate]))[0];
    expect(summary).toMatchObject({
      contextTiers: ["default", "long"],
      rateCardIds: [rate.id, longRate.id].sort(),
      requests: 3,
      knownTotalTokens: 252,
      status: "partial",
      unpricedReasons: ["No explicit matching rate-card snapshot"],
    });
    expect(summary.usage).toEqual({ uncachedInputTokens: 160, cachedInputTokens: 55, cacheWriteTokens: 5, outputTokens: 32, providerTotalTokens: 130 });
    expect(summary.estimates[0].amount).toBeCloseTo(0.001125);
  });

  it("sorts host/model groups and does not inflate replayed request IDs", () => {
    const duplicate = request("e1", "r1", { uncachedInputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 });
    const otherRate = makeRate({ id: "synthetic:a-model:default", model: "a-model" });
    const other = request("e2", "r2", { uncachedInputTokens: 2, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 }, {
      model: { provider: "example", name: "a-model" }, rateCardId: otherRate.id,
    });
    const totals = aggregateUsageEvents([duplicate, duplicate, other]);
    const summaries = summarizeUsageByModel(totals, priceUsage(totals, [rate, otherRate]));
    expect(summaries.map(row => [row.model, row.requests])).toEqual([["a-model", 1], ["example-model", 1]]);
  });

  it("does not describe cumulative snapshots as provider requests", () => {
    const totals = aggregateUsageEvents([makeEvent()]);
    expect(summarizeUsageByModel(totals, priceUsage(totals, []))[0].requests).toBeNull();
  });
});
