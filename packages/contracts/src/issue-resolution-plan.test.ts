import { describe, expect, it } from "vitest";
import {
  IssueResolutionPlanModelOutput,
  IssueResolutionPlanOutput,
} from "./issue-resolution-plan";

function createIssueResolutionPlanPayload() {
  return {
    summary: "Create an editable implementation plan before coding starts.",
    acceptanceCriteria: [
      "Users can explicitly regenerate a managed issue plan comment when issue scope changes.",
    ],
    likelyFiles: [
      "packages/cli/src/index.ts",
      "packages/cli/src/github.ts",
      "README.md",
    ],
    implementationSteps: [
      "Fetch the GitHub issue and derive a first-pass plan from its context.",
      "Post the plan as a managed comment collaborators can edit on GitHub.",
    ],
    testPlan: [
      "Confirm the plan comment is created on the target issue.",
      "Ensure later issue runs load the edited plan into their workspace snapshot.",
    ],
    risks: [
      "Refreshing the managed plan comment must stay opt-in so collaborator edits are not overwritten accidentally.",
    ],
    doneDefinition: [
      "The managed issue plan comment reflects the latest requested regeneration.",
    ],
  };
}

describe("Issue resolution plan schemas", () => {
  it("accepts model output when open questions are omitted", () => {
    const parsed = IssueResolutionPlanModelOutput.parse(
      createIssueResolutionPlanPayload()
    );

    expect(parsed.openQuestions).toBeUndefined();
  });

  it("accepts normalized output when open questions are omitted", () => {
    const parsed = IssueResolutionPlanOutput.parse(
      createIssueResolutionPlanPayload()
    );

    expect(parsed.openQuestions).toBeUndefined();
  });
});
