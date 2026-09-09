import type { UsageAggregation } from "./token-usage-aggregate";
import type { NormalizedUsageLedger } from "./token-usage-normalize";
import type { UsagePricingResult } from "./token-usage-pricing";
import { summarizeUsageByModel, type UsageModelSummary } from "./token-usage-summary";

/** Treat every external label as text, never Markdown or audit control syntax. */
function text(value: unknown): string {
  return String(value ?? "unknown").replace(/[\r\n\t]/g, " ").replace(/[&<>\u0060*_[\]\\|#!]/g, char => "&#" + char.charCodeAt(0) + ";");
}
function table(headings: string[], rows: unknown[][]): string[] {
  return [
    "| " + headings.join(" | ") + " |",
    "| " + headings.map(() => "---").join(" | ") + " |",
    ...rows.map(row => "| " + row.map(text).join(" | ") + " |"),
  ];
}
function money(value: number): string { return String(Number(value.toPrecision(12))); }
function estimatedCost(row: Pick<UsageModelSummary, "status" | "estimates">): string {
  if (!row.estimates.length) return "unpriced";
  const amount = row.estimates.map(estimate => `${estimate.currency} ${money(estimate.amount)}`).join("; ");
  return row.status === "priced" ? amount : amount + " (partial)";
}
function optionalSection(title: string, intro: string | undefined, headings: string[], rows: unknown[][]): string[] {
  return rows.length ? ["", "## " + title, "", ...(intro ? [intro, ""] : []), ...table(headings, rows)] : [];
}

export function renderUsageMarkdown(ledger: NormalizedUsageLedger, totals: UsageAggregation, pricing: UsagePricingResult): string {
  const capture = ledger.source.capture;
  if (capture && ledger.events.every(event => event.status === "unavailable")) {
    return ["# Usage and cost evidence", "", "Run: " + text(ledger.source.runId), "",
      "Selected-session checkpoint: " + text(capture.host) + " / " + text(capture.sessionId) + " (unavailable).",
      "Request observations after " + text(capture.since) + " through " + text(capture.capturedAt) + ".", "",
      "Model-token total and cost: unavailable, not zero. Full-task and subagent coverage are unproven.",
      "Responses emitted after this checkpoint are not included.", "",
      ...[...new Set(capture.warnings)].map(warning => "- " + text(warning)), "",
      "Private source paths, raw evidence, and request-level contributions remain local.", ""].join("\n");
  }

  const summaries = summarizeUsageByModel(totals, pricing);
  const modelRows = summaries.map(row => [
    row.host + " / " + row.model,
    row.requests,
    row.usage.uncachedInputTokens,
    row.usage.cachedInputTokens,
    row.usage.cacheWriteTokens,
    row.usage.outputTokens,
    row.knownTotalTokens,
    estimatedCost(row),
  ]);
  if (summaries.length) modelRows.push([
    "Overall",
    summaries.every(row => row.requests !== null)
      ? summaries.reduce((sum, row) => sum + (row.requests ?? 0), 0)
      : null,
    totals.modelTokens.knownTokens.uncachedInputTokens,
    totals.modelTokens.knownTokens.cachedInputTokens,
    totals.modelTokens.knownTokens.cacheWriteTokens,
    totals.modelTokens.knownTokens.outputTokens,
    totals.modelTokens.totalTokens,
    pricing.estimatedTotals.length
      ? pricing.estimatedTotals.map(row => `${row.currency} ${money(row.amount)}${row.status === "partial" ? " (partial)" : ""}`).join("; ")
      : "unpriced",
  ]);

  const hostEstimates = new Map<string, number>();
  for (const row of totals.contributions.filter(row => row.included && row.event.hostEstimatedCost)) {
    const estimate = row.event.hostEstimatedCost!;
    hostEstimates.set(estimate.currency, (hostEstimates.get(estimate.currency) ?? 0) + estimate.amount);
  }
  const referencedRateIds = new Set(pricing.estimates.map(estimate => estimate.rateCardId));
  const referencedRates = pricing.rateCards.filter(rate => referencedRateIds.has(rate.id));
  const warnings = new Set<string>([
    ...(capture?.warnings ?? []),
    ...ledger.warnings.map(warning => warning.message),
    ...totals.warnings.map(warning => warning.message),
    ...summaries.flatMap(row => row.unpricedReasons.map(reason => `${row.host} / ${row.model}: ${reason}`)),
  ]);
  const copilotCredits = summaries.flatMap(row => row.host === "copilot"
    ? row.estimates.filter(estimate => estimate.currency === "USD").map(estimate => [row.model, money(estimate.amount / 0.01), row.status] as unknown[])
    : []);

  const lines = [
    "# Usage and cost evidence", "",
    "Run: " + text(ledger.source.runId), "",
    ...(capture ? [
      "Selected-session checkpoint: " + text(capture.host) + " / " + text(capture.sessionId) + " (" + text(capture.status) + ").",
      "Request observations after " + text(capture.since) + " through " + text(capture.capturedAt) + ".",
      "Full-task and subagent coverage are unproven. Responses emitted after this checkpoint are not included.", "",
    ] : []),
    ...(modelRows.length ? [
      ...table(["Model", "Requests", "Uncached input", "Cached input/read", "Cache write/creation", "Output", "Known total", "Estimated cost"], modelRows),
      "", "Known subtotals may be partial. Unknown values are not substituted with zero; estimates are not provider invoices.",
    ] : ["Model-token total and cost: unavailable, not zero."]),
    ...optionalSection("Host counters", "Excluded from model-token totals and model-token cost estimates.",
      ["Host", "Scope", "Counter unit", "Known contribution"], totals.hostCounters.map(row => [row.host, row.scope, row.unit, row.amount])),
    ...optionalSection("Host-reported cost estimates", "Separate host estimates; not added to rate-card estimates or reported charges.",
      ["Currency", "Known host-estimated subtotal"], [...hostEstimates].map(([currency, amount]) => [currency, money(amount)])),
    ...optionalSection("Provider-reported charges", "Reported charges remain distinct from model-token estimates.",
      ["Currency", "Reported contribution"], pricing.reportedCharges.map(row => [row.unit, money(row.amount)])),
    ...optionalSection("Credit consumption", "Consumed credits are reported values, not estimated token cost.",
      ["Credit unit", "Consumed contribution"], pricing.credits.map(row => [row.unit, row.amount])),
    ...optionalSection("Estimated GitHub AI-credit equivalents", "Derived from GitHub's published conversion of 1 AI credit = USD 0.01; not reported consumption.",
      ["Copilot model", "Estimated AI credits", "Status"], copilotCredits),
    ...optionalSection("Credit conversions", "Derived values; not model tokens or provider-reported charges.",
      ["Converted amount", "Currency", "Rate per credit", "Source"], pricing.creditConversions.map(row => [money(row.amount), row.currency, row.provenance.perCredit, row.provenance.sourceUrl])),
    ...optionalSection("Plan entitlements", "Informational; not summed into usage or cost.",
      ["Host", "Unit", "Allowance"], totals.entitlements.map(row => [row.event.host, row.event.value?.unit, row.event.value?.amount])),
    ...(referencedRates.length ? ["", "## Pricing sources", "", ...referencedRates.map(rate =>
      `- ${text(rate.provider)} / ${text(rate.model)} (${text(rate.contextTier.name)}): ${text(rate.sourceUrl)}; effective ${text(rate.effectiveAt)}${rate.expiresAt ? "; expires " + text(rate.expiresAt) : ""}; retrieved ${text(rate.retrievedAt)}.`)] : []),
    ...(warnings.size ? ["", "## Warnings and unpriced evidence", "", ...[...warnings].map(warning => "- " + text(warning))] : []),
    "", "Raw payloads, request-level event IDs and contributions, full rate-card snapshots, transcripts, and private source paths remain local.",
  ];
  return lines.join("\n") + "\n";
}
