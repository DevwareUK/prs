import { TokenUsage, UsageEvent, UsageRateCard } from "@prs/contracts";

export type UsageRateResolution =
  | {
      status: "resolved";
      model: NonNullable<UsageEvent["model"]>;
      context: NonNullable<UsageEvent["context"]>;
      rateCard: UsageRateCard;
    }
  | {
      status: "unpriced";
      model: NonNullable<UsageEvent["model"]>;
      reason: string;
    };

type Prices = UsageRateCard["perMillion"];
type Tier = UsageRateCard["contextTier"] & { prices: Prices };
type CatalogEntry = {
  host: UsageEvent["host"];
  provider: string;
  observedProviders: readonly string[];
  canonicalModel: string;
  aliases: readonly string[];
  cards: readonly UsageRateCard[];
};

const OPENAI_SOURCE = "https://developers.openai.com/api/docs/models";
const ANTHROPIC_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";
const COPILOT_SOURCE = "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing";
const SNAPSHOT = "2026-09-08T00:00:00Z";

function makeEntry(input: {
  host: UsageEvent["host"];
  sourceName: string;
  sourceUrl: string;
  provider: string;
  observedProviders?: readonly string[];
  model: string;
  aliases?: readonly string[];
  tiers: readonly Tier[];
  expiresAt?: string;
}): CatalogEntry {
  const cards = input.tiers.map(tier => UsageRateCard.parse({
    id: `${input.sourceName}:${input.model}:2026-09-08:${tier.name}`,
    provider: input.provider,
    model: input.model,
    currency: "USD",
    effectiveAt: SNAPSHOT,
    retrievedAt: SNAPSHOT,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    sourceUrl: input.sourceUrl,
    contextTier: { name: tier.name, minTokens: tier.minTokens, ...(tier.maxTokens === undefined ? {} : { maxTokens: tier.maxTokens }) },
    reasoningBilling: "included-in-output",
    perMillion: tier.prices,
  }));
  return {
    host: input.host,
    provider: input.provider,
    observedProviders: input.observedProviders ?? [input.provider],
    canonicalModel: input.model,
    aliases: input.aliases ?? [input.model],
    cards,
  };
}

const single = (prices: Prices): Tier[] => [{ name: "default", minTokens: 0, prices }];
const tiers = (threshold: number, standard: Prices, long: Prices): Tier[] => [
  { name: "default", minTokens: 0, maxTokens: threshold, prices: standard },
  { name: "long", minTokens: threshold + 1, prices: long },
];
const openai = (model: string, prices: Prices | readonly [Prices, Prices], aliases?: readonly string[], threshold = 272000, expiresAt?: string) => makeEntry({
  host: "codex", sourceName: "openai", sourceUrl: OPENAI_SOURCE, provider: "openai", model, aliases,
  tiers: Array.isArray(prices) ? tiers(threshold, prices[0], prices[1]) : single(prices as Prices), expiresAt,
});
const copilot = (provider: string, model: string, modelTiers: readonly Tier[], aliases?: readonly string[], expiresAt?: string) => makeEntry({
  host: "copilot", sourceName: "github-copilot", sourceUrl: COPILOT_SOURCE, provider, model, aliases,
  observedProviders: [provider, "github", "github-copilot"], tiers: modelTiers, expiresAt,
});
const anthropic = (model: string, prices: Prices, aliases?: readonly string[]) => makeEntry({
  host: "claude-code", sourceName: "anthropic", sourceUrl: ANTHROPIC_SOURCE, provider: "anthropic", model, aliases,
  tiers: single(prices),
});

