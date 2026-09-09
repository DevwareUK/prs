import { describe, expect, it } from "vitest";
import { makeUsageFixture } from "./token-usage.test-support";
import { normalizeUsageEvidence } from "./token-usage-normalize";
import { aggregateUsageEvents } from "./token-usage-aggregate";
import { priceUsage } from "./token-usage-pricing";
import { renderUsageMarkdown } from "./token-usage-render";
import { captureUsage } from "./token-usage-capture";
const render = (name: string) => {
  const ledger = normalizeUsageEvidence(makeUsageFixture(name));
  const totals = aggregateUsageEvents(ledger.events);
  return renderUsageMarkdown(ledger, totals, priceUsage(totals, ledger.source.rateCards));
};
describe("publication-safe usage Markdown", () => {
  it("publishes one compact row per host/model plus an overall row", () => {
    const source = makeUsageFixture("priced-cache");
    source.events[0] = { ...source.events[0], measurementKind: "provider-request", interval: undefined, requestId: "request-1", requestsDisjoint: true };
    source.events.push({ ...source.events[0], eventId: "e2", requestId: "request-2" });
    const otherRate = { ...source.rateCards[0], id: "synthetic:other-model:default", model: "other-model" };
    source.rateCards.push(otherRate);
    source.events.push({ ...source.events[0], eventId: "e3", requestId: "request-3", model: { provider: "example", name: "other-model" }, rateCardId: otherRate.id });
    const ledger = normalizeUsageEvidence(source), totals = aggregateUsageEvents(ledger.events);
    const markdown = renderUsageMarkdown(ledger, totals, priceUsage(totals, source.rateCards));
    expect(markdown).toContain("Model | Requests | Uncached input | Cached input/read | Cache write/creation | Output | Known total | Estimated cost");
    expect(markdown).toContain("codex / example-model | 2 | 400 | 1600 | 100 | 200 | 2300 | USD 0.0039");
    expect(markdown).toContain("codex / other-model | 1 | 200 | 800 | 50 | 100 | 1150 | USD 0.00195");
    expect(markdown).toContain("Overall | 3 | 600 | 2400 | 150 | 300 | 3450 | USD 0.00585");
    for (const omitted of ["Observations and derived contributions", "e1", "e2", "e3", "Coverage interval", "Phase / attempt", "Rate-card provenance"])
      expect(markdown).not.toContain(omitted);
  });

  it("reports host estimates once, separately from rate prices and reported charges", () => {
    const source = makeUsageFixture("priced-cache");
    source.events[0].measurementKind = "provider-request";
    source.events[0].requestId = "request-1";
    source.events[0].requestsDisjoint = true;
    source.events[0].hostEstimatedCost = { currency: "USD", amount: 0.12345 };
    source.events.push({ ...source.events[0] });
    const ledger = normalizeUsageEvidence(source), totals = aggregateUsageEvents(ledger.events);
    const pricing = priceUsage(totals, source.rateCards);
    const markdown = renderUsageMarkdown(ledger, totals, pricing);
    expect(markdown).toContain("Host-reported cost estimates");
    expect(markdown).toContain("| USD | 0.12345 |");
    expect(markdown).not.toContain("0.2469");
    expect(pricing.reportedCharges).toEqual([]);
    expect(pricing.estimatedTotals[0].amount).toBeCloseTo(0.00195);
  });
  it("labels Copilot AI-credit equivalents as estimates, not consumption", () => {
    const source = makeUsageFixture("priced-cache");
    source.events[0].host = "copilot";
    const ledger = normalizeUsageEvidence(source), totals = aggregateUsageEvents(ledger.events);
    const pricing = priceUsage(totals, source.rateCards);
    const markdown = renderUsageMarkdown(ledger, totals, pricing);
    expect(markdown).toContain("Estimated GitHub AI-credit equivalents");
    expect(markdown).toContain("| example-model | 0.195 | priced |");
    expect(markdown).toContain("not reported consumption");
    expect(pricing.credits).toEqual([]);
  });
  it("labels capture boundaries and omits private paths", () => {
    const source = captureUsage([], { host: "copilot", runId: "test", sessionId: "s1", since: "2026-09-04T10:00:00Z", capturedAt: "2026-09-04T11:00:00Z", warnings: ["Set export first"] });
    source.capture!.sourcePath = "/private/SECRET";
    const ledger = normalizeUsageEvidence(source), totals = aggregateUsageEvents(ledger.events);
    const markdown = renderUsageMarkdown(ledger, totals, priceUsage(totals, []));
    expect(markdown).toContain("Selected-session checkpoint");
    expect(markdown).toContain("2026-09-04T10:00:00.000Z");
    expect(markdown).toContain("Set export first");
    expect(markdown).toContain("subagent");
    expect(markdown).not.toContain("SECRET");
  });
  it("renders compact token subtotals, source provenance and estimates", () => {
    const markdown = render("priced-cache");
    for (const value of ["codex / example-model", "200", "800", "50", "100", "1150", "USD", "0.00195", "https://example.com/prs-synthetic-rates", "2026-09-01", "default"])
      expect(markdown).toContain(value);
    expect(markdown).not.toContain("implement:1");
    expect(markdown).not.toContain("Provider-reported charges");
    expect(markdown).not.toContain("Credit consumption");
  });
  it("cites only rate cards that actually produced an estimate", () => {
    const source = makeUsageFixture("priced-cache");
    source.events[0].model!.name = "other-model";
    const ledger = normalizeUsageEvidence(source), totals = aggregateUsageEvents(ledger.events);
    const markdown = renderUsageMarkdown(ledger, totals, priceUsage(totals, source.rateCards));
    expect(markdown).toContain("unpriced");
    expect(markdown).not.toContain("## Pricing sources");
    expect(markdown).not.toContain("https://example.com/prs-synthetic-rates");
  });
  it("omits empty sections and keeps unavailable evidence explicit", () => {
    expect(render("codex-goal")).toContain("unavailable, not zero");
    expect(render("codex-goal")).not.toContain("## Host counters");
    expect(render("unavailable")).toContain("unavailable");
    expect(render("unavailable")).not.toContain("| Model | Requests |");
    expect(render("baseline-review")).toContain("| Overall | unknown | 160 | 0 | 0 | 0 | 160 | unpriced |");
  });
  it("never publishes raw evidence and prevents injected audit markers", () => {
    const source = makeUsageFixture("priced-cache");
    source.events[0].raw = { prompt: "SECRET_PROMPT", path: "/private/source/SECRET_PATH" };
    source.events[0].model!.name = "model|\n<!-- prs:audit:other:end -->";
    source.capture = { version: 1, host: "codex", sessionId: "s1", since: "2026-09-03T10:00:00Z", capturedAt: "2026-09-03T11:00:00Z",
      format: "fixture", status: "captured", scope: "selected-session-checkpoint", warnings: ["warning <!-- prs:audit:other:start -->"] };
    const ledger = normalizeUsageEvidence(source), totals = aggregateUsageEvents(ledger.events);
    const markdown = renderUsageMarkdown(ledger, totals, priceUsage(totals, source.rateCards));
    expect(markdown).not.toContain("SECRET_PROMPT");
    expect(markdown).not.toContain("SECRET_PATH");
    expect(markdown).not.toContain("<!-- prs:audit:");
    expect(markdown).not.toContain("model|\n");
  });
});
