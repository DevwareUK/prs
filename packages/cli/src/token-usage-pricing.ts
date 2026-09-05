import { UsageRateCard, TOKEN_CLASSES, type TokenClass, type UsageEvent, type TokenUsage } from "@prs/contracts";
import type { UsageAggregation, UsageContribution, ScalarTotal } from "./token-usage-aggregate";

type Estimate = {
  kind: "estimated"; eventIds: string[]; amount: number; currency: string; rateCardId: string;
  status: "complete" | "partial"; missing: TokenClass[]; assumption?: UsageEvent["allocation"];
};
export type UsagePricingResult = {
  status: "priced" | "partial" | "unpriced";
  estimates: Estimate[]; unpriced: { eventIds: string[]; reason: string }[];
  estimatedTotals: { currency: string; amount: number; status: "complete" | "partial" }[];
  reportedCharges: ScalarTotal[]; credits: ScalarTotal[];
  creditConversions: { kind: "credit-conversion"; eventIds: string[]; amount: number; currency: string; provenance: NonNullable<NonNullable<UsageEvent["value"]>["conversion"]> }[];
  rateCards: UsageRateCard[];
};
function mismatch(row: UsageContribution, rate: UsageRateCard): string | undefined {
  const event = row.event;
  if (!event.model || event.model.provider !== rate.provider || event.model.name !== rate.model) return "Unknown or mismatched model";
  if (!event.context || event.context.tier !== rate.contextTier.name) return "Unknown or mismatched context tier";
  const context = event.context.tokens;
  if ((rate.contextTier.minTokens > 0 || rate.contextTier.maxTokens !== undefined) && context === undefined) return "Per-request context length is unknown";
  if (context !== undefined && (context < rate.contextTier.minTokens || (rate.contextTier.maxTokens !== undefined && context > rate.contextTier.maxTokens))) return "Context length is outside the rate tier";
  const start = Date.parse(row.interval?.start ?? event.observedAt);
  const end = Date.parse(row.interval?.end ?? event.observedAt);
  if (start < Date.parse(rate.effectiveAt) || (rate.expiresAt && end > Date.parse(rate.expiresAt))) return "Coverage crosses or falls outside the rate effective/expiry window";
}
function billingTokens(row: UsageContribution, rate: UsageRateCard): TokenUsage {
  const tokens = { ...row.usage };
  const measuredReasoning = row.event.tokenSemantics?.reasoning;
  if (rate.reasoningBilling === "included-in-output" && measuredReasoning === "separate") {
    tokens.outputTokens = tokens.outputTokens === undefined || tokens.reasoningTokens === undefined ? undefined : tokens.outputTokens + tokens.reasoningTokens;
  } else if (rate.reasoningBilling === "separate" && measuredReasoning === "included-in-output") {
    tokens.outputTokens = tokens.outputTokens === undefined || tokens.reasoningTokens === undefined ? undefined : tokens.outputTokens - tokens.reasoningTokens;
  }
  return tokens;
}
export function priceUsage(usage: UsageAggregation, inputRates: UsageRateCard[]): UsagePricingResult {
  const rateCards = inputRates.map(rate => UsageRateCard.parse(rate));
  if (new Set(rateCards.map(rate => rate.id)).size !== rateCards.length) throw new Error("Rate-card IDs must be unique");
  const estimates: Estimate[] = [];
  const unpriced: UsagePricingResult["unpriced"] = [];
  for (const row of usage.contributions.filter(row => row.included && row.event.unit === "model-tokens")) {
    const reject = (reason: string) => unpriced.push({ eventIds: row.eventIds, reason });
    const rate = rateCards.find(rate => rate.id === row.event.rateCardId);
    if (!rate) { reject("No explicit matching rate-card snapshot"); continue; }
    const reason = mismatch(row, rate);
    if (reason) { reject(reason); continue; }
    let scoped = row;
    if (!TOKEN_CLASSES.some(key => row.usage?.[key] !== undefined)) {
      const assumption = row.event.allocation;
      if (!assumption || assumption.usage === undefined || row.usage?.providerTotalTokens !== row.event.usage?.providerTotalTokens) {
        reject("Total-only usage has no explicit allocation for this contribution"); continue;
      }
      scoped = { ...row, usage: assumption.usage };
    }
    const tokens = billingTokens(scoped, rate);
    const classes = TOKEN_CLASSES.filter(key => key !== "reasoningTokens" || rate.reasoningBilling === "separate");
    const missing: TokenClass[] = [];
    let amount = 0, pricedClasses = 0;
    for (const key of classes) {
      const count = tokens[key], price = rate.perMillion[key];
      if (count === undefined || (price === undefined && count !== 0)) { missing.push(key); continue; }
      if (count < 0 || !Number.isSafeInteger(count)) throw new Error("Invalid derived billing tokens");
      amount += count * (price ?? 0) / 1_000_000;
      pricedClasses++;
    }
    if (!Number.isFinite(amount)) throw new Error("Estimated amount exceeds numeric precision");
    if (!pricedClasses) { reject("No applicable token class can be priced"); continue; }
    estimates.push({ kind: "estimated", amount, currency: rate.currency, rateCardId: rate.id, eventIds: row.eventIds,
      status: missing.length || row.event.status === "partial" ? "partial" : "complete", missing, assumption: row.event.allocation });
  }
  const creditConversions: UsagePricingResult["creditConversions"] = [];
  for (const row of usage.contributions.filter(row => row.included && row.event.unit === "credits")) {
    const conversion = row.value?.conversion;
    if (!conversion || Date.parse(row.interval?.start ?? row.event.observedAt) < Date.parse(conversion.effectiveAt)) continue;
    const amount = row.value!.amount * conversion.perCredit;
    if (!Number.isFinite(amount)) throw new Error("Credit conversion exceeds numeric precision");
    creditConversions.push({ kind: "credit-conversion", amount, currency: conversion.currency, eventIds: row.eventIds, provenance: conversion });
  }
  const totals = new Map<string, UsagePricingResult["estimatedTotals"][number]>();
  for (const estimate of estimates) {
    const previous = totals.get(estimate.currency);
    const amount = (previous?.amount ?? 0) + estimate.amount;
    if (!Number.isFinite(amount)) throw new Error("Estimated total exceeds numeric precision");
    totals.set(estimate.currency, { currency: estimate.currency, amount,
      status: estimate.status === "partial" || previous?.status === "partial" || unpriced.length || usage.modelTokens.status !== "tracked" ? "partial" : "complete" });
  }
  const estimatedTotals = [...totals.values()];
  return { status: !estimates.length ? "unpriced" : estimatedTotals.some(total => total.status === "partial") ? "partial" : "priced",
    estimates, estimatedTotals, unpriced, creditConversions, rateCards,
    reportedCharges: usage.charges, credits: usage.credits };
}
