import { z } from "zod";
import { AgentHost } from "./agent-workflow";

const id = z.string().trim().min(1);
const timestamp = z.iso.datetime({ offset: true });
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().finite().nonnegative();
const webUrl = z.url().refine(value => /^https?:\/\//i.test(value), "Expected an http(s) provenance URL");
export const TOKEN_CLASSES = ["uncachedInputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens"] as const;
export type TokenClass = typeof TOKEN_CLASSES[number];
export const TokenUsage = z.object({
  uncachedInputTokens: counter.optional(), cachedInputTokens: counter.optional(),
  cacheWriteTokens: counter.optional(), outputTokens: counter.optional(),
  reasoningTokens: counter.optional(), providerTotalTokens: counter.optional(),
}).strict();
export type TokenUsage = z.infer<typeof TokenUsage>;
const reasoning = z.enum(["included-in-output", "separate"]);
const provenance = z.object({ sourceUrl: webUrl, retrievedAt: timestamp }).strict();
const scalar = z.object({
  amount, unit: id,
  conversion: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/), perCredit: amount,
    sourceUrl: webUrl, effectiveAt: timestamp, retrievedAt: timestamp,
  }).strict().optional(),
}).strict();
const native = z.object({
  version: z.literal(1),
  format: z.enum(["codex-session", "claude-usage", "copilot-usage", "legacy-counter"]),
  inputIncludesCacheRead: z.boolean().optional(), inputIncludesCacheWrite: z.boolean().optional(),
  reasoning: reasoning.optional(),
  values: z.object({
    input_tokens: counter.optional(), cached_input_tokens: counter.optional(),
    cache_read_input_tokens: counter.optional(), cache_creation_input_tokens: counter.optional(),
    output_tokens: counter.optional(), reasoning_tokens: counter.optional(), thinking_tokens: counter.optional(),
    total_tokens: counter.optional(), tokensUsed: counter.optional(), totalTokens: counter.optional(),
    credits: amount.optional(), charge: amount.optional(),
  }).catchall(z.unknown()),
}).strict();

export const UsageRateCard = z.object({
  id, provider: id, model: id, currency: z.string().regex(/^[A-Z]{3}$/),
  effectiveAt: timestamp, retrievedAt: timestamp, expiresAt: timestamp.optional(), sourceUrl: webUrl,
  contextTier: z.object({ name: id, minTokens: counter, maxTokens: counter.optional() }).strict(),
  reasoningBilling: reasoning,
  perMillion: z.object({
    uncachedInputTokens: amount.optional(), cachedInputTokens: amount.optional(),
    cacheWriteTokens: amount.optional(), outputTokens: amount.optional(), reasoningTokens: amount.optional(),
  }).strict(),
}).strict().superRefine((rate, ctx) => {
  if (rate.expiresAt && Date.parse(rate.expiresAt) <= Date.parse(rate.effectiveAt))
    ctx.addIssue({ code: "custom", message: "Rate expiry must follow effective time" });
  if (rate.contextTier.maxTokens !== undefined && rate.contextTier.maxTokens < rate.contextTier.minTokens)
    ctx.addIssue({ code: "custom", message: "Reversed context tier" });
  if (rate.reasoningBilling === "included-in-output" && rate.perMillion.reasoningTokens !== undefined)
    ctx.addIssue({ code: "custom", message: "Included reasoning must not have a separate rate" });
});
export type UsageRateCard = z.infer<typeof UsageRateCard>;

