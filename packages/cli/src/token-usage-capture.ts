import { UsageEvidence, UsageEvent, UsageRateCard, stableUsageJson, TOKEN_CLASSES } from "@prs/contracts";
import { captureCodex } from "./token-usage-capture-codex";
import { captureClaude } from "./token-usage-capture-claude";
import { captureCopilot } from "./token-usage-capture-copilot";
import { type CaptureObservation, label, timestamp } from "./token-usage-capture-shared";
import { resolveUsageRate } from "./token-usage-rate-catalog";

export type CaptureOptions = {
  host: UsageEvent["host"];
  sessionId: string;
  runId: string;
  since: string;
  capturedAt: string;
  warnings?: string[];
  prior?: Pick<UsageEvidence, "events" | "rateCards">;
};
export function captureUsage(records: unknown[], options: CaptureOptions): UsageEvidence {
  const { host, sessionId, runId } = options;
  if (!label(sessionId)) throw new Error("Invalid capture session identity");
  const since = timestamp(options.since), capturedAt = timestamp(options.capturedAt);
  if (since > capturedAt) throw new Error("Capture start must not follow checkpoint");
  const adapters = { codex: captureCodex, "claude-code": captureClaude, copilot: captureCopilot };
  const result = records.length ? adapters[host](records, sessionId) : { observations: [], warnings: [], format: "not-connected" };
  const warnings = [...(options.warnings ?? []), ...result.warnings];
  let pricingWarningCount = 0;
  const unique = new Map<string, CaptureObservation>();
  for (const row of result.observations) {
    if (row.observedAt > capturedAt) continue;
    const prior = unique.get(row.id);
    if (prior) {
      const identity = (o: CaptureObservation) => stableUsageJson([o.model, o.provider, o.usage, o.hostEstimatedCost]);
      if (identity(prior) === identity(row)) continue;
      const outputOnlyGrowth = row.growing && prior.growing && row.observedAt >= prior.observedAt && row.model === prior.model &&
        stableUsageJson({ ...row.usage, outputTokens: undefined, reasoningTokens: undefined }) === stableUsageJson({ ...prior.usage, outputTokens: undefined, reasoningTokens: undefined }) &&
        (row.usage.outputTokens ?? -1) >= (prior.usage.outputTokens ?? -1) && (row.usage.reasoningTokens ?? -1) >= (prior.usage.reasoningTokens ?? -1);
      if (!outputOnlyGrowth) throw new Error("Conflicting native response identity");
    }
    unique.set(row.id, row);
  }
  const common = { host, adapter: { name: result.format, version: 1 as const }, source: { id: sessionId, kind: "host-session" }, counterScopeId: sessionId,
    workflow: { runId, phase: "capture", phaseAttemptId: "capture:1", agentId: sessionId }, unit: "model-tokens" as const,
    coverage: { id: host + ":" + sessionId, representationId: "responses", disjoint: true } };
  const priorEvents = new Map((options.prior?.events ?? []).map(event => [event.eventId, event]));
  const rateCards = new Map<string, UsageRateCard>();
  const addRate = (rate: UsageRateCard) => {
    const validated = UsageRateCard.parse(rate), previous = rateCards.get(validated.id);
    if (previous && stableUsageJson(previous) !== stableUsageJson(validated)) throw new Error("Conflicting rate-card snapshots share an ID");
    rateCards.set(validated.id, validated);
  };
  for (const rate of options.prior?.rateCards ?? []) addRate(rate);
  const events: UsageEvent[] = [...unique.values()].filter(row => row.observedAt > since).sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id)).map(row => {
    const complete = TOKEN_CLASSES.filter(k => k !== "reasoningTokens").every(k => row.usage[k] !== undefined);
    const eventId = host + ":" + sessionId + ":" + row.id;
    const prior = priorEvents.get(eventId);
    if (!row.model && !prior?.model) warnings.push("Actual model identity is unavailable for some requests.");
    let pricing: Pick<UsageEvent, "model" | "context" | "rateCardId" | "raw"> = {};
    if (prior) {
      if (row.model) {
        const priorNativeModel = typeof prior.raw?.nativeModel === "string" ? prior.raw.nativeModel : prior.model?.name;
        if (priorNativeModel !== row.model) throw new Error("Conflicting captured model identity");
      }
      pricing = { model: prior.model, context: prior.context, rateCardId: prior.rateCardId, raw: prior.raw };
    } else if (row.model) {
      const resolution = resolveUsageRate({ host, provider: row.provider, model: row.model, usage: row.usage, observedAt: row.observedAt });
      if (resolution.status === "resolved") {
        addRate(resolution.rateCard);
        pricing = {
          model: resolution.model,
          context: resolution.context,
          rateCardId: resolution.rateCard.id,
          ...(resolution.model.name === row.model ? {} : { raw: { nativeModel: row.model } }),
        };
      } else {
        pricing = { model: { provider: row.provider, name: row.model } };
        warnings.push(resolution.reason);
        pricingWarningCount++;
      }
    }
    return UsageEvent.parse({ ...common, eventId, requestId: row.id, requestsDisjoint: true,
      observedAt: row.observedAt, measurementKind: "provider-request", status: complete ? "tracked" : "partial",
      usage: row.usage, tokenSemantics: { reasoning: "included-in-output" },
      ...pricing, hostEstimatedCost: row.hostEstimatedCost });
  });
  if (!events.length) {
    warnings.push("No supported usage records for the selected session and checkpoint range; check source setup, identity and format.");
    events.push(UsageEvent.parse({ ...common, eventId: host + ":" + sessionId + ":unavailable", observedAt: capturedAt,
      measurementKind: "cumulative-snapshot", status: "unavailable", reason: "No supported native usage records in the selected range." }));
  }
  const status = events.every(e => e.status === "unavailable") ? "unavailable" : warnings.length > pricingWarningCount || events.some(e => e.status === "partial") ? "partial" : "captured";
  return UsageEvidence.parse({ version: 1, kind: "usage-evidence", runId, events, rateCards: [...rateCards.values()],
    capture: { version: 1, host, sessionId, since, capturedAt, format: result.format, status, scope: "selected-session-checkpoint", warnings: [...new Set(warnings)] } });
}
