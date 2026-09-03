import { UsageEvidence, UsageEvent, UsageRateCard, type TokenUsage } from "@prs/contracts";

export const zeroTokens = (): TokenUsage => ({ uncachedInputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
export const tokens = (n: number): TokenUsage => ({ ...zeroTokens(), uncachedInputTokens: n });
export function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return UsageEvent.parse({
    eventId: "e1", host: "codex", adapter: { name: "codex-session", version: 1 },
    source: { id: "synthetic", kind: "fixture" }, counterScopeId: "session",
    measurementKind: "cumulative-snapshot", observedAt: "2026-09-03T10:01:00Z",
    workflow: { runId: "run-42", phase: "implement", phaseAttemptId: "implement:1" },
    status: "tracked", unit: "model-tokens",
    coverage: { id: "work", representationId: "session", disjoint: true },
    tokenSemantics: { reasoning: "included-in-output" },
    model: { provider: "example", name: "example-model" },
    usage: tokens(100), baseline: { observedAt: "2026-09-03T10:00:00Z", usage: zeroTokens() },
    ...overrides,
  });
}
export const makeEvidence = (events: UsageEvent[], rateCards: UsageRateCard[] = []): UsageEvidence =>
  UsageEvidence.parse({ version: 1, kind: "usage-evidence", runId: "run-42", events, rateCards });
export const makeRate = (overrides: Partial<UsageRateCard> = {}): UsageRateCard => UsageRateCard.parse({
  id: "synthetic:example-model:2026-09-03:default", provider: "example", model: "example-model", currency: "USD",
  effectiveAt: "2026-09-01T00:00:00Z", retrievedAt: "2026-09-03T00:00:00Z",
  sourceUrl: "https://example.com/prs-synthetic-rates", contextTier: { name: "default", minTokens: 0 },
  reasoningBilling: "included-in-output",
  perMillion: { uncachedInputTokens: 2, cachedInputTokens: 0.5, cacheWriteTokens: 3, outputTokens: 10 },
  ...overrides,
});
export function makeUsageFixture(name: string): UsageEvidence {
  if (name === "baseline-review") return makeEvidence([
    makeEvent(),
    makeEvent({ eventId: "e2", observedAt: "2026-09-03T10:02:00Z", baseline: undefined, usage: tokens(160),
      workflow: { runId: "run-42", phase: "review", phaseAttemptId: "review:1" } }),
  ]);
  if (name === "unavailable") return makeEvidence(["codex", "claude-code", "copilot"].map((host, i) =>
    makeEvent({ eventId: "missing-" + i, host: host as UsageEvent["host"], status: "unavailable",
      reason: "Native capture not available", usage: undefined, baseline: undefined, tokenSemantics: undefined })));
  if (name === "priced-cache") return makeEvidence([makeEvent({
    measurementKind: "scoped-delta", baseline: undefined,
    interval: { start: "2026-09-03T10:00:00Z", end: "2026-09-03T10:01:00Z", phase: "implement" },
    context: { tier: "default" }, rateCardId: makeRate().id,
    usage: { uncachedInputTokens: 200, cachedInputTokens: 800, cacheWriteTokens: 50, outputTokens: 100, reasoningTokens: 20 },
  })], [makeRate()]);
  const host = name === "claude-exclusive" ? "claude-code" : name === "copilot-credits" ? "copilot" : "codex";
  const format = name === "legacy-total" ? "legacy-counter" : host === "claude-code" ? "claude-usage" : host === "copilot" ? "copilot-usage" : "codex-session";
  const unit = name === "copilot-credits" ? "credits" : ["codex-goal", "legacy-total"].includes(name) ? "host-counter" : "model-tokens";
  const values = name === "codex-inclusive"
    ? { input_tokens: 1000, cached_input_tokens: 800, cache_creation_input_tokens: 0, output_tokens: 100, reasoning_tokens: 20, total_tokens: 1100, unmapped: "retained" }
    : name === "claude-exclusive"
      ? { input_tokens: 200, cache_read_input_tokens: 800, cache_creation_input_tokens: 50, output_tokens: 100, thinking_tokens: 20 }
      : name === "copilot-credits" ? { credits: 2.5, unit: "github-ai-credit" }
        : name === "codex-goal" ? { tokensUsed: 250, unit: "goal-tokens" } : { totalTokens: 250 };
  return makeEvidence([makeEvent({
    host, adapter: { name: format, version: 1 }, unit, usage: undefined, baseline: undefined,
    native: { version: 1, format, values, inputIncludesCacheRead: name === "codex-inclusive", inputIncludesCacheWrite: false, reasoning: "included-in-output" },
  })]);
}
