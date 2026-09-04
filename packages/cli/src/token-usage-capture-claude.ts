import { type AdapterResult, attributes, estimate, exclusiveUsage, label, object, otelTime, telemetry, timestamp } from "./token-usage-capture-shared";

export function captureClaude(records: unknown[], sessionId: string): AdapterResult {
  const result: AdapterResult = { observations: [], warnings: [], format: "claude-transcript-v1" };
  const logs = telemetry(records, "Logs");
  if (logs.length) {
    result.format = "claude-otlp-logs-v1";
    for (const row of logs) {
      const a = attributes(row.attributes);
      if (a["session.id"] !== sessionId || !["api_request", "claude_code.api_request"].includes(String(a["event.name"]))) continue;
      const id = label(a.request_id) ?? label(a.client_request_id);
      if (!id) throw new Error("Claude API request has no stable identity");
      result.observations.push({ id, observedAt: a["event.timestamp"] ? timestamp(a["event.timestamp"]) : otelTime(row.timeUnixNano), provider: "anthropic", model: label(a.model),
        usage: exclusiveUsage({ input: a.input_tokens, read: a.cache_read_tokens, write: a.cache_creation_tokens, output: a.output_tokens }), hostEstimatedCost: estimate(a.cost_usd) });
    }
    return result;
  }
  for (const value of records) {
    const row = object(value), message = object(row.message);
    if (row.type !== "assistant" || row.sessionId !== sessionId) continue;
    if (row.isSidechain === true) { result.warnings.push("Sidechain usage was excluded; subagent coverage is not established."); continue; }
    // Synthetic/injected assistant messages are not provider requests.
    if (message.model === "<synthetic>") continue;
    const id = label(message.id);
    if (!id || !message.usage) throw new Error("Claude assistant response lacks usage or stable message identity");
    const u = object(message.usage);
    result.observations.push({ id, observedAt: timestamp(row.timestamp), provider: "anthropic", model: label(message.model), growing: true,
      usage: exclusiveUsage({ input: u.input_tokens, read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens, output: u.output_tokens, reasoning: object(u.output_tokens_details).thinking_tokens }) });
  }
  return result;
}
