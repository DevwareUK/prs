import { type AdapterResult, count, inclusiveUsage, label, object, timestamp } from "./token-usage-capture-shared";

export function captureCodex(records: unknown[], sessionId: string): AdapterResult {
  const result: AdapterResult = { observations: [], warnings: [], format: "codex-response-records-v1" };
  let matched = false;
  const models = new Map<string, string>();
  for (const value of records) {
    const row = object(value), p = object(row.payload);
    if (row.type === "session_meta") {
      if (p.id !== sessionId) throw new Error("Codex source session does not match selected session");
      matched = true;
    }
    if (row.type === "turn_context" && label(p.turn_id) && label(p.model)) models.set(p.turn_id as string, p.model as string);
  }
  if (!matched) throw new Error("Codex source has no matching session metadata");
  for (const value of records) {
    const row = object(value), p = object(row.payload);
    if (row.type !== "token_usage_record") continue;
    if (p.thread_id !== sessionId) { result.warnings.push("Inherited or other-thread usage records were excluded."); continue; }
    const id = label(p.response_id);
    if (!id) throw new Error("Codex response has no stable identity");
    const u = object(p.usage), write = count(u.cache_write_input_tokens);
    // The observed Codex format has no nonzero cache-write example: fail closed.
    if (write !== undefined && write !== 0) throw new Error("Nonzero Codex cache-write semantics are not yet supported");
    result.observations.push({ id, observedAt: timestamp(row.timestamp), model: models.get(String(p.turn_id)), provider: "openai",
      usage: inclusiveUsage({ input: u.input_tokens, read: u.cached_input_tokens, write, output: u.output_tokens, reasoning: u.reasoning_output_tokens, total: u.total_tokens }) });
  }
  return result;
}
