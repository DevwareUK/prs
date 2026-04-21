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
          confidence: "high",
          category: "correctness",
          affectedFile: "packages/cli/src/index.ts",
          body: "This branch skips the issue lookup when the flag is provided without a value.",
          whyThisMatters: "Malformed CLI input will produce a misleading runtime failure instead of a clear validation error.",
          suggestedFix: "Fail fast when --issue-number is present without a numeric argument.",
        },
      ],
      findings: [
        {
          title: "Quick start still mixes install and first-run steps",
          severity: "medium",
          confidence: "medium",
          category: "usability",
          affectedFile: "README.md",
          body: "New users still need to infer which commands are one-time setup versus everyday usage.",
          whyThisMatters: "That ambiguity increases setup mistakes and slows down a first successful run.",
          suggestedFix: "Split installation, configuration, and first successful run into separate subsections.",
        },
      ],
    });

    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]?.path).toBe("packages/cli/src/index.ts");
    expect(parsed.findings[0]?.affectedFile).toBe("README.md");
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

  it("rejects malformed higher-level findings", () => {
    expect(() =>
      PRReviewOutput.parse({
        summary: "The review found a broader onboarding issue.",
        comments: [],
        findings: [
          {
            title: "  ",
            severity: "medium",
            confidence: "medium",
            category: "usability",
            affectedFile: "README.md",
            body: "This finding is malformed because the title is empty.",
            whyThisMatters: "The report should reject findings without meaningful titles.",
          },
        ],
      })
    ).toThrow();
  });

  it("rejects more than three higher-level findings", () => {
    expect(() =>
      PRReviewOutput.parse({
        summary: "Too many higher-level findings were returned.",
        comments: [],
        findings: [
          {
            title: "Finding 1",
            severity: "low",
            confidence: "low",
            category: "documentation",
            body: "First finding.",
            affectedFile: "README.md",
            whyThisMatters: "First impact.",
          },
          {
            title: "Finding 2",
            severity: "low",
            confidence: "low",
            category: "documentation",
            body: "Second finding.",
            affectedFile: "README.md",
            whyThisMatters: "Second impact.",
          },
          {
            title: "Finding 3",
            severity: "low",
            confidence: "low",
            category: "documentation",
            body: "Third finding.",
            affectedFile: "README.md",
            whyThisMatters: "Third impact.",
          },
          {
            title: "Finding 4",
            severity: "low",
            confidence: "low",
            category: "documentation",
            body: "Fourth finding.",
            affectedFile: "README.md",
            whyThisMatters: "Fourth impact.",
          },
        ],
      })
    ).toThrow();
  });
});
