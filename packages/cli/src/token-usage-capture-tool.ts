import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { UsageEvidence, stableUsageJson, type UsageEvent } from "@prs/contracts";
import { selectedRun, assertRealContainment } from "./token-usage-tool";
import { captureUsage } from "./token-usage-capture";
import { label, timestamp } from "./token-usage-capture-shared";
import { aggregateUsageEvents } from "./token-usage-aggregate";

type Input = { repoRoot: string; host: UsageEvent["host"]; outputFilePath: string; sessionId?: string; sourcePath?: string; since?: string; now?: () => string; env?: NodeJS.ProcessEnv };
function discover(root: string, depth: number, matches: (name: string) => boolean): string[] {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) return [];
  const found: string[] = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    if (item.isFile() && matches(item.name)) found.push(join(root, item.name));
    else if (item.isDirectory() && depth > 0) found.push(...discover(join(root, item.name), depth - 1, matches));
  }
  return found;
}
function readRecords(path: string, warnings: string[]): unknown[] {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Native source must not be a symlink");
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("Native source must be a regular file no larger than 64 MiB");
  const content = readFileSync(path, "utf8");
  if (!content.trim()) return [];
  try { const value: unknown = JSON.parse(content); return Array.isArray(value) ? value : [value]; } catch { /* JSONL */ }
  const lines = content.split("\n"), records: unknown[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch {
      if (index === lines.length - 1 && line.trimStart().startsWith("{")) { warnings.push("Incomplete trailing JSON record was excluded; capture again after the host finishes writing."); break; }
      throw new Error("Invalid JSON in native source; previous evidence was preserved");
    }
  }
  return records;
}
function preserve(prior: UsageEvidence, next: UsageEvidence): void {
  for (const old of prior.events.filter(e => e.status !== "unavailable")) {
    const fresh = next.events.find(e => e.eventId === old.eventId);
    if (!fresh) throw new Error("Native source lost previously captured responses (possibly truncated); evidence preserved");
    const identity = (e: UsageEvent) => stableUsageJson([e.model, e.usage, e.hostEstimatedCost]);
    if (identity(old) === identity(fresh)) continue;
    const withoutOutput = (e: UsageEvent) => stableUsageJson([e.model, { ...e.usage, outputTokens: undefined, reasoningTokens: undefined }, e.hostEstimatedCost]);
    if (old.host !== "claude-code" || old.adapter.name !== "claude-transcript-v1" || withoutOutput(old) !== withoutOutput(fresh) ||
      (fresh.usage?.outputTokens ?? -1) < (old.usage?.outputTokens ?? -1) || (fresh.usage?.reasoningTokens ?? -1) < (old.usage?.reasoningTokens ?? -1)) throw new Error("Conflicting captured response; evidence preserved");
  }
}
export function captureTokenUsageTool(input: Input) {
  const output = selectedRun(resolve(input.repoRoot), input.outputFilePath), env = input.env ?? process.env;
  if (!existsSync(output.runRoot) || realpathSync(output.runRoot) !== output.runRoot) throw new Error("Selected run must be a real directory under .prs/runs");
  assertRealContainment(output.runRoot, output.path);
  if (existsSync(output.path) && (lstatSync(output.path).isSymbolicLink() || !lstatSync(output.path).isFile() || lstatSync(output.path).nlink !== 1)) throw new Error("Evidence output must be a regular, unaliased file");
  const lock = output.path + ".lock";
  writeFileSync(lock, "capture", { flag: "wx", mode: 0o600 });
  try {
    const prior = existsSync(output.path) ? UsageEvidence.parse(JSON.parse(readFileSync(output.path, "utf8"))) : undefined;
    if (prior && (!prior.capture || prior.runId !== output.runId)) throw new Error("Existing evidence has no matching capture binding");
    const binding = prior?.capture, capturedAt = timestamp((input.now ?? (() => new Date().toISOString()))());
    const since = timestamp(input.since ?? binding?.since ?? capturedAt);
    const sessionId = input.sessionId ?? (binding?.sessionId !== "not-connected" ? binding?.sessionId : undefined) ?? env.PRS_USAGE_SESSION_ID ?? (input.host === "codex" ? env.CODEX_THREAD_ID : undefined);
    if (sessionId && !label(sessionId)) throw new Error("Invalid capture session identity");
    let source = input.sourcePath ? resolve(input.repoRoot, input.sourcePath) : binding?.sourcePath;
    if (binding && (binding.host !== input.host || binding.since !== since || (binding.sessionId !== "not-connected" && binding.sessionId !== sessionId) || (binding.sourcePath && source !== binding.sourcePath))) throw new Error("Capture binding cannot change; choose a new run artifact");
    if (binding && capturedAt < binding.capturedAt) throw new Error("Capture checkpoint cannot move backwards");
    const warnings: string[] = [];
    source ??= env.PRS_USAGE_SOURCE ?? (input.host === "copilot" ? env.COPILOT_OTEL_FILE_EXPORTER_PATH : undefined);
    if (!source && sessionId) {
      const candidates = input.host === "codex" ? discover(join(env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions"), 3, name => name.endsWith("-" + sessionId + ".jsonl")) : input.host === "claude-code" ? discover(join(homedir(), ".claude/projects"), 1, name => name === sessionId + ".jsonl") : [];
      if (candidates.length > 1) throw new Error("Multiple native sources match; select one with --source");
      source = candidates[0];
    }
    if (source) source = resolve(input.repoRoot, source);
    if (!sessionId) warnings.push("Set --session or PRS_USAGE_SESSION_ID to the exact native session ID (Codex also accepts CODEX_THREAD_ID).");
    if (!source) warnings.push(input.host === "copilot" ? "Set --source or COPILOT_OTEL_FILE_EXPORTER_PATH to the local telemetry export; enable export before starting the session." : "Set --source or PRS_USAGE_SOURCE to the selected native session JSONL file.");
    let records: unknown[] = [];
    if (source) {
      if (source === output.path || (existsSync(source) && existsSync(output.path) && lstatSync(source).ino === lstatSync(output.path).ino && lstatSync(source).dev === lstatSync(output.path).dev)) throw new Error("Source and output must not alias");
      if (!existsSync(source)) {
        if (binding?.sourcePath) throw new Error("Previously bound native source is missing; evidence preserved");
        warnings.push("Selected native source does not exist yet; capture again after the host writes usage.");
      } else if (sessionId) records = readRecords(source, warnings);
    }
    const evidence = captureUsage(records, { host: input.host, sessionId: sessionId ?? "not-connected", runId: output.runId, since, capturedAt, warnings });
    if (source) evidence.capture!.sourcePath = source;
    if (prior?.rateCards) evidence.rateCards = prior.rateCards;
    if (prior) preserve(prior, evidence);
    const modelTokens = aggregateUsageEvents(evidence.events).modelTokens;
    const temporary = join(dirname(output.path), ".capture-" + randomUUID() + ".tmp");
    try {
      writeFileSync(temporary, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      renameSync(temporary, output.path);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    const capture = { ...evidence.capture! };
    delete capture.sourcePath;
    return { status: capture.status, outputFile: output.path, capture, modelTokens };
  } finally { unlinkSync(lock); }
}
