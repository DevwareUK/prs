import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, linkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeUsageFixture } from "./token-usage.test-support";
import { renderTokenUsageTool } from "./token-usage-tool";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "prs-usage-")); temporary.push(repoRoot);
  const run = join(repoRoot, ".prs/runs/run-42"); mkdirSync(run, { recursive: true });
  const filePath = join(run, "usage-evidence.json"), outputFilePath = join(run, "token-usage.md");
  writeFileSync(filePath, JSON.stringify(makeUsageFixture("priced-cache")));
  return { repoRoot, filePath, outputFilePath, run };
}
describe("local token usage render tool", () => {
  it("renders deterministic JSON/Markdown inside the selected run without forge configuration", () => {
    const input = fixture();
    const result = renderTokenUsageTool(input);
    expect(result.status).toBe("rendered");
    expect(result.totals.modelTokens.totalTokens).toBe(1150);
    expect(readFileSync(input.outputFilePath, "utf8")).toContain("0.00195");
    expect(renderTokenUsageTool(input)).toEqual(result);
  });
  it("accepts repository-relative paths and nested output directories", () => {
    const input = fixture();
    const result = renderTokenUsageTool({ ...input, filePath: ".prs/runs/run-42/usage-evidence.json", outputFilePath: ".prs/runs/run-42/reports/usage.md" });
    expect(existsSync(result.outputFile)).toBe(true);
  });
  it.each(["outside.md", ".prs/runs/other/report.md", ".prs/runs/report.md", ".prs/runs/run-42/../escape.md"])("rejects output %s without overwriting", outputFilePath => {
    const input = fixture();
    expect(() => renderTokenUsageTool({ ...input, outputFilePath })).toThrow();
    expect(existsSync(input.outputFilePath)).toBe(false);
  });
  it("preserves old output when validation fails", () => {
    const input = fixture(); writeFileSync(input.outputFilePath, "old report");
    writeFileSync(input.filePath, '{"bad":true}');
    expect(() => renderTokenUsageTool(input)).toThrow();
    expect(readFileSync(input.outputFilePath, "utf8")).toBe("old report");
  });
  it("rejects input/output aliases including hardlinks", () => {
    const input = fixture();
    expect(() => renderTokenUsageTool({ ...input, outputFilePath: input.filePath })).toThrow();
    linkSync(input.filePath, input.outputFilePath);
    expect(() => renderTokenUsageTool(input)).toThrow();
  });
  it("rejects symlink escapes for input and existing output ancestors", () => {
    const input = fixture();
    const outside = join(input.repoRoot, "outside"); mkdirSync(outside);
    symlinkSync(outside, join(input.run, "escape"));
    expect(() => renderTokenUsageTool({ ...input, outputFilePath: join(input.run, "escape/new/deep.md") })).toThrow();
    writeFileSync(join(outside, "input.json"), JSON.stringify(makeUsageFixture("priced-cache")));
    symlinkSync(join(outside, "input.json"), join(input.run, "linked.json"));
    expect(() => renderTokenUsageTool({ ...input, filePath: join(input.run, "linked.json") })).toThrow();
  });
  it("rejects run identity mismatch and an input outside the run root", () => {
    const input = fixture();
    const evidence = makeUsageFixture("priced-cache"); evidence.runId = "other"; evidence.events[0].workflow.runId = "other";
    writeFileSync(input.filePath, JSON.stringify(evidence));
    expect(() => renderTokenUsageTool(input)).toThrow(/run/i);
    const elsewhere = join(input.repoRoot, "input.json"); writeFileSync(elsewhere, JSON.stringify(evidence));
    expect(() => renderTokenUsageTool({ ...input, filePath: elsewhere })).toThrow();
  });
});
