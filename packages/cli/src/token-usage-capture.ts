import { UsageEvidence, UsageEvent, stableUsageJson, TOKEN_CLASSES } from "@prs/contracts";
import { captureCodex } from "./token-usage-capture-codex";
import { captureClaude } from "./token-usage-capture-claude";
import { captureCopilot } from "./token-usage-capture-copilot";
import { type CaptureObservation, label, timestamp } from "./token-usage-capture-shared";

export type CaptureOptions = { host: UsageEvent["host"]; sessionId: string; runId: string; since: string; capturedAt: string; warnings?: string[] };
export function captureUsage(records: unknown[], options: CaptureOptions): UsageEvidence {
  const { host, sessionId, runId } = options;
  if (!label(sessionId)) throw new Error("Invalid capture session identity");
  const since = timestamp(options.since), capturedAt = timestamp(options.capturedAt);
  if (since > capturedAt) throw new Error("Capture start must not follow checkpoint");
  const adapters = { codex: captureCodex, "claude-code": captureClaude, copilot: captureCopilot };
  const result = records.length ? adapters[host](records, sessionId) : { observations: [], warnings: [], format: "not-connected" };
  const warnings = [...(options.warnings ?? []), ...result.warnings];
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
  const events: UsageEvent[] = [...unique.values()].filter(row => row.observedAt > since).sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id)).map(row => {
    const complete = TOKEN_CLASSES.filter(k => k !== "reasoningTokens").every(k => row.usage[k] !== undefined);
    if (!row.model) warnings.push("Actual model identity is unavailable for some requests.");
    return UsageEvent.parse({ ...common, eventId: host + ":" + sessionId + ":" + row.id, requestId: row.id, requestsDisjoint: true,
      observedAt: row.observedAt, measurementKind: "provider-request", status: complete ? "tracked" : "partial",
      usage: row.usage, tokenSemantics: { reasoning: "included-in-output" },
      model: row.model ? { provider: row.provider, name: row.model } : undefined, hostEstimatedCost: row.hostEstimatedCost });
  });
  if (!events.length) {
    warnings.push("No supported usage records for the selected session and checkpoint range; check source setup, identity and format.");
    events.push(UsageEvent.parse({ ...common, eventId: host + ":" + sessionId + ":unavailable", observedAt: capturedAt,
      measurementKind: "cumulative-snapshot", status: "unavailable", reason: "No supported native usage records in the selected range." }));
  }
  const status = events.every(e => e.status === "unavailable") ? "unavailable" : warnings.length || events.some(e => e.status === "partial") ? "partial" : "captured";
  return UsageEvidence.parse({ version: 1, kind: "usage-evidence", runId, events,
    capture: { version: 1, host, sessionId, since, capturedAt, format: result.format, status, scope: "selected-session-checkpoint", warnings: [...new Set(warnings)] } });
}
