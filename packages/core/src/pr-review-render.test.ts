import { describe, expect, it } from "vitest";
import {
  buildGitHubPRReviewComments,
  formatPRReviewMarkdown,
} from "./pr-review-render";

describe("formatPRReviewMarkdown", () => {
  it("renders PR review output as pre-review signal with confidence and impact fields", () => {
    const markdown = formatPRReviewMarkdown(
      {
        summary: "The diff mostly aligns with the linked issue, but one branch still looks under-validated.",
        findings: [
          {
            title: "Quick start still mixes setup and first-run commands",
            severity: "medium",
            confidence: "medium",
            category: "usability",
            affectedFile: "README.md",
            body: "The updated guide still blends one-time setup with daily workflow commands.",
            whyThisMatters: "A new contributor can follow the wrong path and fail before reaching a first successful run.",
            suggestedFix: "Split installation and first-run commands into separate subsections.",
          },
        ],
        comments: [
          {
            path: "packages/cli/src/index.ts",
            line: 412,
            severity: "high",
            confidence: "high",
            category: "correctness",
            affectedFile: "packages/cli/src/index.ts",
            body: "This branch assumes the issue number flag was populated.",
            whyThisMatters: "Malformed input will raise a runtime failure instead of a clear validation error.",
            suggestedFix: "Validate the flag before using it in this branch.",
          },
        ],
      },
      {
        number: 50,
        title: "Implement AI-Powered Pull Request Review Functionality",
        url: "https://github.com/DevwareUK/git-ai/issues/50",
      }
    );

    expect(markdown).toContain("# AI PR Pre-Review Signal");
    expect(markdown).toContain("pre-review signal for a human reviewer");
    expect(markdown).toContain("Confidence: High");
    expect(markdown).toContain("Affected file: `packages/cli/src/index.ts`");
    expect(markdown).toContain("Why this matters: Malformed input will raise a runtime failure");
    expect(markdown).toContain("Suggested fix: Validate the flag before using it in this branch.");
    expect(markdown).toContain("## Higher-level signals");
    expect(markdown).toContain("## Line-level signals");
  });
});

describe("buildGitHubPRReviewComments", () => {
  it("keeps only high-confidence comments on changed lines and deduplicates rendered output", () => {
    const comments = buildGitHubPRReviewComments(
      [
        {
          path: "packages/cli/src/index.ts",
          line: 11,
          severity: "high",
          confidence: "high",
          category: "correctness",
          affectedFile: "packages/cli/src/index.ts",
          body: "This branch skips input validation.",
          whyThisMatters: "Malformed input will fail at runtime.",
          suggestedFix: "Reject invalid input before branching.",
        },
        {
          path: "packages/cli/src/index.ts",
          line: 11,
          severity: "high",
          confidence: "high",
          category: "correctness",
          affectedFile: "packages/cli/src/index.ts",
          body: "This branch skips input validation.",
          whyThisMatters: "Malformed input will fail at runtime.",
          suggestedFix: "Reject invalid input before branching.",
        },
        {
          path: "packages/cli/src/index.ts",
          line: 12,
          severity: "medium",
          confidence: "medium",
          category: "maintainability",
          affectedFile: "packages/cli/src/index.ts",
          body: "This name is vague.",
          whyThisMatters: "Future edits will be less clear.",
        },
        {
          path: "packages/cli/src/index.ts",
          line: 99,
          severity: "high",
          confidence: "high",
          category: "correctness",
          affectedFile: "packages/cli/src/index.ts",
          body: "This line is not actually part of the diff.",
          whyThisMatters: "Posting here would create noise.",
        },
      ],
      [
        "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
        "--- a/packages/cli/src/index.ts",
        "+++ b/packages/cli/src/index.ts",
        "@@ -10,1 +10,3 @@",
        " const current = readCurrent();",
        "+const next = parseNext(rawValue);",
        "+return next;",
      ].join("\n")
    );

    expect(comments).toEqual([
      {
        path: "packages/cli/src/index.ts",
        line: 11,
        side: "RIGHT",
        body: [
          "**High severity, High confidence Correctness**",
          "",
          "This branch skips input validation.",
          "",
          "Why this matters: Malformed input will fail at runtime.",
          "",
          "Suggested fix: Reject invalid input before branching.",
        ].join("\n"),
      },
    ]);
  });
});
