import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { UsageEvidence } from "@prs/contracts";
import { normalizeUsageEvidence } from "./token-usage-normalize";
import { aggregateUsageEvents } from "./token-usage-aggregate";
import { priceUsage } from "./token-usage-pricing";
import { renderUsageMarkdown } from "./token-usage-render";

export type TokenUsageToolInput = { repoRoot: string; filePath: string; outputFilePath: string };
function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== "" && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
}
function selectedRun(repoRoot: string, path: string): { path: string; runId: string; runRoot: string } {
  if (path.split(/[\\/]/).includes("..")) throw new Error("Run artifact paths must not contain traversal");
  const resolved = resolve(repoRoot, path), canonicalRoot = realpathSync(repoRoot);
  let rel = relative(repoRoot, resolved).split(sep);
  if (rel[0] === "..") rel = relative(canonicalRoot, resolved).split(sep);
  if (rel[0] !== ".prs" || rel[1] !== "runs" || !rel[2] || rel.length < 4) throw new Error("Artifact must belong to .prs/runs/<runId>/");
  return { path: resolve(canonicalRoot, ...rel), runId: rel[2], runRoot: resolve(canonicalRoot, ".prs/runs", rel[2]) };
}
function assertRealContainment(runRoot: string, path: string): void {
  let ancestor = path;
  while (!existsSync(ancestor)) {
    // A dangling symlink is not a safe nonexistent destination.
    try { if (lstatSync(ancestor).isSymbolicLink()) throw new Error("Dangling artifact symlink"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("Artifact has no existing ancestor");
    ancestor = parent;
  }
  const real = realpathSync(ancestor);
  if (real !== runRoot && !inside(runRoot, real)) throw new Error("Artifact symlink escapes selected run");
}
export function renderTokenUsageTool(input: TokenUsageToolInput) {
  const repoRoot = resolve(input.repoRoot);
  const file = selectedRun(repoRoot, input.filePath), output = selectedRun(repoRoot, input.outputFilePath);
  if (file.runId !== output.runId) throw new Error("Input and output must belong to the same run");
  if (!existsSync(file.runRoot) || realpathSync(file.runRoot) !== file.runRoot) throw new Error("Selected run must be a real directory under .prs/runs");
  assertRealContainment(file.runRoot, file.path);
  assertRealContainment(file.runRoot, output.path);
  if (file.path === output.path || (existsSync(output.path) && (
    realpathSync(file.path) === realpathSync(output.path) ||
    (statSync(file.path).dev === statSync(output.path).dev && statSync(file.path).ino === statSync(output.path).ino)
  ))) throw new Error("Input and output must not alias the same file");
  const evidence = UsageEvidence.parse(JSON.parse(readFileSync(file.path, "utf8")));
  if (evidence.runId !== file.runId) throw new Error("Evidence runId must match the selected run directory");
  const ledger = normalizeUsageEvidence(evidence);
  const totals = aggregateUsageEvents(ledger.events);
  const pricing = priceUsage(totals, evidence.rateCards);
  const markdown = renderUsageMarkdown(ledger, totals, pricing);
  mkdirSync(dirname(output.path), { recursive: true });
  assertRealContainment(file.runRoot, output.path);
  const temporary = resolve(dirname(output.path), ".usage-" + randomUUID() + ".tmp");
  try {
    writeFileSync(temporary, markdown, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, output.path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { status: "rendered" as const, outputFile: output.path, ledger, totals, pricing, warnings: [...ledger.warnings, ...totals.warnings] };
}
export type TokenUsageToolResult = ReturnType<typeof renderTokenUsageTool>;
