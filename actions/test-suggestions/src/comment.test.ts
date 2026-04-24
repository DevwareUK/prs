import { describe, expect, it } from "vitest";
import type { TestSuggestionsOutputType } from "@prs/contracts";
import { buildCommentBody } from "./comment";

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
});
