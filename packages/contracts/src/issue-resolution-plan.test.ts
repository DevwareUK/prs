import { describe, expect, it } from "vitest";
import {
  IssueResolutionPlanModelOutput,
  IssueResolutionPlanOutput,
} from "./issue-resolution-plan";

function createIssueResolutionPlanPayload() {
  return {
    summary: "Create an editable implementation plan before coding starts.",
    implementationSteps: [
      "Fetch the GitHub issue and derive a first-pass plan from its context.",
      "Post the plan as a managed comment collaborators can edit on GitHub.",
    ],
    validationSteps: [
      "Confirm the plan comment is created on the target issue.",
      "Ensure later issue runs load the edited plan into their workspace snapshot.",
    ],
  };
}

describe("Issue resolution plan schemas", () => {
  it("accepts model output when optional lists are omitted", () => {
    const parsed = IssueResolutionPlanModelOutput.parse(
      createIssueResolutionPlanPayload()
    );

    expect(parsed.risks).toBeUndefined();
    expect(parsed.openQuestions).toBeUndefined();
  });

  it("accepts normalized output when optional lists are omitted", () => {
    const parsed = IssueResolutionPlanOutput.parse(
      createIssueResolutionPlanPayload()
    );

    expect(parsed.risks).toBeUndefined();
    expect(parsed.openQuestions).toBeUndefined();
  });
});
