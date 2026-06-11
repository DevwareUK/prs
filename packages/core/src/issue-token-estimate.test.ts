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
});
