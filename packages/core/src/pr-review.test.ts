import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@git-ai/providers";
import { generatePRReview } from "./pr-review";

function createProvider(response: unknown): AIProvider & {
  generateText: ReturnType<typeof vi.fn>;
} {
  return {
    generateText: vi.fn().mockResolvedValue(JSON.stringify(response)),
  };
}

describe("generatePRReview", () => {
  it("adds docs-heavy review guidance and returns higher-level findings", async () => {
    const provider = createProvider({
      summary:
        "The README restructuring is helpful, but the onboarding flow still leaves setup and first run mixed together.",
      comments: [],
      findings: [
        {
          title: "Quick start still mixes install and first-run steps",
          severity: "medium",
          category: "usability",
          body: "The diff improves structure, but first-time users still need to infer which steps are one-time setup versus ongoing usage.",
          suggestion:
            "Separate installation, configuration, and first successful run into distinct subsections.",
          relatedPaths: ["README.md"],
        },
      ],
    });

    const review = await generatePRReview(provider, {
      diff: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,2 +1,30 @@",
        "-Old docs",
        "+# Quick start",
        "+",
        "+pnpm install",
        "+pnpm build",
        "+git-ai review",
        "+",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "+More onboarding text",
        "diff --git a/docs/setup.md b/docs/setup.md",
        "--- a/docs/setup.md",
        "+++ b/docs/setup.md",
        "@@ -0,0 +1,10 @@",
        "+Setup details",
        "+Setup details",
        "+Setup details",
      ].join("\n"),
      issueTitle: "Improve docs review quality",
    });

    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]?.relatedPaths).toEqual(["README.md"]);

    const request = provider.generateText.mock.calls[0]?.[0];
    expect(request?.systemPrompt).toContain("documentation-heavy");
    expect(request?.prompt).toContain("Review classification: docs-heavy.");
    expect(request?.prompt).toContain(
      "review for command correctness, setup accuracy, first-time user clarity"
    );
    expect(request?.prompt).toContain('"findings": [');
  });

  it("keeps standard diffs on the conservative rubric and defaults findings to empty", async () => {
    const provider = createProvider({
      summary: "The change is small and no broader concerns stand out.",
      comments: [
        {
          path: "packages/core/src/pr-review.ts",
          line: 10,
          severity: "low",
          category: "maintainability",
          body: "The helper name is ambiguous for future callers.",
        },
      ],
    });

    const review = await generatePRReview(provider, {
      diff: [
        "diff --git a/packages/core/src/pr-review.ts b/packages/core/src/pr-review.ts",
        "--- a/packages/core/src/pr-review.ts",
        "+++ b/packages/core/src/pr-review.ts",
        "@@ -1,1 +1,1 @@",
        "-const value = oldName;",
        "+const value = newName;",
      ].join("\n"),
    });

    expect(review.findings).toEqual([]);

    const request = provider.generateText.mock.calls[0]?.[0];
    expect(request?.prompt).toContain("Review classification: standard.");
    expect(request?.prompt).toContain(
      'The "findings" array should usually stay empty for code-heavy diffs'
    );
    expect(request?.prompt).not.toContain("This diff is documentation-heavy");
  });
});
