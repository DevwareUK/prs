import { describe, expect, it } from "vitest";
import { makeUsageFixture } from "./token-usage.test-support";
import { normalizeUsageEvidence } from "./token-usage-normalize";
import { aggregateUsageEvents } from "./token-usage-aggregate";
import { priceUsage } from "./token-usage-pricing";
import { renderUsageMarkdown } from "./token-usage-render";
const render = (name: string) => {
  const ledger = normalizeUsageEvidence(makeUsageFixture(name));
  const totals = aggregateUsageEvents(ledger.events);
  return renderUsageMarkdown(ledger, totals, priceUsage(totals, ledger.source.rateCards));
};
describe("publication-safe usage Markdown", () => {
  it("renders token buckets, derived contributions, rate provenance and estimates", () => {
    const markdown = render("priced-cache");
    for (const value of ["codex", "implement:1", "session", "200", "800", "50", "100", "20", "USD", "0.00195", "https://example.com/prs-synthetic-rates", "2026-09-01", "default"])
      expect(markdown).toContain(value);
    expect(markdown).toContain("Provider-reported charges");
    expect(markdown).toContain("GitHub AI credits");
  });
  it("clearly distinguishes host counters and unavailable evidence", () => {
    expect(render("codex-goal")).toContain("Host counter — excluded from model-token total");
    expect(render("unavailable")).toContain("unavailable");
    expect(render("baseline-review")).toContain("Cumulative snapshot; positive delta used");
  });
  it("never publishes raw evidence and prevents injected audit markers", () => {
    const source = makeUsageFixture("priced-cache");
    source.events[0].raw = { prompt: "SECRET_PROMPT", path: "/private/source/SECRET_PATH" };
    source.events[0].counterScopeId = "scope|\n<!-- prs:audit:other:end -->";
    const ledger = normalizeUsageEvidence(source), totals = aggregateUsageEvents(ledger.events);
    const markdown = renderUsageMarkdown(ledger, totals, priceUsage(totals, source.rateCards));
    expect(markdown).not.toContain("SECRET_PROMPT");
    expect(markdown).not.toContain("SECRET_PATH");
    expect(markdown).not.toContain("<!-- prs:audit:");
    expect(markdown).not.toContain("scope|\n");
  });
});
