import { describe, expect, it } from "vitest";
import { UsageEvidence } from "@prs/contracts";
import { makeUsageFixture } from "./token-usage.test-support";
import { normalizeUsageEvidence } from "./token-usage-normalize";

describe("local usage adapters", () => {
  it("subtracts Codex cached tokens exactly once and preserves native fields", () => {
    const source = makeUsageFixture("codex-inclusive");
    const ledger = normalizeUsageEvidence(source);
    expect(ledger.events[0].usage).toEqual({ uncachedInputTokens: 200, cachedInputTokens: 800, cacheWriteTokens: 0, outputTokens: 100, reasoningTokens: 20, providerTotalTokens: 1100 });
    expect(ledger.events[0].raw?.native).toEqual(source.events[0].native);
    expect(source.events[0].native?.values.unmapped).toBe("retained");
  });
  it("preserves Claude cache creation/read and included thinking", () => {
    const event = normalizeUsageEvidence(makeUsageFixture("claude-exclusive")).events[0];
    expect(event.usage).toMatchObject({ uncachedInputTokens: 200, cachedInputTokens: 800, cacheWriteTokens: 50, outputTokens: 100, reasoningTokens: 20 });
    expect(event.tokenSemantics?.reasoning).toBe("included-in-output");
  });
  it.each([["copilot-credits", "github-ai-credit", 2.5], ["codex-goal", "goal-tokens", 250], ["legacy-total", "legacy-unknown", 250]])("keeps %s out of model tokens", (name, unit, amount) => {
    const event = normalizeUsageEvidence(makeUsageFixture(String(name))).events[0];
    expect(event.value).toEqual({ unit, amount });
    expect(event.usage).toBeUndefined();
  });
  it("does not turn unavailable captures into zero", () => {
    const ledger = normalizeUsageEvidence(makeUsageFixture("unavailable"));
    expect(ledger.events).toHaveLength(3);
    expect(ledger.events.every(e => e.status === "unavailable" && !e.usage && !e.value)).toBe(true);
    expect(ledger.warnings).toHaveLength(3);
  });
  it("leaves normalized observations unchanged and does not mutate inputs", () => {
    const source = makeUsageFixture("baseline-review");
    const before = JSON.stringify(source);
    expect(normalizeUsageEvidence(source).events).toEqual(source.events);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("rejects an inclusive total smaller than cache reads", () => {
    const source = makeUsageFixture("codex-inclusive");
    source.events[0].native!.values.input_tokens = 1;
    expect(() => normalizeUsageEvidence(source)).toThrow(/inclusive/i);
  });
  it("leaves uncached unknown if an included cache count is missing", () => {
    const source = makeUsageFixture("codex-inclusive");
    delete source.events[0].native!.values.cached_input_tokens;
    const event = normalizeUsageEvidence(source).events[0];
    expect(event.usage?.uncachedInputTokens).toBeUndefined();
    expect(event.status).toBe("partial");
  });
  it("rejects missing semantic declarations rather than guessing", () => {
    const source = makeUsageFixture("codex-inclusive");
    delete source.events[0].native!.inputIncludesCacheRead;
    expect(() => UsageEvidence.parse(source)).toThrow();
  });
});