export const UsageEvent = z.object({
  eventId: id, host: AgentHost, adapter: z.object({ name: id, version: z.literal(1) }).strict(),
  source: z.object({ id, kind: id }).strict(),
  counterScopeId: id, observedAt: timestamp,
  measurementKind: z.enum(["cumulative-snapshot", "scoped-delta", "provider-request", "host-counter"]),
  status: z.enum(["tracked", "partial", "unavailable"]), reason: id.optional(),
  workflow: z.object({ runId: id, phase: id, phaseAttemptId: id, agentId: id.optional(), parentAgentId: id.optional(), spanId: id.optional() }).strict(),
  unit: z.enum(["model-tokens", "host-counter", "credits", "currency", "entitlement"]),
  coverage: z.object({
    id, representationId: id, disjoint: z.boolean().optional(),
    authoritativeRepresentationId: id.optional(), parentRepresentationId: id.optional(),
  }).strict(),
  model: z.object({ provider: id, name: id }).strict().optional(),
  context: z.object({ tier: id, tokens: counter.optional() }).strict().optional(),
  rateCardId: id.optional(),
  hostEstimatedCost: z.object({ amount: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
  tokenSemantics: z.object({ reasoning }).strict().optional(),
  usage: TokenUsage.optional(), value: scalar.optional(), native: native.optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  interval: z.object({ start: timestamp, end: timestamp, phase: id.optional() }).strict().optional(),
  requestId: id.optional(), requestsDisjoint: z.boolean().optional(),
  reset: z.object({ segmentId: id, at: timestamp, baseline: z.literal("zero").optional() }).strict().optional(),
  baseline: z.object({ observedAt: timestamp, usage: TokenUsage.optional(), value: scalar.optional() }).strict().optional(),
  allocation: z.object({ version: z.literal(1), description: id, provenance, usage: TokenUsage }).strict().optional(),
}).strict().superRefine((event, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const payloads = [event.usage, event.value, event.native].filter(value => value !== undefined).length;
  if (event.status === "unavailable") {
    if (!event.reason || payloads || event.baseline || event.allocation) fail("Unavailable evidence requires a reason and no numeric payload");
  } else if (payloads !== 1) fail("Supply exactly one normalized or native payload");
  if (event.measurementKind === "host-counter" && event.unit !== "host-counter") fail("Host-counter observations cannot measure model tokens or credits");
  if (event.usage && (event.unit !== "model-tokens" || !event.tokenSemantics)) fail("Token payload requires model-tokens unit and explicit reasoning semantics");
  if (event.value && event.unit === "model-tokens") fail("Model tokens cannot use scalar payloads");
  if (event.value && event.unit === "host-counter" && !Number.isSafeInteger(event.value.amount)) fail("Host counter must be a safe integer");
  if (event.value && event.unit === "currency" && !/^[A-Z]{3}$/.test(event.value.unit)) fail("Currency unit must be an ISO currency code");
  if (event.value?.conversion && event.unit !== "credits") fail("Credit conversion belongs only to credits");
  if (event.interval && (Date.parse(event.interval.start) >= Date.parse(event.interval.end) || Date.parse(event.interval.end) > Date.parse(event.observedAt))) fail("Invalid interval ordering");
  if (event.status !== "unavailable" && event.measurementKind === "scoped-delta" && !event.interval) fail("Scoped deltas require an interval");
  if (event.status !== "unavailable" && event.measurementKind === "provider-request" && (!event.requestId || (!event.interval && !event.requestsDisjoint))) fail("Provider requests require stable request identity and an interval or explicit disjointness");
  if (event.hostEstimatedCost && (event.status === "unavailable" || event.unit !== "model-tokens" || event.measurementKind !== "provider-request")) fail("Host estimates belong to observed token requests, not cumulative totals or charges");
  if (event.baseline) {
    if (event.measurementKind !== "cumulative-snapshot" || Date.parse(event.baseline.observedAt) >= Date.parse(event.observedAt)) fail("Baseline must precede a cumulative observation");
    if (event.unit === "model-tokens" ? (!event.baseline.usage || !!event.baseline.value) : (!event.baseline.value || !!event.baseline.usage))
      fail("Baseline payload must match the counter unit");
    if (event.value && event.baseline.value?.unit !== event.value.unit) fail("Baseline scalar unit must agree");
  }
  if (event.reset && (event.measurementKind !== "cumulative-snapshot" || Date.parse(event.reset.at) > Date.parse(event.observedAt))) fail("Invalid reset");
  if (event.reset && event.baseline) fail("Supply a reset or a baseline, not both");
  for (const usage of [event.usage, event.baseline?.usage, event.allocation?.usage]) {
    if (!usage) continue;
    if (event.tokenSemantics?.reasoning === "included-in-output" && usage.reasoningTokens !== undefined && usage.outputTokens !== undefined && usage.reasoningTokens > usage.outputTokens)
      fail("Included reasoning exceeds output tokens");
    const keys = TOKEN_CLASSES.filter(key => key !== "reasoningTokens" || event.tokenSemantics?.reasoning === "separate");
    const known = keys.reduce((sum, key) => sum + (usage[key] ?? 0), 0);
    if (!Number.isSafeInteger(known)) fail("Token total exceeds safe integer precision");
    if (usage.providerTotalTokens !== undefined && (known > usage.providerTotalTokens || (keys.every(key => usage[key] !== undefined) && known !== usage.providerTotalTokens)))
      fail("Provider total contradicts known non-overlapping token classes");
  }
  if (event.allocation) {
    const total = event.usage?.providerTotalTokens;
    if (total === undefined || TOKEN_CLASSES.some(key => event.usage?.[key] !== undefined)) fail("Allocation requires total-only normalized evidence");
    const keys = TOKEN_CLASSES.filter(key => key !== "reasoningTokens" || event.tokenSemantics?.reasoning === "separate");
    if (!keys.every(key => event.allocation?.usage[key] !== undefined) || keys.reduce((sum, key) => sum + (event.allocation?.usage[key] ?? 0), 0) !== total)
      fail("Allocation must explicitly partition the supplied total");
  }
  if (event.native) {
    const expectedHost = { "codex-session": "codex", "claude-usage": "claude-code", "copilot-usage": "copilot", "legacy-counter": "codex" }[event.native.format];
    if (expectedHost !== event.host || event.adapter.name !== event.native.format) fail("Native adapter/host mismatch");
    if (event.unit === "model-tokens" && (event.native.inputIncludesCacheRead === undefined || event.native.inputIncludesCacheWrite === undefined || !event.native.reasoning)) fail("Native tokens require explicit input/cache/reasoning semantics");
    if (event.native.format === "legacy-counter" && event.unit !== "host-counter") fail("Legacy usage is a host counter");
  }
});
export type UsageEvent = z.infer<typeof UsageEvent>;

/** Canonical comparison is independent of JSON object key order. */
export function stableUsageJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableUsageJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + stableUsageJson(v)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
export function usageAccountingIdentity(event: UsageEvent): string {
  const accounting = { ...event }; delete accounting.raw;
  return stableUsageJson(accounting);
}
export function usagePartitionKey(event: UsageEvent): string {
  return stableUsageJson([event.host, event.source.id, event.counterScopeId, event.unit, event.value?.unit, event.model, event.coverage.id, event.coverage.representationId]);
}

export const UsageEvidence = z.object({
  version: z.literal(1), kind: z.literal("usage-evidence"), runId: id,
  events: z.array(UsageEvent).min(1), rateCards: z.array(UsageRateCard).default([]),
  capture: z.object({
    version: z.literal(1), host: AgentHost, sessionId: id,
    since: timestamp, capturedAt: timestamp, format: id,
    status: z.enum(["captured", "partial", "unavailable"]),
    scope: z.literal("selected-session-checkpoint"), warnings: z.array(id),
    // Private local binding, never included in rendered/publication output.
    sourcePath: id.optional(),
  }).strict().optional(),
}).strict().superRefine((evidence, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (evidence.capture && Date.parse(evidence.capture.since) > Date.parse(evidence.capture.capturedAt)) fail("Capture start must not follow checkpoint");
  const ids = new Map<string, string>();
  const snapshots = new Map<string, string>();
  const parents = new Map<string, string>();
  const groups = new Map<string, Set<string>>();
  const authority = new Map<string, Set<string>>();
  const representations = new Map<string, string>();
  for (const event of evidence.events) {
    if (event.workflow.runId !== evidence.runId) fail("Event runId differs from evidence runId");
    const identity = usageAccountingIdentity(event);
    if (ids.has(event.eventId) && ids.get(event.eventId) !== identity) fail("Conflicting duplicate eventId: " + event.eventId);
    ids.set(event.eventId, identity);
    const group = event.coverage.id;
    const representation = group + ":" + event.coverage.representationId;
    const declaration = stableUsageJson(event.coverage);
    if (representations.has(representation) && representations.get(representation) !== declaration) fail("Contradictory coverage declarations");
    representations.set(representation, declaration);
    groups.set(group, (groups.get(group) ?? new Set()).add(event.coverage.representationId));
    if (event.coverage.authoritativeRepresentationId)
      authority.set(group, (authority.get(group) ?? new Set()).add(event.coverage.authoritativeRepresentationId));
    if (event.coverage.parentRepresentationId) parents.set(representation, group + ":" + event.coverage.parentRepresentationId);
    if (event.measurementKind === "cumulative-snapshot") {
      const key = usagePartitionKey(event) + ":" + Date.parse(event.observedAt);
      const numeric = stableUsageJson([event.usage, event.value, event.native, event.reset, event.baseline]);
      if (snapshots.has(key) && snapshots.get(key) !== numeric) fail("Conflicting snapshots at the same time");
      snapshots.set(key, numeric);
    }
  }
  for (const [group, selections] of authority) {
    if (selections.size > 1 || [...selections].some(value => !groups.get(group)?.has(value))) fail("Unknown or conflicting coverage authority");
  }
  for (const start of parents.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = start;
    while (current) {
      if (seen.has(current)) { fail("Cyclic coverage relationship"); break; }
      seen.add(current);
      const next: string | undefined = parents.get(current);
      if (next && !representations.has(next)) fail("Unknown parent representation");
      current = next;
    }
  }
  const rateIds = new Set<string>();
  for (const rate of evidence.rateCards) {
    if (rateIds.has(rate.id)) fail("Duplicate rate-card ID");
    rateIds.add(rate.id);
  }
});
export type UsageEvidence = z.infer<typeof UsageEvidence>;
