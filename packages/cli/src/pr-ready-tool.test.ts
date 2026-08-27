import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RepositoryForge } from "./forge";
import { readyPullRequestTool, type PrReadyRunCommandResult } from "./pr-ready-tool";

function ok(stdout = ""): PrReadyRunCommandResult {
  return { status: 0, stdout, stderr: "" };
}

describe("deterministic PR readiness", () => {
  it("checks out, syncs, validates, and records hosted context without model output", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-pr-ready-"));
    const forge = {
      type: "github",
      fetchPullRequestDetails: vi.fn(async () => ({
        number: 12, title: "Portable flow", body: "", url: "https://example.test/pr/12",
        baseRefName: "main", headRefName: "feature/portable", headSha: "abc", isDraft: false,
      })),
      fetchPullRequestChecks: vi.fn(async () => [{ name: "test", status: "completed", conclusion: "success" }]),
      fetchPullRequestIssueComments: vi.fn(async () => []),
      fetchPullRequestReviewComments: vi.fn(async () => []),
    } as unknown as RepositoryForge;
    const runCommand = vi.fn((command: string, args: string[]) => {
      if (command === "git" && args.includes("origin/main")) return ok("abc\n");
      return ok();
    });

    const result = await readyPullRequestTool({
      repoRoot, prNumber: 12, forge,
      buildCommand: ["pnpm", "build"],
      prReadiness: { commands: [{ name: "build", command: ["pnpm", "build"] }] },
      ensureCleanWorkingTree: vi.fn(),
      ensureVerificationCommandAvailable: vi.fn(),
      runCommand,
    });

    expect(result).toMatchObject({
      status: "ready",
      branchName: "feature/portable",
      baseSync: { status: "up-to-date" },
      localReadiness: { status: "passed" },
      prContext: { checks: { status: "available", failed: [], pending: [] } },
    });
    expect(result).not.toHaveProperty("tokenUsage");
    expect(result.prContext).not.toHaveProperty("testSuggestions");
    expect(JSON.parse(readFileSync(result.metadataFilePath, "utf8"))).not.toHaveProperty("tokenUsage");
  });
});
