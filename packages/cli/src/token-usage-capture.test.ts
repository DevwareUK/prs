import { describe, expect, it } from "vitest";
import { UsageEvent, UsageEvidence } from "@prs/contracts";
import { parsePrsToolCommandArgs } from "./prs-tool-command";
import { aggregateUsageEvents } from "./token-usage-aggregate";
import { captureUsage } from "./token-usage-capture";

const at = "2026-09-04T10:00:01Z", since = "2026-09-04T10:00:00Z", now = "2026-09-04T10:01:00Z";
const options = { host: "codex" as const, sessionId: "session-1", runId: "run-1", since, capturedAt: now };
const usage = { input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 3, total_tokens: 110 };
const codex = (id = "response-1", tokens = usage) => ({ type: "token_usage_record", timestamp: at, payload: { thread_id: "session-1", response_id: id, turn_id: "turn-1", usage: tokens } });
const meta = { type: "session_meta", payload: { id: "session-1", timestamp: since, cli_version: "0.153.0-alpha.5" } };
const context = { type: "turn_context", payload: { model: "gpt-test", turn_id: "turn-1" } };
const claude = (id = "message-1") => ({ type: "assistant", sessionId: "session-1", timestamp: at, uuid: "block-1", message: { id, model: "claude-test", content: [{ text: "SECRET_PROMPT" }], usage: { input_tokens: 20, cache_read_input_tokens: 60, cache_creation_input_tokens: 10, output_tokens: 5, output_tokens_details: { thinking_tokens: 2 } } } });
const attrs = (data: Record<string, string | number>) => Object.entries(data).map(([key, value]) => ({ key, value: typeof value === "number" ? { intValue: String(value) } : { stringValue: value } }));
const span = (id = "span-1", operation = "chat") => ({ traceId: "trace-1", spanId: id, name: "chat test", startTimeUnixNano: "1788516000000000000", endTimeUnixNano: "1788516001000000000", attributes: attrs({ "gen_ai.operation.name": operation, "gen_ai.conversation.id": "session-1", "gen_ai.response.id": "response-" + id, "gen_ai.response.model": "copilot-test", "gen_ai.provider.name": "github", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 10, "gen_ai.usage.cache_read.input_tokens": 60, "gen_ai.usage.cache_creation.input_tokens": 10, "github.copilot.cost": 1 }) });
const otlp = (spans = [span()]) => ({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: "github.copilot" }, spans }] }] });
const total = (evidence: UsageEvidence) => aggregateUsageEvents(evidence.events).modelTokens;

