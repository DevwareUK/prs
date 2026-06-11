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

  it("extracts repository targets from step-driven plans without likely files sections", () => {
    const plan = [
      "<!-- prs:issue-plan -->",
      "# Remove Broken reCAPTCHA Implementation Plan",
      "",
      "## Tasks",
      "",
      "### 1. Remove backend captcha validation",
      "- Modify `app/Http/Requests/ContactRequest.php` so the rules only require `name`, `email`, and `message`.",
      "- Remove the validator registration from `app/Providers/AppServiceProvider.php`.",
      "- Delete `app/Validators/ReCaptcha.php`.",
      "- Remove the `recaptcha` block from `config/orro.php`.",
      "",
      "### 2. Remove captcha from forms",
      "- Modify `resources/views/contact/_form.blade.php` to remove the captcha markup.",
      "- Check `resources/views/contact/view.blade.php` for captcha-specific JavaScript.",
      "- Update `resources/js/components/Product/ProductContactForm.vue`.",
      "- Remove `vue-recaptcha` from `package.json` and `package-lock.json`.",
      "- Update GitHub/comment selection without treating that prose as a repository path.",
    ].join("\n");

    expect(extractIssueImplementationPlanFiles(plan)).toEqual([
      "app/Http/Requests/ContactRequest.php",
      "app/Providers/AppServiceProvider.php",
      "app/Validators/ReCaptcha.php",
      "config/orro.php",
      "resources/views/contact/_form.blade.php",
      "resources/views/contact/view.blade.php",
      "resources/js/components/Product/ProductContactForm.vue",
      "package.json",
      "package-lock.json",
    ]);
  });

  it("does not force low confidence for concrete step-driven plans with scope targets", () => {
    const estimate = estimateIssueImplementationTokens({
      planBody: [
        "<!-- prs:issue-plan -->",
        "# Implementation Plan",
        "",
        "## Tasks",
        "",
        "### 1. Add regression coverage",
        "- Add tests in `packages/core/src/issue-token-estimate.test.ts`.",
        "",
        "### 2. Update extraction",
        "- Update `packages/core/src/issue-token-estimate.ts` to derive scope targets from implementation steps.",
        "",
        "### 3. Tighten comment lookup",
        "- Update `packages/cli/src/github.ts` and `packages/cli/src/index.ts`.",
      ].join("\n"),
      profiles: [
        {
          name: "standard",
          model: "gpt-5.4-mini",
          thinking: "medium",
        },
      ],
    });

    expect(estimate.confidence).not.toBe("low");
    expect(estimate.drivers).toContain("4 repository targets detected.");
  });

  it("recognizes checkbox task plans with future repository targets as structured work", () => {
    const estimate = estimateIssueImplementationTokens({
      planBody: [
        "<!-- prs:issue-plan -->",
        "# Add Recipe Page Implementation Plan",
        "",
        "## File Map",
        "",
        "- Modify: `tests/recipes-page.test.mjs`",
        "- Modify: `tests/recipe-import.test.mjs`",
        "- Create: `src/app/app/recipes/_components/add-recipe-form.tsx`",
        "- Create: `src/app/app/recipes/add/page.tsx`",
        "- Modify: `src/app/app/recipes/page.tsx`",
        "- Delete: `src/app/app/recipes/_components/add-recipe-modal.tsx`",
        "",
        "## Task 1: Pin The Route And Recipes Page Expectations",
        "",
        "- [ ] **Step 1: Update the existing recipes page test to expect the add route**",
        "- [ ] **Step 2: Run the focused recipes page test and confirm it fails**",
        "",
        "```bash",
        "pnpm run test -- tests/recipes-page.test.mjs",
        "```",
        "",
        "## Task 2: Pin The Add Form Expectations",
        "",
        "- [ ] **Step 1: Update the component existence assertion**",
        "- [ ] **Step 2: Update dark-mode editor test to read the form component**",
      ].join("\n"),
      profiles: [
        {
          name: "standard",
          model: "gpt-5.4-mini",
          thinking: "medium",
        },
      ],
      context: {
        likelyFiles: [
          { path: "tests/recipes-page.test.mjs", exists: true, lineCount: 120 },
          { path: "tests/recipe-import.test.mjs", exists: true, lineCount: 170 },
          {
            path: "src/app/app/recipes/_components/add-recipe-form.tsx",
            exists: false,
            lineCount: 0,
          },
          { path: "src/app/app/recipes/add/page.tsx", exists: false, lineCount: 0 },
          { path: "src/app/app/recipes/page.tsx", exists: true, lineCount: 240 },
          {
            path: "src/app/app/recipes/_components/add-recipe-modal.tsx",
            exists: true,
            lineCount: 180,
          },
        ],
        scanBudget: {
          filesConsidered: 18,
          filesScanned: 4,
          maxFiles: 12,
          exhausted: true,
        },
      },
    });

    expect(estimate.confidence).toBe("medium");
    expect(estimate.drivers).toContain("4 implementation steps detected.");
    expect(estimate.warnings).toContain(
      "Repository context scan limit was reached; estimate confidence is reduced."
    );
    expect(estimate.warnings).not.toContain(
      "Estimate confidence is low; refine or split the plan before relying on the range."
    );
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
    expect(estimate.drivers).toContain("0 repository targets detected.");
    expect(estimate.warnings).toContain(
      "Estimate confidence is low; refine or split the plan before relying on the range."
    );
  });

  it("warns and lowers confidence to medium when repository targets are missing or scan limit is reached", () => {
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

    expect(estimate.confidence).toBe("medium");
    expect(estimate.scanBudget).toEqual({
      status: "exhausted",
      filesConsidered: 20,
      filesScanned: 1,
      maxFiles: 12,
    });
    expect(estimate.warnings).toContain("4 repository targets were not found locally.");
    expect(estimate.warnings).toContain(
      "Repository context scan limit was reached; estimate confidence is reduced."
    );
    expect(estimate.warnings).not.toContain(
      "Estimate confidence is low; refine or split the plan before relying on the range."
    );
  });
});
