import { describe, expect, it } from "vitest";
import {
  UNATTENDED_GITHUB_OUTPUT_NOTE,
  type TestSuggestionsOutputType,
} from "@prs/contracts";
import {
  applyAddressedSuggestionUpdates,
  buildCommentBody,
  parseChecklistCommentBody,
} from "./comment";

describe("buildCommentBody", () => {
  it("renders compact but task-ready suggestion details", () => {
    const body = buildCommentBody({
      summary: "The CLI workflow needs richer test tasks that can be implemented directly.",
      suggestedTests: [
        {
          area: "Verify pr fix-tests snapshot keeps task context",
          priority: "high",
          testType: "integration",
          behavior:
            "Selecting a suggestion should preserve behavior, regression risk, and implementation guidance in the run artifacts.",
          regressionRisk:
            "The selected task can lose critical context before the runtime starts editing tests.",
          value:
            "This makes the handoff usable as an implementation task instead of a vague reminder.",
          protectedPaths: [
            "packages/cli/src/workflows/pr-fix-tests/snapshot.ts",
            "packages/cli/src/workflows/pr-fix-tests/workspace.ts",
          ],
          likelyLocations: [
            "packages/cli/src/workflows/pr-fix-tests/workspace.test.ts",
          ],
          edgeCases: [
            "The managed comment includes shared edge cases plus suggestion-specific ones.",
          ],
          implementationNote:
            "Add a workspace test that asserts the snapshot and metadata keep the richer selected suggestion fields.",
        },
      ],
      edgeCases: ["Malformed managed comments should still fail clearly."],
    } satisfies TestSuggestionsOutputType);

    expect(body).toContain("## AI Test Suggestions");
    expect(body).toContain(UNATTENDED_GITHUB_OUTPUT_NOTE);
    expect(body).toContain("#### Verify pr fix-tests snapshot keeps task context");
    expect(body).toContain("- [ ] Addressed");
    expect(body).toContain("- Test type: integration");
    expect(body).toContain("- Behavior covered: Selecting a suggestion should preserve behavior");
    expect(body).toContain("- Regression risk: The selected task can lose critical context");
    expect(body).toContain(
      "- Protected paths: `packages/cli/src/workflows/pr-fix-tests/snapshot.ts`, `packages/cli/src/workflows/pr-fix-tests/workspace.ts`"
    );
    expect(body).toContain("  - The managed comment includes shared edge cases");
    expect(body).toContain("- Implementation note: Add a workspace test");
    expect(body).toContain("### Edge cases");
    expect(body).toContain("### Likely places to add tests");
  });

  it("renders an explicit no-new-unresolved state when there are no suggestions", () => {
    const body = buildCommentBody({
      summary: "No new unresolved AI test suggestions were found for the current PR diff.",
      suggestedTests: [],
    } satisfies TestSuggestionsOutputType);

    expect(body).toContain("## AI Test Suggestions");
    expect(body).toContain("No new unresolved AI test suggestions were found");
    expect(body).not.toContain("### Suggested test areas");
  });

  it("can render developer-approved manual comments without automation framing", () => {
    const body = buildCommentBody(
      {
        summary: "No new unresolved AI test suggestions were found for the current PR diff.",
        suggestedTests: [],
      } satisfies TestSuggestionsOutputType,
      "manual"
    );

    expect(body).toContain("## AI Test Suggestions");
    expect(body).not.toContain(UNATTENDED_GITHUB_OUTPUT_NOTE);
  });
});

describe("parseChecklistCommentBody", () => {
  const existingBody = [
    "<!-- prs:test-suggestions -->",
    "",
    UNATTENDED_GITHUB_OUTPUT_NOTE,
    "",
    "## AI Test Suggestions",
    "",
    "### Overview",
    "Tests are needed.",
    "",
    "### Suggested test areas",
    "",
    "#### Verify checkout flow",
    "- [ ] Addressed",
    "- Priority: High",
    "- Test type: integration",
    "- Behavior covered: Checkout completes.",
    "- Regression risk: Checkout can fail silently.",
    "- Why it matters: It protects revenue.",
    "- Implementation note: Add a checkout workflow test.",
    "",
    "#### Verify summary copy",
    "- [x] Addressed",
    "- Priority: Medium",
    "- Test type: unit",
    "- Behavior covered: Summary copy renders.",
    "- Regression risk: Copy can regress.",
    "- Why it matters: It protects support workflows.",
    "- Implementation note: Add a rendering test.",
  ].join("\n");

  it("parses checked and unchecked checklist suggestions", () => {
    expect(parseChecklistCommentBody(existingBody)).toEqual({
      overview: "Tests are needed.",
      suggestions: [
        {
          suggestionId: "suggestion-1",
          area: "Verify checkout flow",
          addressed: false,
          priority: "high",
          testType: "integration",
          behavior: "Checkout completes.",
          regressionRisk: "Checkout can fail silently.",
          value: "It protects revenue.",
          protectedPaths: [],
          likelyLocations: [],
          edgeCases: [],
          implementationNote: "Add a checkout workflow test.",
        },
        {
          suggestionId: "suggestion-2",
          area: "Verify summary copy",
          addressed: true,
          priority: "medium",
          testType: "unit",
          behavior: "Summary copy renders.",
          regressionRisk: "Copy can regress.",
          value: "It protects support workflows.",
          protectedPaths: [],
          likelyLocations: [],
          edgeCases: [],
          implementationNote: "Add a rendering test.",
        },
      ],
    });
  });

  it("checks addressed suggestions while preserving existing checked items and text", () => {
    const updatedBody = applyAddressedSuggestionUpdates(existingBody, ["suggestion-1"]);

    expect(updatedBody).toContain("#### Verify checkout flow\n- [x] Addressed");
    expect(updatedBody).toContain("#### Verify summary copy\n- [x] Addressed");
    expect(updatedBody).toContain("- Implementation note: Add a checkout workflow test.");
    expect(updatedBody).toContain("- Implementation note: Add a rendering test.");
  });

  it("removes legacy resolved suggestion ledger blocks while checking addressed suggestions", () => {
    const body = [
      "<!-- prs:test-suggestions -->",
      "<!-- prs:test-suggestions:resolved-start -->",
      "[",
      "  { \"commitSha\": \"old-ledger-sha\" }",
      "]",
      "<!-- prs:test-suggestions:resolved-end -->",
      "## AI Test Suggestions",
      "",
      "### Suggested test areas",
      "",
      "#### Verify checkout flow",
      "- [ ] Addressed",
      "- Priority: High",
      "- Test type: integration",
      "- Behavior covered: Checkout completes.",
      "- Regression risk: Checkout can fail silently.",
      "- Why it matters: It protects revenue.",
      "- Implementation note: Add a checkout workflow test.",
    ].join("\n");

    const updatedBody = applyAddressedSuggestionUpdates(body, ["suggestion-1"]);

    expect(updatedBody).toContain("#### Verify checkout flow\n- [x] Addressed");
    expect(updatedBody).not.toContain("<!-- prs:test-suggestions:resolved-start -->");
    expect(updatedBody).not.toContain("<!-- prs:test-suggestions:resolved-end -->");
    expect(updatedBody).not.toContain("old-ledger-sha");
  });
});