describe("native usage capture", () => {
  it("replays the recorded Codex probe totals without model calls", () => {
    // Sanitized from the authorized 2026-09-04 probe (0.153.0-alpha.5).
    // IDs are synthetic; counts retain the seven observed response records.
    const values = [[28714,18432,274,0],[33403,28544,131,0],[35699,33280,336,121],[36091,35584,73,0],[36652,35968,170,0],[36878,36480,189,0],[37743,36736,93,0]];
    const rows = values.map(([input, cached, output, reasoning], i) => codex("probe-" + i, { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output }));
    const first = captureUsage([meta, context, ...rows], options);
    const replay = captureUsage([meta, context, ...rows, ...rows], options);
    expect(total(first)).toEqual(total(replay));
    expect(total(first)).toMatchObject({ totalTokens: 246446, knownTokens: { uncachedInputTokens: 20156, cachedInputTokens: 225024, cacheWriteTokens: 0, outputTokens: 1266, reasoningTokens: 121 } });
  });
  it("accepts individual Copilot span wrappers and rejects invalid telemetry numbers", () => {
    for (const row of [span(), { type: "span", ...span() }, { type: "span", data: span() }]) {
      expect(total(captureUsage([row], { ...options, host: "copilot" })).totalTokens).toBe(110);
    }
    const bad = span();
    bad.attributes.push({ key: "invalid", value: { intValue: " " } });
    expect(() => captureUsage([bad], { ...options, host: "copilot" })).toThrow(/integer/);
  });
  it("counts actual response usage, not repeated cumulative/goal counters, and drops private content", () => {
    const result = captureUsage([meta, context, codex(), codex(), { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 9999 } } } }], options);
    expect(total(result).totalTokens).toBe(110);
    expect(total(result).knownTokens).toMatchObject({ uncachedInputTokens: 40, cachedInputTokens: 60, outputTokens: 10, reasoningTokens: 3 });
    expect(result.events).toHaveLength(1);
    expect(result.capture?.status).toBe("captured");
  });
  it("deduplicates Claude content blocks by message ID, not transcript UUID", () => {
    const result = captureUsage([claude(), { ...claude(), uuid: "block-2" }], { ...options, host: "claude-code" });
    expect(total(result).totalTokens).toBe(95);
    expect(JSON.stringify(result)).not.toContain("SECRET_PROMPT");
    expect(result.events).toHaveLength(1);
  });
  it("uses final growing Claude usage once and refuses non-monotonic corrections", () => {
    const first = claude(), last = claude(); first.message.usage.output_tokens = 2;
    expect(total(captureUsage([first, last], { ...options, host: "claude-code" })).totalTokens).toBe(95);
    const bad = claude(); bad.message.usage.cache_read_input_tokens = 59;
    expect(() => captureUsage([last, bad], { ...options, host: "claude-code" })).toThrow(/conflict/i);
  });
  it("captures Copilot chat spans without adding parent spans, metric histograms or replays", () => {
    const result = captureUsage([otlp([span(), span(), span("parent", "invoke_agent")])], { ...options, host: "copilot" });
    expect(total(result).totalTokens).toBe(110);
    expect(total(result).knownTokens).toMatchObject({ uncachedInputTokens: 30, cachedInputTokens: 60, cacheWriteTokens: 10 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].hostEstimatedCost).toBeUndefined();
    expect(result.capture?.warnings.join(" ")).toMatch(/currency/);
  });
  it("reads Claude OTLP request logs with host estimated cost kept separate", () => {
    const records = [{ resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: "1788516001000000000", attributes: attrs({ "event.name": "api_request", "session.id": "session-1", request_id: "req-1", model: "claude-test", input_tokens: 20, output_tokens: 5, cache_read_tokens: 60, cache_creation_tokens: 10, cost_usd: 1 }) }] }] }] }];
    const result = captureUsage(records, { ...options, host: "claude-code" });
    expect(total(result).totalTokens).toBe(95);
    expect(result.events[0].hostEstimatedCost?.amount).toBe(1);
    expect(aggregateUsageEvents(result.events).charges).toEqual([]);
  });
  it("filters completed records at the retained start boundary and handles model changes without overlapping counters", () => {
    const earlier = { ...codex("earlier"), timestamp: since };
    const result = captureUsage([meta, context, earlier, codex(), { ...context, payload: { model: "gpt-other", turn_id: "turn-2" } }, { ...codex("response-2"), payload: { ...codex("response-2").payload, turn_id: "turn-2" } }], options);
    expect(total(result).totalTokens).toBe(220);
    expect(result.events.map(e => e.model?.name)).toEqual(["gpt-test", "gpt-other"]);
  });
  it("refuses conflicting response identities, wrong Codex session headers and invalid numeric values", () => {
    expect(() => captureUsage([meta, context, codex(), codex("response-1", { ...usage, output_tokens: 11, total_tokens: 111 })], options)).toThrow(/conflict/i);
    expect(() => captureUsage([{ ...meta, payload: { ...meta.payload, id: "other" } }, context, codex()], options)).toThrow(/session/i);
    expect(() => captureUsage([meta, context, codex("bad", { ...usage, cached_input_tokens: 101 })], options)).toThrow();
  });
  it("does not invent missing cache classes or consume another session", () => {
    const missing = { ...usage, cached_input_tokens: undefined, cache_write_input_tokens: undefined };
    const result = captureUsage([meta, context, codex("partial", missing as unknown as typeof usage)], options);
    expect(total(result).status).toBe("partial");
    expect(total(result).knownTokens.cachedInputTokens).toBeNull();
    const other = { ...claude(), sessionId: "other" };
    expect(total(captureUsage([other], { ...options, host: "claude-code" })).totalTokens).toBeNull();
  });
  it("marks unsupported legacy-only captures unavailable rather than declaring zero", () => {
    const result = captureUsage([meta, { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage } } }], options);
    expect(result.capture?.status).toBe("unavailable");
    expect(total(result).totalTokens).toBeNull();
  });
});

describe("capture command and evidence contract", () => {
  it("rejects invalid capture metadata and host estimates on non-request totals", () => {
    const evidence = captureUsage([meta, context, codex()], options);
    expect(UsageEvidence.safeParse({ ...evidence, capture: { ...evidence.capture, since: "2026-09-05T00:00:00Z" } }).success).toBe(false);
    for (const hostEstimatedCost of [{ amount: -1, currency: "USD" }, { amount: 1, currency: "unknown" }]) {
      expect(UsageEvent.safeParse({ ...evidence.events[0], hostEstimatedCost }).success).toBe(false);
    }
    expect(UsageEvent.safeParse({ ...evidence.events[0], measurementKind: "cumulative-snapshot", hostEstimatedCost: { amount: 1, currency: "USD" } }).success).toBe(false);
  });
  it("requires a host and local output, retaining explicit source/session/boundary", () => {
    expect(parsePrsToolCommandArgs(["token-usage", "capture", "--host", "codex", "--session", "session-1", "--source", "/tmp/source.jsonl", "--since", since, "--output", ".prs/runs/run-1/usage-evidence.json", "--json"]))
      .toMatchObject({ kind: "token-usage-capture", host: "codex", sessionId: "session-1", sourcePath: "/tmp/source.jsonl", since });
    for (const flags of [["--host", "other"], ["--host", "codex", "--host", "codex"], ["--host", "codex", "--since", "today"]]) {
      expect(() => parsePrsToolCommandArgs(["token-usage", "capture", ...flags, "--output", "a", "--json"])).toThrow();
    }
  });
  it("allows duration-free request evidence only with independent stable requests, never fabricated intervals", () => {
    const event = { eventId: "r", host: "codex", adapter: { name: "capture", version: 1 }, source: { id: "s", kind: "host" }, counterScopeId: "s", observedAt: at,
      measurementKind: "provider-request", status: "tracked", workflow: { runId: "r", phase: "capture", phaseAttemptId: "1" }, unit: "model-tokens", coverage: { id: "s", representationId: "responses" },
      requestId: "r", requestsDisjoint: true, usage: { uncachedInputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 }, tokenSemantics: { reasoning: "included-in-output" } };
    expect(UsageEvent.safeParse(event).success).toBe(true);
    expect(UsageEvent.safeParse({ ...event, requestsDisjoint: false }).success).toBe(false);
  });
});
