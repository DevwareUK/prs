import { TOKEN_CLASSES, stableUsageJson, type TokenUsage, type UsageEvent } from "@prs/contracts";
import type { UsageAggregation, UsageContribution } from "./token-usage-aggregate";
import type { UsagePricingResult } from "./token-usage-pricing";

export type UsageModelSummary = {
  host: UsageEvent["host"];
  model: string;
  contextTiers: string[];
  rateCardIds: string[];
  requests: number | null;
  usage: TokenUsage;
  knownTotalTokens: number | null;
  status: "priced" | "partial" | "unpriced";
  estimates: Array<{ currency: string; amount: number }>;
  unpricedReasons: string[];
};

const usageKeys = [...TOKEN_CLASSES, "providerTotalTokens"] as const;
function checkedSum(a: number, b: number, integer: boolean): number {
  const result = a + b;
  if (!Number.isFinite(result) || (integer && !Number.isSafeInteger(result))) throw new Error("Usage summary exceeds numeric precision");
  return result;
}
function contributionTotal(row: UsageContribution): number | null {
  if (!row.usage) return null;
  if (row.usage.providerTotalTokens !== undefined) return row.usage.providerTotalTokens;
  const keys = TOKEN_CLASSES.filter(key => key !== "reasoningTokens" || row.event.tokenSemantics?.reasoning === "separate");
  const known = keys.filter(key => row.usage?.[key] !== undefined);
  return known.length ? known.reduce((sum, key) => checkedSum(sum, row.usage![key]!, true), 0) : null;
}

export function summarizeUsageByModel(totals: UsageAggregation, pricing: UsagePricingResult): UsageModelSummary[] {
  const contributions = totals.contributions.filter(row => row.included && row.event.unit === "model-tokens" && row.usage);
  const groups = new Map<string, UsageContribution[]>();
  for (const row of contributions) {
    const key = stableUsageJson([row.event.host, row.event.model?.name ?? "unknown"]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(rows => {
    const eventIds = new Set(rows.flatMap(row => row.eventIds));
    const estimates = pricing.estimates.filter(estimate => estimate.eventIds.some(id => eventIds.has(id)));
    const unpriced = pricing.unpriced.filter(item => item.eventIds.some(id => eventIds.has(id)));
    const usage: TokenUsage = {};
    for (const key of usageKeys) {
      const known = rows.filter(row => row.usage?.[key] !== undefined);
      if (known.length) usage[key] = known.reduce((sum, row) => checkedSum(sum, row.usage![key]!, true), 0);
    }
    let knownTotalTokens: number | null = null;
    for (const row of rows) {
      const total = contributionTotal(row);
      if (total !== null) knownTotalTokens = checkedSum(knownTotalTokens ?? 0, total, true);
    }
    const currencies = new Map<string, number>();
    for (const estimate of estimates) currencies.set(estimate.currency,
      checkedSum(currencies.get(estimate.currency) ?? 0, estimate.amount, false));
    const completelyPriced = estimates.length === rows.length && !unpriced.length && estimates.every(estimate => estimate.status === "complete");
    const providerRequests = rows.filter(row => row.event.measurementKind === "provider-request" && row.event.requestId);
    return {
      host: rows[0].event.host,
      model: rows[0].event.model?.name ?? "unknown",
      contextTiers: [...new Set(rows.flatMap(row => row.event.context?.tier ? [row.event.context.tier] : []))].sort(),
      rateCardIds: [...new Set(rows.flatMap(row => row.event.rateCardId ? [row.event.rateCardId] : []))].sort(),
      requests: providerRequests.length === rows.length
        ? new Set(providerRequests.map(row => row.event.requestId!)).size
        : null,
      usage,
      knownTotalTokens,
      status: completelyPriced ? "priced" : estimates.length ? "partial" : "unpriced",
      estimates: [...currencies].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => a.currency.localeCompare(b.currency)),
      unpricedReasons: [...new Set(unpriced.map(item => item.reason))].sort(),
    } satisfies UsageModelSummary;
  }).sort((a, b) => a.host.localeCompare(b.host) || a.model.localeCompare(b.model));
}
