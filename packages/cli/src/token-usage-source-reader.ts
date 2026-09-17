import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import type { UsageEvent } from "@prs/contracts";
import { isCopilotSessionRecord } from "./token-usage-capture-copilot";

const MAX_WHOLE_FILE = 64 * 1024 * 1024;
const MAX_COPILOT_RECORD = 8 * 1024 * 1024;
const MAX_MATCHING_RECORDS = 100_000;
const CHUNK_SIZE = 64 * 1024;
const TRAILING_WARNING = "Incomplete trailing JSON record was excluded; capture again after the host finishes writing.";

function assertSource(path: string) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("Native source must not be a symlink");
  if (!stat.isFile()) throw new Error("Native source must be a regular file");
  return stat;
}

function readWhole(path: string, warnings: string[]): unknown[] {
  const stat = assertSource(path);
  if (stat.size > MAX_WHOLE_FILE) throw new Error("Native source must be a regular file no larger than 64 MiB");
  const content = readFileSync(path, "utf8");
  if (!content.trim()) return [];
  try { const value: unknown = JSON.parse(content); return Array.isArray(value) ? value : [value]; } catch { /* JSONL */ }
  const lines = content.split("\n"), records: unknown[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch {
      if (index === lines.length - 1 && line.trimStart().startsWith("{")) { warnings.push(TRAILING_WARNING); break; }
      throw new Error("Invalid JSON in native source; previous evidence was preserved");
    }
  }
  return records;
}

function firstNonWhitespace(fd: number, size: number): number | undefined {
  const buffer = Buffer.alloc(Math.min(CHUNK_SIZE, size));
  for (let position = 0; position < size;) {
    const count = readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
    if (count === 0) break;
    for (let index = 0; index < count; index++) if (![9, 10, 13, 32].includes(buffer[index])) return buffer[index];
    position += count;
  }
  return undefined;
}

export type ReaderLimits = { maxCopilotRecord: number; maxMatchingRecords: number };
const DEFAULT_LIMITS: ReaderLimits = { maxCopilotRecord: MAX_COPILOT_RECORD, maxMatchingRecords: MAX_MATCHING_RECORDS };

function readCopilotJsonl(path: string, sessionId: string, warnings: string[], limits: ReaderLimits): unknown[] {
  const before = assertSource(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const snapshot = fstatSync(fd);
    if (!snapshot.isFile() || snapshot.dev !== before.dev || snapshot.ino !== before.ino) throw new Error("Native source changed while opening; capture again");
    if (firstNonWhitespace(fd, snapshot.size) === 91) return readWhole(path, warnings); // JSON arrays retain the generic bounded path.
    const records: unknown[] = [], chunk = Buffer.alloc(CHUNK_SIZE);
    let lineParts: Buffer[] = [], lineBytes = 0, position = 0;
    const retain = (line: Buffer, trailing: boolean): void => {
      if (line.length && line[line.length - 1] === 13) line = line.subarray(0, line.length - 1);
      if (!line.toString("utf8").trim()) return;
      if (line.length > limits.maxCopilotRecord) throw new Error("Copilot JSONL records must be no larger than 8 MiB");
      let parsed: unknown;
      try { parsed = JSON.parse(line.toString("utf8")); }
      catch {
        if (trailing && line.toString("utf8").trimStart().startsWith("{")) { warnings.push(TRAILING_WARNING); return; }
        throw new Error("Invalid JSON in native source; previous evidence was preserved");
      }
      if (!isCopilotSessionRecord(parsed, sessionId)) return;
      if (records.length >= limits.maxMatchingRecords) throw new Error("Copilot capture cannot retain more than 100,000 matching records");
      records.push(parsed);
    };
    while (position < snapshot.size) {
      const requested = Math.min(chunk.length, snapshot.size - position), count = readSync(fd, chunk, 0, requested, position);
      if (count === 0) throw new Error("Native source ended before its captured size; previous evidence was preserved");
      position += count;
      let start = 0;
      for (let index = 0; index < count; index++) {
        if (chunk[index] !== 10) continue;
        const segment = chunk.subarray(start, index);
        if (lineBytes + segment.length > limits.maxCopilotRecord) throw new Error("Copilot JSONL records must be no larger than 8 MiB");
        retain(lineParts.length ? Buffer.concat([...lineParts, segment], lineBytes + segment.length) : segment, false);
        lineParts = []; lineBytes = 0; start = index + 1;
      }
      const trailing = chunk.subarray(start, count);
      if (lineBytes + trailing.length > limits.maxCopilotRecord) throw new Error("Copilot JSONL records must be no larger than 8 MiB");
      if (trailing.length) { lineParts.push(Buffer.from(trailing)); lineBytes += trailing.length; }
    }
    if (lineBytes) retain(Buffer.concat(lineParts, lineBytes), true);
    return records;
  } finally { closeSync(fd); }
}

export function readNativeUsageSource(input: { host: UsageEvent["host"]; sessionId: string; sourcePath: string }): { records: unknown[]; warnings: string[] } {
  return readNativeUsageSourceWithLimits(input, DEFAULT_LIMITS);
}

/** Test seam for exercising production limit branches without retaining 100,000 parsed objects. */
export function readNativeUsageSourceWithLimits(input: { host: UsageEvent["host"]; sessionId: string; sourcePath: string }, limits: ReaderLimits): { records: unknown[]; warnings: string[] } {
  const warnings: string[] = [];
  const records = input.host === "copilot" ? readCopilotJsonl(input.sourcePath, input.sessionId, warnings, limits) : readWhole(input.sourcePath, warnings);
  return { records, warnings };
}
