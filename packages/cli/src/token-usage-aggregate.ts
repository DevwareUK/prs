import {
  UsageEvidence, UsageEvent, TOKEN_CLASSES, stableUsageJson, usagePartitionKey,
  type TokenClass, type TokenUsage,
} from "@prs/contracts";
import type { UsageWarning } from "./token-usage-normalize";

export type UsageContribution = {
  event: UsageEvent; eventIds: string[]; included: boolean; exclusion?: string;
  phase: string; interval?: { start: string; end: string };
  usage?: TokenUsage; value?: UsageEvent["value"]; complete: boolean;
};
export type ScalarTotal = { unit: string; amount: number; eventIds: string[]; scope?: string; host?: string };
export type UsageAggregation = {
  events: UsageEvent[]; contributions: UsageContribution[]; warnings: UsageWarning[];
  modelTokens: { totalTokens: number | null; knownTokens: Record<TokenClass | "providerTotalTokens", number | null>; status: "tracked" | "partial" | "unavailable"; exclusions: string[] };
  hostCounters: ScalarTotal[]; charges: ScalarTotal[]; credits: ScalarTotal[];
  entitlements: UsageContribution[];
};
const numericKeys = [...TOKEN_CLASSES, "providerTotalTokens"] as const;
const chronological = (a: UsageEvent, b: UsageEvent) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.eventId.localeCompare(b.eventId);
const applicable = (event: UsageEvent) => TOKEN_CLASSES.filter(key => key !== "reasoningTokens" || event.tokenSemantics?.reasoning === "separate");
function complete(event: UsageEvent, usage?: TokenUsage): boolean {
  return event.status === "tracked" && (event.unit !== "model-tokens" || applicable(event).every(key => usage?.[key] !== undefined));
}
function checkedSum(a: number, b: number, integer: boolean): number {
  const sum = a + b;
  if (!Number.isFinite(sum) || (integer && !Number.isSafeInteger(sum))) throw new Error("Usage aggregation exceeds numeric precision");
  return sum;
}

