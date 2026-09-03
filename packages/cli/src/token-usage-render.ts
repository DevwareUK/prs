import { TOKEN_CLASSES } from "@prs/contracts";
import type { UsageAggregation } from "./token-usage-aggregate";
import type { NormalizedUsageLedger } from "./token-usage-normalize";
import type { UsagePricingResult } from "./token-usage-pricing";

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
export function renderUsageMarkdown(ledger: NormalizedUsageLedger, totals: UsageAggregation, pricing: UsagePricingResult): string {
  const lines = [
    "# Usage and cost evidence", "",
    "Run: " + text(ledger.source.runId), "",
    "Model-token known total: " + text(totals.modelTokens.totalTokens) + " (" + totals.modelTokens.status + ").",
    "Known subtotals are not guaranteed complete totals. Unknown values are never substituted with zero.", "",
    ...table(["Uncached input", "Cached input/read", "Cache write/creation", "Output", "Reasoning/thinking", "Provider total (reconciliation only)"],
      [[...TOKEN_CLASSES, "providerTotalTokens" as const].map(key => totals.modelTokens.knownTokens[key])]),
    "", "## Observations and derived contributions", "",
    ...table(["Event", "Host", "Scope / representation", "Phase / attempt", "Model", "Measurement / unit", "Observed at", "Coverage interval", "Checkpoint", "Contribution", "Attribution / status"],
      totals.contributions.map(row => {
        const e = row.event;
        const breakdown = (usage: typeof row.usage) => usage ? TOKEN_CLASSES.filter(key => usage[key] !== undefined).map(key => key + "=" + usage[key]).join("; ") + (usage.providerTotalTokens === undefined ? "" : "; providerTotalTokens=" + usage.providerTotalTokens) : "unknown";
        return [e.eventId, e.host, e.counterScopeId + " / " + e.coverage.representationId,
          e.workflow.phase + " / " + e.workflow.phaseAttemptId, e.model?.name ?? "unknown",
          e.measurementKind + " / " + e.unit + (e.value ? " (" + e.value.unit + ")" : ""),
          e.observedAt, row.interval ? row.interval.start + " to " + row.interval.end : "unknown",
          e.value?.amount ?? breakdown(e.usage),
          row.included ? row.value?.amount ?? breakdown(row.usage) : "excluded: " + row.exclusion,
          row.phase + " / " + (row.complete ? "tracked" : "partial/unavailable")];
      })),
    "", "Cumulative snapshot; positive delta used only with a known baseline and uninterrupted counters.",
    "Reasoning included in output is a subset, not an additional token total.", "",
    "## Host counters", "", "Host counter — excluded from model-token total and model-token cost estimates.", "",
    ...table(["Host", "Scope", "Counter unit", "Known contribution"], totals.hostCounters.map(row => [row.host, row.scope, row.unit, row.amount])),
    "", "## Estimated model-token cost", "",
    "Pricing status: " + pricing.status + ". Estimates are not provider invoices.", "",
    ...table(["Events", "Estimated amount", "Currency", "Status", "Rate-card ID", "Missing classes", "Allocation assumption"],
      pricing.estimates.map(row => [row.eventIds.join(", "), money(row.amount), row.currency, row.status, row.rateCardId, row.missing.join(", ") || "none",
        row.assumption ? row.assumption.description + " (" + row.assumption.provenance.sourceUrl + "; retrieved " + row.assumption.provenance.retrievedAt + ")" : "none"])),
    "", ...table(["Currency", "Known estimated subtotal", "Status"], pricing.estimatedTotals.map(row => [row.currency, money(row.amount), row.status])),
    "", "## Provider-reported charges", "",
    ...table(["Currency", "Reported contribution", "Source events"], pricing.reportedCharges.map(row => [row.unit, money(row.amount), row.eventIds.join(", ")])),
    "", "## Credit consumption (including GitHub AI credits)", "",
    ...table(["Credit unit", "Consumed contribution", "Source events"], pricing.credits.map(row => [row.unit, row.amount, row.eventIds.join(", ")])),
    "", "Credit conversions are derived values, not model tokens or provider-reported charges.", "",
    ...table(["Events", "Converted amount", "Currency", "Rate per credit", "Source / effective / retrieved"],
      pricing.creditConversions.map(row => [row.eventIds.join(", "), money(row.amount), row.currency, row.provenance.perCredit,
        row.provenance.sourceUrl + " / " + row.provenance.effectiveAt + " / " + row.provenance.retrievedAt])),
    "", "## Plan entitlements (informational; not summed)", "",
    ...table(["Host", "Unit", "Allowance"], totals.entitlements.map(row => [row.event.host, row.event.value?.unit, row.event.value?.amount])),
    "", "## Rate-card provenance", "",
    ...table(["ID", "Provider / model", "Currency", "Context tier", "Effective", "Expires", "Retrieved", "Source", "Rates per million", "Reasoning billing"],
      pricing.rateCards.map(rate => [rate.id, rate.provider + " / " + rate.model, rate.currency,
        rate.contextTier.name + " [" + rate.contextTier.minTokens + ", " + (rate.contextTier.maxTokens ?? "unbounded") + "]",
        rate.effectiveAt, rate.expiresAt ?? "not specified", rate.retrievedAt, rate.sourceUrl,
        Object.entries(rate.perMillion).map(([key, value]) => key + "=" + value).join("; "), rate.reasoningBilling])),
    "", "## Warnings and unpriced evidence", "",
    ...[...ledger.warnings, ...totals.warnings].map(warning => "- " + text(warning.code) + " (" + text(warning.eventIds.join(", ")) + "): " + text(warning.message)),
    ...pricing.unpriced.map(row => "- Unpriced (" + text(row.eventIds.join(", ")) + "): " + text(row.reason)),
    "", "Raw payloads, transcripts, and private source paths remain local. Adapter fixtures validate mapping, not native runtime compatibility.",
  ];
  return lines.join("\n") + "\n";
}
