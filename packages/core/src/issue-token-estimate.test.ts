import { describe, expect, it } from "vitest";
import {
  estimateIssueImplementationTokens,
  extractIssueImplementationPlanFiles,
} from "./issue-token-estimate";

describe("issue implementation token estimates", () => {
  it("extracts likely files from Superpowers plan comments", () => {
    const plan = [
      "<!-- prs:issue-plan -->",
      "# Implementation Plan",
      "",
      "## Likely Files",
      "",
      "- `packages/cli/src/index.ts`",
      "- ./packages/core/src/issue-token-estimate.ts",
      "- Command parser changes",
      "- `packages/cli/src/index.ts`",
      "",
      "## Steps",
      "- Add the estimator.",
    ].join("\n");

    expect(extractIssueImplementationPlanFiles(plan)).toEqual([
      "packages/cli/src/index.ts",
      "packages/core/src/issue-token-estimate.ts",
    ]);
  });

  it("estimates larger token ranges for mini implementer profiles and reports drivers", () => {
    const estimate = estimateIssueImplementationTokens({
      planBody: [
        "# Implementation Plan",
        "",
        "## Likely Files",
        "",
        "- `packages/cli/src/commands/issue.ts`",
        "- `packages/cli/src/index.ts`",
        "- `packages/core/src/issue-token-estimate.ts`",
        "- `README.md`",
        "",
        "## Steps",
        "",
        "1. Add parser support.",
        "2. Add bounded repository scanning.",
        "3. Add JSON output.",
        "4. Update docs.",
        "",
        "## Risks",
        "",
        "- Command-surface changes and verification output can be noisy.",
      ].join("\n"),
      profiles: [
        {
          name: "premium",
          role: "planner",
          model: "gpt-5.5",
          thinking: "high",
        },
        {
          name: "standard",
          role: "implementer",
          model: "gpt-5.4-mini",
          thinking: "medium",
        },
      ],
      implementerProfileName: "standard",
      context: {
        likelyFiles: [
          { path: "packages/cli/src/index.ts", exists: true, lineCount: 7600 },
          {
            path: "packages/core/src/issue-token-estimate.ts",
            exists: false,
            lineCount: 0,
          },
        ],
        verificationCommands: [["pnpm", "build"]],
      },
    });

    expect(estimate.status).toBe("estimated");
    expect(estimate.profiles).toHaveLength(2);
    expect(estimate.profiles[1].range.high).toBeGreaterThan(
      estimate.profiles[0].range.high
    );
    expect(estimate.recommendation).toContain("standard");
    expect(estimate.drivers.join("\n")).toContain("4 implementation steps");
    expect(estimate.scanBudget.status).toBe("complete");
  });

  it("marks plans without likely files or implementation steps as low confidence", () => {
    const estimate = estimateIssueImplementationTokens({
      planBody: [
        "<!-- prs:issue-plan -->",
        "# Implementation Plan",
        "",
        "## Summary",
        "",
        "Investigate whether this issue is actionable.",
      ].join("\n"),
      profiles: [
        {
          name: "standard",
          model: "gpt-5.4-mini",
          thinking: "medium",
        },
      ],
    });

    expect(estimate.confidence).toBe("low");
    expect(estimate.profiles[0].confidence).toBe("low");
    expect(estimate.drivers).toContain("No explicit implementation steps detected.");
    expect(estimate.drivers).toContain("0 likely files detected.");
    expect(estimate.warnings).toContain(
      "Estimate confidence is low; refine or split the plan before relying on the range."
    );
  });

  it("warns when likely files are missing or the repository scan budget is exhausted", () => {
    const estimate = estimateIssueImplementationTokens({
      planBody: [
        "## Likely Files",
        "",
        "- `packages/cli/src/index.ts`",
        "- `packages/cli/src/missing-a.ts`",
        "- `packages/cli/src/missing-b.ts`",
        "- `packages/cli/src/missing-c.ts`",
        "- `packages/cli/src/missing-d.ts`",
        "",
        "## Steps",
        "",
        "1. Add bounded scanning.",
      ].join("\n"),
      profiles: [
        {
          name: "premium",
          model: "gpt-5.5",
          thinking: "high",
        },
      ],
      context: {
        likelyFiles: [
          { path: "packages/cli/src/index.ts", exists: true, lineCount: 100 },
          { path: "packages/cli/src/missing-a.ts", exists: false, lineCount: 0 },
          { path: "packages/cli/src/missing-b.ts", exists: false, lineCount: 0 },
          { path: "packages/cli/src/missing-c.ts", exists: false, lineCount: 0 },
          { path: "packages/cli/src/missing-d.ts", exists: false, lineCount: 0 },
        ],
        scanBudget: {
          filesConsidered: 20,
          filesScanned: 1,
          maxFiles: 12,
          exhausted: true,
        },
      },
    });

    expect(estimate.confidence).toBe("low");
    expect(estimate.scanBudget).toEqual({
      status: "exhausted",
      filesConsidered: 20,
      filesScanned: 1,
      maxFiles: 12,
    });
    expect(estimate.warnings).toContain("4 likely files were not found locally.");
    expect(estimate.warnings).toContain(
      "Repository context scan budget was exhausted; estimate confidence is reduced."
    );
  });
});