/** Stateless accounting: IDs deduplicate observations, not phases or publication targets. */
export function aggregateUsageEvents(input: UsageEvent[]): UsageAggregation {
  if (!input.length) throw new Error("At least one usage observation is required");
  const validated = UsageEvidence.parse({ version: 1, kind: "usage-evidence", runId: input[0].workflow.runId, events: input }).events;
  if (validated.some(event => event.native)) throw new Error("Normalize native evidence before aggregation");
  const unique = new Map<string, UsageEvent>();
  for (const event of [...validated].sort((a, b) => stableUsageJson(a).localeCompare(stableUsageJson(b)))) {
    if (!unique.has(event.eventId)) unique.set(event.eventId, event);
  }
  const events = [...unique.values()].sort(chronological);
  const warnings: UsageWarning[] = [];
  const contributions: UsageContribution[] = [];
  const warn = (code: string, eventIds: string[], message: string) => warnings.push({ code, eventIds, message });
  const exclude = (row: UsageContribution, code: string, message: string) => {
    row.included = false; row.exclusion = code; row.complete = false;
    warn(code, row.eventIds, message);
  };
  const partitions = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const key = usagePartitionKey(event);
    partitions.set(key, [...(partitions.get(key) ?? []), event]);
  }
  for (const partition of partitions.values()) {
    let previous: UsageEvent | undefined;
    const seenRequests = new Map<string, UsageEvent>();
    for (const event of partition) {
      if (event.measurementKind === "provider-request" && event.requestId) {
        const prior = seenRequests.get(event.requestId);
        if (prior) {
          if (stableUsageJson([prior.usage, prior.value, prior.interval, prior.model, prior.rateCardId, prior.tokenSemantics]) !== stableUsageJson([event.usage, event.value, event.interval, event.model, event.rateCardId, event.tokenSemantics]))
            throw new Error("Conflicting evidence for the same provider request");
          continue;
        }
        seenRequests.set(event.requestId, event);
      }
      const row: UsageContribution = { event, eventIds: [event.eventId], included: true,
        phase: event.interval?.phase ?? event.workflow.phase, interval: event.interval,
        usage: event.usage, value: event.value, complete: complete(event, event.usage) };
      contributions.push(row);
      if (event.status === "unavailable") {
        exclude(row, "unavailable", "Native usage is unavailable; no zero has been substituted.");
        continue;
      }
      if (event.measurementKind !== "cumulative-snapshot") continue;
      let baseline = previous ? { observedAt: previous.observedAt, usage: previous.usage, value: previous.value } : event.baseline;
      if (event.reset) {
        if (previous && Date.parse(event.reset.at) <= Date.parse(previous.observedAt)) throw new Error("Reset must follow the previous observation");
        baseline = event.reset.baseline === "zero" ? {
          observedAt: event.reset.at,
          usage: event.usage ? Object.fromEntries(numericKeys.filter(key => event.usage?.[key] !== undefined).map(key => [key, 0])) : undefined,
          value: event.value ? { ...event.value, amount: 0 } : undefined,
        } : undefined;
      } else if (previous && event.baseline && stableUsageJson(event.baseline) !== stableUsageJson(baseline)) {
        throw new Error("Later snapshot baseline conflicts with the preceding observation");
      }
      const priorPhase = previous?.workflow.phase;
      const priorSemantics = previous?.tokenSemantics;
      previous = event;
      if (!baseline) {
        row.usage = undefined; row.value = undefined;
        exclude(row, "missing-baseline", "Cumulative state is unattributed; later monotonic differences may contribute.");
        continue;
      }
      row.interval = { start: baseline.observedAt, end: event.observedAt };
      row.phase = priorPhase && priorPhase !== event.workflow.phase ? "shared/unattributed" : event.interval?.phase ?? event.workflow.phase;
      if (priorSemantics && stableUsageJson(priorSemantics) !== stableUsageJson(event.tokenSemantics)) {
        row.usage = undefined; row.value = undefined;
        exclude(row, "counter-semantics-change", "Counter semantics changed; this transition cannot be differenced.");
        continue;
      }
      const decreased = event.usage
        ? numericKeys.some(key => event.usage?.[key] !== undefined && baseline.usage?.[key] !== undefined && event.usage[key]! < baseline.usage[key]!)
        : event.value !== undefined && baseline.value !== undefined && event.value.amount < baseline.value.amount;
      if (decreased) {
        row.usage = undefined; row.value = undefined;
        exclude(row, "counter-decrease", "Counter decreased without a zero reset; the gap is excluded.");
        continue;
      }
      if (event.usage) row.usage = Object.fromEntries(numericKeys.filter(key => event.usage?.[key] !== undefined && baseline.usage?.[key] !== undefined)
        .map(key => [key, event.usage![key]! - baseline.usage![key]!]));
      if (event.value) row.value = baseline.value ? { ...event.value, amount: event.value.amount - baseline.value.amount } : undefined;
      // Monotonic source counters can still contradict each other after differencing.
      UsageEvent.parse({ ...event, usage: row.usage, value: row.value, baseline: undefined, reset: undefined, allocation: undefined });
      row.complete = complete(event, row.usage);
      if (!row.complete) warn("partial-delta", row.eventIds, "Only token classes known at both endpoints were differenced.");
    }
  }
  contributions.sort((a, b) => chronological(a.event, b.event));
  // Different representations of the same coverage cannot both count.
  const groups = new Map<string, UsageContribution[]>();
  const unitKey = (row: UsageContribution) => stableUsageJson([row.event.unit, row.event.value?.unit]);
  for (const row of contributions) {
    const key = stableUsageJson([row.event.coverage.id, unitKey(row)]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values()) {
    const active = rows.filter(row => row.included);
    const representations = new Set(active.map(row => row.event.coverage.representationId));
    const authority = rows.map(row => row.event.coverage.authoritativeRepresentationId).find(Boolean);
    if (authority || representations.size > 1) for (const row of active) {
      if (!authority || row.event.coverage.representationId !== authority)
        exclude(row, authority ? "covered-by-authority" : "unresolved-overlap", authority ? "Excluded overlapping representation; authoritative coverage is used." : "Overlapping representations have no declared authority.");
    }
  }
  const activeGroups = [...groups.values()].filter(rows => rows.some(row => row.included));
  const comparableUnits = new Set(activeGroups.map(rows => unitKey(rows[0])));
  for (const unit of comparableUnits) {
    const comparable = activeGroups.filter(rows => unitKey(rows[0]) === unit);
    if (comparable.length > 1 && comparable.some(rows => rows.some(row => row.included && !row.event.coverage.disjoint))) {
      for (const rows of comparable) for (const row of rows.filter(row => row.included))
        exclude(row, "unresolved-scope-overlap", "Independent scopes were not all declared disjoint.");
    }
  }
  // Half-open interval intersections detect snapshots mixed with scoped/request evidence.
  for (const rows of groups.values()) {
    const candidates = rows.filter(row => row.included && row.event.unit !== "entitlement");
    const conflicts = new Set<UsageContribution>();
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      if (a.event.unit !== b.event.unit || a.event.value?.unit !== b.event.value?.unit) continue;
      const independentRequests = a.event.measurementKind === "provider-request" && b.event.measurementKind === "provider-request" &&
        a.event.requestsDisjoint && b.event.requestsDisjoint && a.event.requestId !== b.event.requestId;
      if (independentRequests) continue;
      const overlaps = !a.interval || !b.interval ||
        (Date.parse(a.interval.start) < Date.parse(b.interval.end) && Date.parse(b.interval.start) < Date.parse(a.interval.end));
      if (overlaps) { conflicts.add(a); conflicts.add(b); }
    }
    for (const row of conflicts) exclude(row, "overlapping-interval", "Additive intervals overlap or lack disjoint coverage.");
  }
  const modelRows = contributions.filter(row => row.event.unit === "model-tokens");
  const includedTokens = modelRows.filter(row => row.included && row.usage);
  const knownTokens = Object.fromEntries(numericKeys.map(key => [key, null])) as UsageAggregation["modelTokens"]["knownTokens"];
  let totalTokens: number | null = null;
  for (const row of includedTokens) {
    for (const key of numericKeys) if (row.usage![key] !== undefined)
      knownTokens[key] = checkedSum(knownTokens[key] ?? 0, row.usage![key]!, true);
    const keys = applicable(row.event);
    const known = keys.filter(key => row.usage![key] !== undefined);
    const total = row.usage!.providerTotalTokens ?? (known.length ? known.reduce((sum, key) => checkedSum(sum, row.usage![key]!, true), 0) : null);
    if (total !== null) totalTokens = checkedSum(totalTokens ?? 0, total, true);
  }
  const scalarTotals = (unit: UsageEvent["unit"]): ScalarTotal[] => {
    const totals = new Map<string, ScalarTotal>();
    for (const row of contributions.filter(row => row.included && row.event.unit === unit && row.value)) {
      const key = unit === "host-counter" ? stableUsageJson([row.event.host, row.event.source.id, row.event.counterScopeId, row.value!.unit]) : row.value!.unit;
      const prior = totals.get(key);
      totals.set(key, { unit: row.value!.unit, amount: checkedSum(prior?.amount ?? 0, row.value!.amount, unit === "host-counter"),
        eventIds: [...(prior?.eventIds ?? []), ...row.eventIds],
        ...(unit === "host-counter" ? { scope: row.event.counterScopeId, host: row.event.host } : {}) });
    }
    return [...totals.values()];
  };
  return {
    events, contributions, warnings,
    modelTokens: { totalTokens, knownTokens, status: totalTokens === null ? "unavailable" : modelRows.some(row => !row.complete) ? "partial" : "tracked",
      exclusions: modelRows.filter(row => !row.included).flatMap(row => row.eventIds) },
    hostCounters: scalarTotals("host-counter"), charges: scalarTotals("currency"), credits: scalarTotals("credits"),
    entitlements: contributions.filter(row => row.event.unit === "entitlement"),
  };
}
