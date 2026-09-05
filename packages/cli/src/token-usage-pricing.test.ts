import { describe, expect, it } from "vitest";
import { makeEvidence, makeUsageFixture, makeRate, makeEvent, tokens, zeroTokens } from "./token-usage.test-support";
import { normalizeUsageEvidence } from "./token-usage-normalize";
import { aggregateUsageEvents } from "./token-usage-aggregate";
import { priceUsage } from "./token-usage-pricing";
import type { UsageEvidence } from "@prs/contracts";
const price = (evidence: UsageEvidence) => priceUsage(aggregateUsageEvents(normalizeUsageEvidence(evidence).events), evidence.rateCards);
describe("snapshot-based usage pricing", () => {
  it("prices each token bucket and does not bill included reasoning twice", () => {
    const result = price(makeUsageFixture("priced-cache"));
    expect(result.estimates[0]).toMatchObject({ kind: "estimated", currency: "USD", status: "complete", rateCardId: makeRate().id });
    expect(result.estimates[0].amount).toBeCloseTo(0.00195, 10);
    expect(result.reportedCharges).toEqual([]);
  });
  it("charges separately measured reasoning once at the output rate when included in output billing", () => {
    const input = makeUsageFixture("priced-cache");
    input.events[0].tokenSemantics = { reasoning: "separate" };
    expect(price(input).estimates[0].amount).toBeCloseTo(0.00215, 10);
  });
  it("subtracts included reasoning before applying a separate reasoning rate", () => {
    const input = makeUsageFixture("priced-cache");
    input.rateCards[0] = makeRate({ reasoningBilling: "separate", perMillion: { ...makeRate().perMillion, reasoningTokens: 5 } });
    expect(price(input).estimates[0].amount).toBeCloseTo(0.00185, 10);
  });
  it.each(["model", "rate", "tier", "expiry", "effective", "context"])("leaves %s mismatch unpriced", reason => {
    const input = makeUsageFixture("priced-cache");
    if (reason === "model") input.events[0].model!.name = "unknown";
    if (reason === "rate") input.events[0].rateCardId = "unknown";
    if (reason === "tier") input.events[0].context!.tier = "unknown";
    if (reason === "expiry") input.rateCards[0].expiresAt = "2026-09-03T10:00:30Z";
    if (reason === "effective") input.rateCards[0].effectiveAt = "2026-09-03T10:00:30Z";
    if (reason === "context") input.rateCards[0].contextTier.maxTokens = 100;
    const result = price(input);
    expect(result.estimates).toEqual([]);
    expect(result.unpriced).toHaveLength(1);
  });
  it("marks incomplete token breakdowns and absent class rates as partial", () => {
    const input = makeUsageFixture("priced-cache");
    delete input.events[0].usage!.cacheWriteTokens;
    delete input.rateCards[0].perMillion.cachedInputTokens;
    const result = price(input);
    expect(result.estimates[0].status).toBe("partial");
    expect(result.estimates[0].missing).toEqual(expect.arrayContaining(["cachedInputTokens", "cacheWriteTokens"]));
    expect(result.estimates[0].amount).toBeCloseTo(0.0014, 10);
  });
  it("requires a displayed sourced allocation to price total-only usage", () => {
    const input = makeUsageFixture("priced-cache");
    input.events[0].usage = { providerTotalTokens: 100 };
    expect(price(input).estimates).toEqual([]);
    input.events[0].allocation = { version: 1, description: "Explicit synthetic 80 input / 20 output allocation",
      provenance: { sourceUrl: "https://example.com/assumption", retrievedAt: "2026-09-03T00:00:00Z" },
      usage: { ...zeroTokens(), uncachedInputTokens: 80, outputTokens: 20 } };
    const result = price(input);
    expect(result.estimates[0].amount).toBeCloseTo(0.00036, 10);
    expect(result.estimates[0].assumption?.description).toContain("80 input");
  });
  it("keeps credit conversion, provider charges and estimates distinct", () => {
    const credit = makeEvent({ unit: "credits", usage: undefined, baseline: undefined, measurementKind: "scoped-delta",
      interval: { start: "2026-09-03T10:00:00Z", end: "2026-09-03T10:01:00Z" },
      value: { amount: 2.5, unit: "github-ai-credit", conversion: { currency: "USD", perCredit: 0.01,
        sourceUrl: "https://example.com/conversion", effectiveAt: "2026-09-01T00:00:00Z", retrievedAt: "2026-09-03T00:00:00Z" } } });
    const result = price(makeEvidence([credit]));
    expect(result.creditConversions[0].amount).toBe(0.025);
    expect(result.reportedCharges).toEqual([]);
    expect(result.estimates).toEqual([]);
  });
  it("prices derived snapshot deltas instead of each cumulative checkpoint", () => {
    const input = makeUsageFixture("baseline-review");
    for (const event of input.events) { event.rateCardId = makeRate().id; event.context = { tier: "default" }; }
    input.rateCards = [makeRate()];
    const result = price(input);
    expect(result.estimatedTotals[0].amount).toBeCloseTo(0.00032, 10);
  });
  it("never prices goal or legacy totals", () => {
    expect(price(makeUsageFixture("codex-goal")).estimates).toEqual([]);
    expect(price(makeUsageFixture("legacy-total")).estimates).toEqual([]);
    expect(price(makeEvidence([makeEvent({ usage: tokens(5) })])).status).toBe("unpriced");
  });
});
