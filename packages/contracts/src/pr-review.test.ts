import { describe, expect, it } from "vitest";
import { PRReviewOutput } from "./pr-review";

describe("PRReviewOutput", () => {
  it("parses a valid PR review payload", () => {
    const parsed = PRReviewOutput.parse({
      summary: "The PR mostly lines up with the linked issue, but one guard path needs attention.",
      comments: [
        {
          path: "packages/cli/src/index.ts",
          line: 42,
          severity: "high",
          category: "correctness",
          body: "This branch skips the issue lookup when the flag is provided without a value.",
          suggestion: "Fail fast when --issue-number is present without a numeric argument.",
        },
      ],
      findings: [
        {
          title: "Quick start still mixes install and first-run steps",
          severity: "medium",
          category: "usability",
          body: "New users still need to infer which commands are one-time setup versus everyday usage.",
          suggestion: "Split installation, configuration, and first successful run into separate subsections.",
          relatedPaths: ["README.md"],
        },
      ],
    });

    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]?.path).toBe("packages/cli/src/index.ts");
    expect(parsed.findings[0]?.relatedPaths).toEqual(["README.md"]);
  });

  it("defaults higher-level findings to an empty list when omitted", () => {
    const parsed = PRReviewOutput.parse({
      summary: "The diff looks correct and no broader concerns stood out.",
      comments: [],
    });

    expect(parsed.findings).toEqual([]);
  });

  it("rejects empty required fields", () => {
    expect(() =>
      PRReviewOutput.parse({
        summary: "   ",
        comments: [],
      })
    ).toThrow();
  });
});
