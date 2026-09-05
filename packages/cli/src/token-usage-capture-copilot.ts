import { type AdapterResult, attributes, inclusiveUsage, label, object, otelTime, telemetry } from "./token-usage-capture-shared";

export function captureCopilot(records: unknown[], sessionId: string): AdapterResult {
  const result: AdapterResult = { observations: [], warnings: [], format: "copilot-otel-spans-v1" };
  for (const row of telemetry(records, "Spans")) {
    const a = attributes(row.attributes);
    if (a["gen_ai.operation.name"] !== "chat" || a["gen_ai.conversation.id"] !== sessionId) continue;
    const spanId = label(row.spanId) ?? label(object(row.spanContext).spanId);
    const traceId = label(row.traceId) ?? label(object(row.spanContext).traceId);
    const id = label(a["gen_ai.response.id"]) ?? (spanId && traceId ? traceId + ":" + spanId : undefined);
    if (!id) throw new Error("Copilot chat span has no stable identity");
    if (a["github.copilot.cost"] !== undefined) result.warnings.push("Copilot host cost was not priced: the supported span schema does not declare its currency.");
    if (!label(a["gen_ai.response.model"]) && label(a["gen_ai.request.model"])) result.warnings.push("Some Copilot model labels are requested models; resolved model identity was not exposed.");
    result.observations.push({ id, observedAt: otelTime(row.endTimeUnixNano ?? row.endTime), provider: label(a["gen_ai.provider.name"]) ?? "github-copilot", model: label(a["gen_ai.response.model"]) ?? label(a["gen_ai.request.model"]),
      usage: inclusiveUsage({ input: a["gen_ai.usage.input_tokens"], read: a["gen_ai.usage.cache_read.input_tokens"], write: a["gen_ai.usage.cache_creation.input_tokens"], output: a["gen_ai.usage.output_tokens"] }) });
  }
  return result;
}
