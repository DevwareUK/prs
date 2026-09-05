import { UsageEvidence, UsageEvent, TOKEN_CLASSES, type TokenUsage } from "@prs/contracts";

export type UsageWarning = { code: string; eventIds: string[]; message: string };
export type NormalizedUsageLedger = { events: UsageEvent[]; warnings: UsageWarning[]; source: UsageEvidence };

function normalizeEvent(event: UsageEvent): UsageEvent {
  if (!event.native) return event;
  const { native, ...base } = event;
  const values = native.values;
  const raw = { ...event.raw, native };
  if (event.unit !== "model-tokens") {
    const amount = native.format === "legacy-counter" ? values.totalTokens
      : event.unit === "credits" ? values.credits
        : event.unit === "currency" ? values.charge : values.tokensUsed;
    const unit = native.format === "legacy-counter" ? "legacy-unknown" : values.unit;
    if (typeof amount !== "number" || typeof unit !== "string") throw new Error("Native scalar evidence requires an amount and explicit unit");
    return UsageEvent.parse({ ...base, raw, value: { amount, unit } });
  }
  const cachedInputTokens = native.format === "claude-usage" ? values.cache_read_input_tokens : values.cached_input_tokens;
  const cacheWriteTokens = values.cache_creation_input_tokens;
  let uncachedInputTokens = values.input_tokens;
  if (native.inputIncludesCacheRead) {
    uncachedInputTokens = uncachedInputTokens === undefined || cachedInputTokens === undefined ? undefined : uncachedInputTokens - cachedInputTokens;
  }
  if (native.inputIncludesCacheWrite) {
    uncachedInputTokens = uncachedInputTokens === undefined || cacheWriteTokens === undefined ? undefined : uncachedInputTokens - cacheWriteTokens;
  }
  if (uncachedInputTokens !== undefined && uncachedInputTokens < 0) throw new Error("Native inclusive input total is smaller than included cache tokens");
  const usage: TokenUsage = Object.fromEntries(Object.entries({
    uncachedInputTokens, cachedInputTokens, cacheWriteTokens, outputTokens: values.output_tokens,
    reasoningTokens: native.format === "claude-usage" ? values.thinking_tokens : values.reasoning_tokens,
    providerTotalTokens: values.total_tokens,
  }).filter(([, value]) => value !== undefined));
  const classes = TOKEN_CLASSES.filter(key => key !== "reasoningTokens" || native.reasoning === "separate");
  return UsageEvent.parse({
    ...base, raw, usage, tokenSemantics: { reasoning: native.reasoning },
    status: event.status === "partial" || classes.some(key => usage[key] === undefined) ? "partial" : "tracked",
  });
}

/** Only documented local envelopes are consumed; this never discovers host files. */
export function normalizeUsageEvidence(input: UsageEvidence): NormalizedUsageLedger {
  const source = UsageEvidence.parse(input);
  const events = source.events.map(normalizeEvent);
  const warnings = events.filter(event => event.status !== "tracked").map(event => ({
    code: event.status === "unavailable" ? "unavailable" : "partial-native-evidence",
    eventIds: [event.eventId],
    message: event.status === "unavailable" ? "Native usage is unavailable; see local evidence for the capture reason." : "Some applicable native token classes are unknown.",
  }));
  return { source, events, warnings };
}
