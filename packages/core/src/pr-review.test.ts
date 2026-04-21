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
          confidence: "medium",
          category: "usability",
          affectedFile: "README.md",
          body: "The diff improves structure, but first-time users still need to infer which steps are one-time setup versus ongoing usage.",
          whyThisMatters:
            "That ambiguity makes it harder for a new contributor to reach a first successful run.",
          suggestedFix:
            "Separate installation, configuration, and first successful run into distinct subsections.",
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
    expect(review.findings[0]?.affectedFile).toEqual("README.md");

    const request = provider.generateText.mock.calls[0]?.[0];
    expect(request?.systemPrompt).toContain("documentation-heavy");
    expect(request?.prompt).toContain("Review classification: docs-heavy.");
    expect(request?.prompt).toContain(
      "review for command correctness, setup accuracy, first-time user clarity"
    );
    expect(request?.prompt).toContain(
      "combined total across comments and findings to 5 or fewer items"
    );
    expect(request?.prompt).toContain('"findings": [');
  });

  it("keeps docs-heavy diffs predictable when no higher-level findings are needed", async () => {
    const provider = createProvider({
      summary: "The documentation changes look correct and no broader onboarding issues stand out.",
      comments: [],
      findings: [],
    });

    const review = await generatePRReview(provider, {
      diff: [
        "diff --git a/docs/setup.md b/docs/setup.md",
        "--- a/docs/setup.md",
        "+++ b/docs/setup.md",
        "@@ -1,2 +1,18 @@",
        "-Old setup",
        "+# Setup",
        "+",
        "+pnpm install",
        "+pnpm build",
        "+pnpm test",
        "+",
        "+Run the CLI after build.",
        "+Verify the output before opening a PR.",
        "+Repeat for CI if needed.",
        "+Keep the branch up to date.",
        "+Review the generated summary.",
        "diff --git a/examples/config.example.json b/examples/config.example.json",
        "--- a/examples/config.example.json",
        "+++ b/examples/config.example.json",
        "@@ -0,0 +1,10 @@",
        '+{"apiKey":"demo"}',
        '+{"apiKey":"demo"}',
        '+{"apiKey":"demo"}',
        '+{"apiKey":"demo"}',
        '+{"apiKey":"demo"}',
      ].join("\n"),
    });

    expect(review.findings).toEqual([]);

    const request = provider.generateText.mock.calls[0]?.[0];
    expect(request?.prompt).toContain("Review classification: docs-heavy.");
    expect(request?.prompt).toContain(
      'Prefer the "findings" array for invalid or confusing commands'
    );
  });

  it("keeps standard diffs on the conservative rubric and defaults findings to empty", async () => {
    const provider = createProvider({
      summary: "The change is small and no broader concerns stand out.",
      comments: [
        {
          path: "packages/core/src/pr-review.ts",
          line: 10,
          severity: "low",
          confidence: "medium",
          category: "maintainability",
          affectedFile: "packages/core/src/pr-review.ts",
          body: "The helper name is ambiguous for future callers.",
          whyThisMatters: "The ambiguity will slow down the next edit in this area.",
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
    expect(request?.prompt).toContain(
      "Return only the top reviewer-ready risks"
    );
    expect(request?.prompt).toContain('"confidence": "high" | "medium" | "low"');
    expect(request?.prompt).toContain('"whyThisMatters": string');
    expect(request?.prompt).toContain('"affectedFile": string');
    expect(request?.prompt).toContain('"suggestedFix"?: string');
    expect(request?.prompt).not.toContain("This diff is documentation-heavy");
  });

  it("treats mixed diffs as standard when docs do not dominate the change", async () => {
    const provider = createProvider({
      summary: "The code changes look sound and do not justify broader findings.",
      comments: [],
      findings: [],
    });

    await generatePRReview(provider, {
      diff: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,2 +1,6 @@",
        "-Old note",
        "+Updated usage note",
        "+Added one more sentence",
        "diff --git a/packages/core/src/pr-review.ts b/packages/core/src/pr-review.ts",
        "--- a/packages/core/src/pr-review.ts",
        "+++ b/packages/core/src/pr-review.ts",
        "@@ -10,4 +10,8 @@",
        "-const oldValue = before();",
        "+const newValue = after();",
        "+if (newValue) {",
        "+  return newValue;",
        "+}",
        "diff --git a/packages/core/src/repository-config.ts b/packages/core/src/repository-config.ts",
        "--- a/packages/core/src/repository-config.ts",
        "+++ b/packages/core/src/repository-config.ts",
        "@@ -1,4 +1,8 @@",
        "-export const config = oldConfig;",
        "+export const config = nextConfig;",
        "+export function readConfig() {",
        "+  return config;",
        "+}",
      ].join("\n"),
    });

    const request = provider.generateText.mock.calls[0]?.[0];
    expect(request?.prompt).toContain("Review classification: standard.");
    expect(request?.prompt).toContain("Classification signal: Changed files: 3; doc-like files: 1.");
    expect(request?.prompt).toContain(
      'The "findings" array should usually stay empty for code-heavy diffs'
    );
  });

  it("treats header-only diffs as low-signal standard reviews", async () => {
    const provider = createProvider({
      summary: "The diff does not contain enough changed lines to support review findings.",
      comments: [],
      findings: [],
    });

    const review = await generatePRReview(provider, {
      diff: [
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
      ].join("\n"),
    });

    expect(review.findings).toEqual([]);

    const request = provider.generateText.mock.calls[0]?.[0];
    expect(request?.prompt).toContain("Review classification: standard.");
    expect(request?.prompt).toContain(
      "Classification signal: No added or removed lines were detected in the diff."
    );
    expect(request?.prompt).not.toContain("This diff is documentation-heavy");
  });

  it("trims noisy review output down to the top five combined risks", async () => {
    const provider = createProvider({
      summary: "The diff introduces several reviewer-visible risks that should be narrowed before review.",
      findings: [
        {
          title: "Auth bypass on the admin path",
          severity: "high",
          confidence: "high",
          category: "security",
          affectedFile: "packages/cli/src/index.ts",
          body: "The new admin flow does not show any permission check before executing the command.",
          whyThisMatters: "A privileged action can become reachable from an unguarded path.",
        },
        {
          title: "Retry loop can duplicate writes",
          severity: "high",
          confidence: "medium",
          category: "correctness",
          affectedFile: "packages/cli/src/runtime.ts",
          body: "The retried operation now reuses a write path without an idempotency guard.",
          whyThisMatters: "A transient failure can produce duplicated state changes.",
        },
        {
          title: "No regression test covers the fallback branch",
          severity: "medium",
          confidence: "medium",
          category: "testing",
          affectedFile: "packages/cli/src/runtime.test.ts",
          body: "The new fallback path is reachable from the diff but has no direct test coverage.",
          whyThisMatters: "A later refactor can silently break the branch without a focused test.",
        },
      ],
      comments: [
        {
          path: "packages/cli/src/index.ts",
          line: 11,
          severity: "high",
          confidence: "high",
          category: "correctness",
          affectedFile: "packages/cli/src/index.ts",
          body: "This branch now dereferences `issueNumber` before validation.",
          whyThisMatters: "Malformed input can crash the command instead of failing clearly.",
        },
        {
          path: "packages/cli/src/runtime.ts",
          line: 21,
          severity: "medium",
          confidence: "high",
          category: "maintainability",
          affectedFile: "packages/cli/src/runtime.ts",
          body: "The new fallback path is spread across two flags with no shared guard helper.",
          whyThisMatters: "The next edit can change one branch and leave the other inconsistent.",
        },
        {
          path: "packages/cli/src/setup.ts",
          line: 31,
          severity: "low",
          confidence: "high",
          category: "documentation",
          affectedFile: "packages/cli/src/setup.ts",
          body: "This inline note is vague about when the setup path runs.",
          whyThisMatters: "Reviewers need to infer the lifecycle from nearby code.",
        },
        {
          path: "packages/cli/src/config.ts",
          line: 41,
          severity: "low",
          confidence: "low",
          category: "maintainability",
          affectedFile: "packages/cli/src/config.ts",
          body: "This rename could be clearer.",
          whyThisMatters: "Future readers may need extra context.",
        },
      ],
    });

    const review = await generatePRReview(provider, {
      diff: [
        "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
        "--- a/packages/cli/src/index.ts",
        "+++ b/packages/cli/src/index.ts",
        "@@ -10,0 +11,2 @@",
        "+const nextIssueNumber = issueNumber.value;",
        "+runAdminFlow(nextIssueNumber);",
        "diff --git a/packages/cli/src/runtime.ts b/packages/cli/src/runtime.ts",
        "--- a/packages/cli/src/runtime.ts",
        "+++ b/packages/cli/src/runtime.ts",
        "@@ -20,0 +21,2 @@",
        "+retryWrite();",
        "+enableFallbackMode();",
        "diff --git a/packages/cli/src/setup.ts b/packages/cli/src/setup.ts",
        "--- a/packages/cli/src/setup.ts",
        "+++ b/packages/cli/src/setup.ts",
        "@@ -30,0 +31,1 @@",
        "+// setup note",
        "diff --git a/packages/cli/src/config.ts b/packages/cli/src/config.ts",
        "--- a/packages/cli/src/config.ts",
        "+++ b/packages/cli/src/config.ts",
        "@@ -40,0 +41,1 @@",
        "+const nextName = configName;",
      ].join("\n"),
    });

    expect(review.findings.map((finding) => finding.title)).toEqual([
      "Auth bypass on the admin path",
      "Retry loop can duplicate writes",
      "No regression test covers the fallback branch",
    ]);
    expect(review.comments.map((comment) => comment.path)).toEqual([
      "packages/cli/src/index.ts",
      "packages/cli/src/runtime.ts",
    ]);
    expect(review.comments).toHaveLength(2);
    expect(review.findings.length + review.comments.length).toBe(5);
  });
});
