import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
import { estimateIssueTool, renderIssueEstimate } from "./issue-estimate-tool";

describe("issue estimate tool", () => {
  it("uses default comparison profiles when repository config has no explicit profiles", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-"));
    writeFileSync(resolve(repoRoot, "README.md"), "# Test repository\n", "utf8");
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 1,
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-1",
        updatedAt: "2026-06-11T08:47:44Z",
        body: [
          "<!-- prs:issue-plan -->",
          "## Likely files",
          "",
          "- `README.md`",
          "",
          "## Steps",
          "",
          "1. Update docs.",
        ].join("\n"),
      }),
    };

    const result = await estimateIssueTool({
      issueNumber: 267,
      repoRoot,
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result.status).toBe("estimated");
    if (result.status === "estimated") {
      expect(result.cost).toMatchObject({
        currency: "USD",
        inputTokenRatio: 0.8,
        outputTokenRatio: 0.2,
      });
      expect(result.profiles[0]).toHaveProperty("costBasis");
      expect(result.profiles[0]).toHaveProperty("costRange");
      expect(result.profiles.map((profile) => profile.name)).toEqual([
        "premium",
        "standard",
      ]);
      expect(result.profiles.find((profile) => profile.name === "standard")?.notes).toContain(
        "Configured implementer profile."
      );
    }
  });

  it("returns a blocked JSON-safe result when the issue has no managed plan comment", async () => {
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue(undefined),
    };

    const result = await estimateIssueTool({
      issueNumber: 268,
      repoRoot: mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-")),
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result).toEqual({
      status: "blocked",
      issueNumber: 268,
      message:
        "Issue implementation token estimates require an issue comment containing `<!-- prs:issue-plan -->`. For estimate-ready issues, keep the companion source-of-truth specification in `<!-- prs:issue-spec -->`; the estimator reads the managed plan marker. Publish the managed plan comment or run `prs issue plan <number>` first.",
      nextAction: "create-issue-plan",
    });
    expect(renderIssueEstimate(result)).toContain(
      "Issue #268 implementation estimate is blocked."
    );
    expect(renderIssueEstimate(result)).toContain("<!-- prs:issue-plan -->");
    expect(renderIssueEstimate(result)).toContain("<!-- prs:issue-spec -->");
    expect(renderIssueEstimate(result)).toContain("prs issue plan <number>");
  });

  it("renders missing-file warnings and exhausted scan budgets for human output", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-"));
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 2,
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-2",
        updatedAt: "2026-06-11T08:47:44Z",
        body: [
          "<!-- prs:issue-plan -->",
          "## Likely files",
          "",
          "- `packages/cli/src/missing-01.ts`",
          "- `packages/cli/src/missing-02.ts`",
          "- `packages/cli/src/missing-03.ts`",
          "- `packages/cli/src/missing-04.ts`",
          "- `packages/cli/src/missing-05.ts`",
          "- `packages/cli/src/missing-06.ts`",
          "- `packages/cli/src/missing-07.ts`",
          "- `packages/cli/src/missing-08.ts`",
          "- `packages/cli/src/missing-09.ts`",
          "- `packages/cli/src/missing-10.ts`",
          "- `packages/cli/src/missing-11.ts`",
          "- `packages/cli/src/missing-12.ts`",
          "- `packages/cli/src/missing-13.ts`",
          "",
          "## Steps",
          "",
          "1. Estimate the work.",
        ].join("\n"),
      }),
    };

    const result = await estimateIssueTool({
      issueNumber: 267,
      repoRoot,
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result.status).toBe("estimated");
    if (result.status === "estimated") {
      const rendered = renderIssueEstimate(result);

      expect(result.scanBudget.status).toBe("exhausted");
      expect(result.warnings).toContain("12 likely files were not found locally.");
      expect(rendered).toContain("~$");
      expect(rendered).toContain(
        "Cost basis: approximate USD planning cost uses an 80% input / 20% output token split."
      );
      expect(rendered).toContain("blended");
      expect(rendered).toContain("Actual billing can vary");
      expect(rendered).toContain("Scan budget: exhausted (0/13 files scanned, max 12)");
    }
  });
});