const COPILOT_ANTHROPIC: Array<[string, Prices]> = [
  ["claude-haiku-4.5", { uncachedInputTokens: 1, cachedInputTokens: 0.1, cacheWriteTokens: 1.25, outputTokens: 5 }],
  ["claude-sonnet-4.6", { uncachedInputTokens: 3, cachedInputTokens: 0.3, cacheWriteTokens: 3.75, outputTokens: 15 }],
  ["claude-opus-4.7", { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 6.25, outputTokens: 25 }],
  ["claude-opus-4.8", { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 6.25, outputTokens: 25 }],
  ["claude-opus-5", { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 6.25, outputTokens: 25 }],
  ["claude-sonnet-5", { uncachedInputTokens: 2, cachedInputTokens: 0.2, cacheWriteTokens: 2.5, outputTokens: 10 }],
  ["claude-fable-5", { uncachedInputTokens: 10, cachedInputTokens: 1, cacheWriteTokens: 12.5, outputTokens: 50 }],
  ["claude-fable-5.1", { uncachedInputTokens: 10, cachedInputTokens: 0.25, cacheWriteTokens: 12.5, outputTokens: 50 }],
];

const CATALOG: readonly CatalogEntry[] = [
  openai("gpt-5-mini", { uncachedInputTokens: 0.25, cachedInputTokens: 0.025, cacheWriteTokens: 0, outputTokens: 2 }),
  openai("gpt-5.3-codex", { uncachedInputTokens: 1.75, cachedInputTokens: 0.175, cacheWriteTokens: 0, outputTokens: 14 }),
  openai("gpt-5.4", [
    { uncachedInputTokens: 2.5, cachedInputTokens: 0.25, cacheWriteTokens: 0, outputTokens: 15 },
    { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 0, outputTokens: 22.5 },
  ]),
  openai("gpt-5.4-mini", { uncachedInputTokens: 0.75, cachedInputTokens: 0.075, cacheWriteTokens: 0, outputTokens: 4.5 }),
  openai("gpt-5.4-nano", { uncachedInputTokens: 0.2, cachedInputTokens: 0.02, cacheWriteTokens: 0, outputTokens: 1.25 }),
  openai("gpt-5.5", [
    { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 0, outputTokens: 30 },
    { uncachedInputTokens: 10, cachedInputTokens: 1, cacheWriteTokens: 0, outputTokens: 45 },
  ]),
  openai("gpt-5.6-luna", [
    { uncachedInputTokens: 0.2, cachedInputTokens: 0.02, cacheWriteTokens: 0.25, outputTokens: 1.2 },
    { uncachedInputTokens: 0.4, cachedInputTokens: 0.04, cacheWriteTokens: 0.5, outputTokens: 1.8 },
  ]),
  openai("gpt-5.6-sol", [
    { uncachedInputTokens: 4, cachedInputTokens: 0.4, cacheWriteTokens: 5, outputTokens: 20 },
    { uncachedInputTokens: 8, cachedInputTokens: 0.8, cacheWriteTokens: 10, outputTokens: 30 },
  ], ["gpt-5.6-sol", "gpt-5.6"], 272000, "2026-11-22T00:00:00Z"),
  openai("gpt-5.6-terra", [
    { uncachedInputTokens: 2, cachedInputTokens: 0.2, cacheWriteTokens: 2.5, outputTokens: 12 },
    { uncachedInputTokens: 4, cachedInputTokens: 0.4, cacheWriteTokens: 5, outputTokens: 18 },
  ]),
  openai("gpt-6-astra", [
    { uncachedInputTokens: 10, cachedInputTokens: 1, cacheWriteTokens: 12.5, outputTokens: 50 },
    { uncachedInputTokens: 20, cachedInputTokens: 2, cacheWriteTokens: 25, outputTokens: 75 },
  ]),

  anthropic("claude-fable-5-1", { uncachedInputTokens: 10, cachedInputTokens: 0.25, cacheWriteTokens: 12.5, outputTokens: 50 }),
  anthropic("claude-mythos-5-1", { uncachedInputTokens: 10, cachedInputTokens: 0.25, cacheWriteTokens: 12.5, outputTokens: 50 }),
  anthropic("claude-fable-5", { uncachedInputTokens: 10, cachedInputTokens: 1, cacheWriteTokens: 12.5, outputTokens: 50 }),
  anthropic("claude-mythos-5", { uncachedInputTokens: 10, cachedInputTokens: 1, cacheWriteTokens: 12.5, outputTokens: 50 }),
  anthropic("claude-opus-5", { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 6.25, outputTokens: 25 }),
  ...["claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6"].map(model => anthropic(model, { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 6.25, outputTokens: 25 })),
  anthropic("claude-opus-4-5", { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 6.25, outputTokens: 25 }, ["claude-opus-4-5", "claude-opus-4-5-20251101"]),
  anthropic("claude-sonnet-5", { uncachedInputTokens: 2, cachedInputTokens: 0.2, cacheWriteTokens: 2.5, outputTokens: 10 }),
  anthropic("claude-sonnet-4-6", { uncachedInputTokens: 3, cachedInputTokens: 0.3, cacheWriteTokens: 3.75, outputTokens: 15 }),
  anthropic("claude-sonnet-4-5", { uncachedInputTokens: 3, cachedInputTokens: 0.3, cacheWriteTokens: 3.75, outputTokens: 15 }, ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"]),
  anthropic("claude-haiku-4-5", { uncachedInputTokens: 1, cachedInputTokens: 0.1, cacheWriteTokens: 1.25, outputTokens: 5 }, ["claude-haiku-4-5", "claude-haiku-4-5-20251001"]),

  copilot("openai", "gpt-5-mini", single({ uncachedInputTokens: 0.25, cachedInputTokens: 0.025, cacheWriteTokens: 0, outputTokens: 2 })),
  copilot("openai", "gpt-5.3-codex", single({ uncachedInputTokens: 1.75, cachedInputTokens: 0.175, cacheWriteTokens: 0, outputTokens: 14 })),
  copilot("openai", "gpt-5.4", tiers(272000,
    { uncachedInputTokens: 2.5, cachedInputTokens: 0.25, cacheWriteTokens: 0, outputTokens: 15 },
    { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 0, outputTokens: 22.5 })),
  copilot("openai", "gpt-5.4-mini", single({ uncachedInputTokens: 0.75, cachedInputTokens: 0.075, cacheWriteTokens: 0, outputTokens: 4.5 })),
  copilot("openai", "gpt-5.4-nano", single({ uncachedInputTokens: 0.2, cachedInputTokens: 0.02, cacheWriteTokens: 0, outputTokens: 1.25 })),
  copilot("openai", "gpt-5.5", tiers(272000,
    { uncachedInputTokens: 5, cachedInputTokens: 0.5, cacheWriteTokens: 0, outputTokens: 30 },
    { uncachedInputTokens: 10, cachedInputTokens: 1, cacheWriteTokens: 0, outputTokens: 45 })),
  copilot("openai", "gpt-5.6-luna", tiers(200000,
    { uncachedInputTokens: 0.2, cachedInputTokens: 0.02, cacheWriteTokens: 0.25, outputTokens: 1.2 },
    { uncachedInputTokens: 0.4, cachedInputTokens: 0.04, cacheWriteTokens: 0.5, outputTokens: 1.8 })),
  copilot("openai", "gpt-5.6-sol", tiers(272000,
    { uncachedInputTokens: 4, cachedInputTokens: 0.4, cacheWriteTokens: 5, outputTokens: 20 },
    { uncachedInputTokens: 8, cachedInputTokens: 0.8, cacheWriteTokens: 10, outputTokens: 30 })),
  copilot("openai", "gpt-5.6-terra", tiers(272000,
    { uncachedInputTokens: 2, cachedInputTokens: 0.2, cacheWriteTokens: 2.5, outputTokens: 12 },
    { uncachedInputTokens: 4, cachedInputTokens: 0.4, cacheWriteTokens: 5, outputTokens: 18 })),
  copilot("openai", "gpt-6-astra", tiers(272000,
    { uncachedInputTokens: 10, cachedInputTokens: 1, cacheWriteTokens: 12.5, outputTokens: 50 },
    { uncachedInputTokens: 20, cachedInputTokens: 2, cacheWriteTokens: 25, outputTokens: 75 })),
  ...COPILOT_ANTHROPIC.map(([model, prices]) => copilot("anthropic", model, single(prices))),
  copilot("google", "gemini-3.5-flash", single({ uncachedInputTokens: 1.5, cachedInputTokens: 0.15, outputTokens: 9 })),
  ...["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash"].map(model => copilot("google", model,
    single({ uncachedInputTokens: 0.75, cachedInputTokens: 0.075, outputTokens: 3.75 }), undefined, "2027-01-01T00:00:00Z")),
  copilot("microsoft", "mai-code-1-flash", single({ uncachedInputTokens: 0.75, cachedInputTokens: 0.075, outputTokens: 4.5 })),
  copilot("microsoft", "mai-code-1.1-flash", single({ uncachedInputTokens: 0.2, cachedInputTokens: 0.02, outputTokens: 1.2 })),
  ...["grok-4.5", "grok-4.6"].map(model => copilot("xai", model, tiers(200000,
    { uncachedInputTokens: 2, cachedInputTokens: 0.5, outputTokens: 6 },
    { uncachedInputTokens: 4, cachedInputTokens: 1, outputTokens: 12 }))),
  copilot("moonshot-ai", "kimi-k2.7-code", single({ uncachedInputTokens: 0.95, cachedInputTokens: 0.19, outputTokens: 4 })),
  copilot("moonshot-ai", "kimi-k3", single({ uncachedInputTokens: 3, cachedInputTokens: 0.3, outputTokens: 15 })),
];

function contextTokens(usage: TokenUsage): number | undefined {
  const buckets = [usage.uncachedInputTokens, usage.cachedInputTokens, usage.cacheWriteTokens];
  if (buckets.some(value => value === undefined)) return undefined;
  const total = buckets.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Number.isSafeInteger(total) ? total : undefined;
}

export function resolveUsageRate(input: {
  host: UsageEvent["host"];
  provider: string;
  model: string;
  usage: TokenUsage;
  observedAt: string;
}): UsageRateResolution {
  const nativeModel = { provider: input.provider, name: input.model };
  const provider = input.provider.trim().toLowerCase();
  const entry = CATALOG.find(candidate => candidate.host === input.host
    && candidate.observedProviders.includes(provider)
    && candidate.aliases.includes(input.model));
  if (!entry) return { status: "unpriced", model: nativeModel, reason: `Unknown ${input.host} model: ${input.model}` };
  const tokens = contextTokens(input.usage);
  const bounded = entry.cards.some(candidate => candidate.contextTier.minTokens > 0 || candidate.contextTier.maxTokens !== undefined);
  if (bounded && tokens === undefined) return {
    status: "unpriced",
    model: { provider: entry.provider, name: entry.canonicalModel },
    reason: "Context tier is unknown because one or more input token buckets are missing.",
  };
  const observed = Date.parse(input.observedAt);
  const rateCard = entry.cards.find(candidate => (tokens === undefined || (tokens >= candidate.contextTier.minTokens
    && (candidate.contextTier.maxTokens === undefined || tokens <= candidate.contextTier.maxTokens)))
    && observed >= Date.parse(candidate.effectiveAt)
    && (candidate.expiresAt === undefined || observed < Date.parse(candidate.expiresAt)));
  if (!rateCard) return {
    status: "unpriced",
    model: { provider: entry.provider, name: entry.canonicalModel },
    reason: "No applicable rate card for the observed context and date.",
  };
  return {
    status: "resolved",
    model: { provider: entry.provider, name: entry.canonicalModel },
    context: { tier: rateCard.contextTier.name, ...(tokens === undefined ? {} : { tokens }) },
    rateCard,
  };
}
