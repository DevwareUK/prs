import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOP_LEVEL_HELP } from "./cli-notices";

describe("provider-free CLI command surface", () => {
  it("advertises only setup, skill installation, deterministic tools, finalization, and audit", () => {
    expect(TOP_LEVEL_HELP).toContain("prs skills install <codex|claude-code|copilot>");
    expect(TOP_LEVEL_HELP).toContain("prs tool issue context");
    expect(TOP_LEVEL_HELP).toContain("prs tool pr ready");
    expect(TOP_LEVEL_HELP).toContain("prs issue finalize");
    expect(TOP_LEVEL_HELP).toContain("prs audit publish");
    expect(TOP_LEVEL_HELP).not.toMatch(/commit|diff|backlog|provider|OpenAI|Bedrock|GitHub Actions/i);
  });

  it("keeps the process entrypoint focused", () => {
    const entrypoint = readFileSync(resolve(process.cwd(), "packages/cli/src/index.ts"), "utf8");
    expect(entrypoint.split(/\r?\n/).length).toBeLessThan(160);
    expect(entrypoint).not.toMatch(/createProvider|generateCommitMessage|generateDiffSummary/);
  });
});
