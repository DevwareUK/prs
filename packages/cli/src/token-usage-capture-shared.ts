import type { TokenUsage, UsageEvent } from "@prs/contracts";

export type RecordValue = Record<string, unknown>;
export const object = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function label(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.:/+-]{1,256}$/.test(value) ? value : undefined;
}
export function count(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid native token counter");
  return value;
}
export function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Missing or invalid native observation timestamp");
  return new Date(value).toISOString();
}
export function otelTime(value: unknown): string {
  if (Array.isArray(value) && value.length === 2 && value.every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) return new Date(value[0] * 1000 + Math.floor(value[1] / 1e6)).toISOString();
  if (typeof value === "string" && /^\d{16,22}$/.test(value)) return new Date(Number(BigInt(value) / 1000000n)).toISOString();
  return timestamp(value);
}
export function attributes(value: unknown): RecordValue {
  if (!Array.isArray(value)) return object(value);
  const out: RecordValue = {};
  for (const entry of value) {
    const a = object(entry), v = object(a.value);
    if (typeof a.key !== "string") continue;
    if (Object.hasOwn(out, a.key)) throw new Error("Duplicate telemetry attribute");
    if (v.intValue !== undefined && !(typeof v.intValue === "number" && Number.isSafeInteger(v.intValue)) && !(typeof v.intValue === "string" && /^-?\d+$/.test(v.intValue))) throw new Error("Invalid telemetry integer");
    out[a.key] = v.stringValue ?? v.doubleValue ?? (v.intValue === undefined ? v.boolValue : Number(v.intValue));
  }
  return out;
}
/** Supported OTLP JSON exports plus the file exporter's individual span records. */
export function telemetry(records: unknown[], signal: "Spans" | "Logs"): RecordValue[] {
  const out: RecordValue[] = [];
  for (const value of records) {
    const root = object(value);
    for (const resource of array(root["resource" + signal])) {
      for (const scope of array(object(resource)["scope" + signal])) {
        for (const item of array(object(scope)[signal === "Spans" ? "spans" : "logRecords"])) out.push(object(item));
      }
    }
    if (signal === "Spans") {
      const row = root.type === "span" && root.data ? object(root.data) : root;
      if (row.attributes && (row.spanId || object(row.spanContext).spanId)) out.push(row);
    }
  }
  return out;
}
export type CaptureObservation = {
  id: string; observedAt: string; model?: string; provider: string; usage: TokenUsage;
  hostEstimatedCost?: UsageEvent["hostEstimatedCost"];
  growing?: boolean;
};
export type AdapterResult = { observations: CaptureObservation[]; warnings: string[]; format: string };
export function estimate(value: unknown): UsageEvent["hostEstimatedCost"] {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid host cost estimate");
  return { amount: value, currency: "USD" };
}
export function exclusiveUsage(values: RecordValue): TokenUsage {
  return cleanUsage({ uncachedInputTokens: count(values.input), cachedInputTokens: count(values.read), cacheWriteTokens: count(values.write), outputTokens: count(values.output), reasoningTokens: count(values.reasoning), providerTotalTokens: count(values.total) });
}
export function inclusiveUsage(values: RecordValue): TokenUsage {
  const input = count(values.input), read = count(values.read), write = count(values.write);
  if (input !== undefined && (read ?? 0) + (write ?? 0) > input) throw new Error("Native cache buckets exceed inclusive input");
  return exclusiveUsage({ ...values, input: input === undefined || read === undefined || write === undefined ? undefined : input - read - write });
}
function cleanUsage(usage: TokenUsage): TokenUsage {
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
}
