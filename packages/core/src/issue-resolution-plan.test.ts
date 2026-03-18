import { describe, expect, it } from "vitest";
import { generateIssueResolutionPlan } from "./issue-resolution-plan";

describe("generateIssueResolutionPlan", () => {
  it("accepts model output when optional lists are null", async () => {
    const result = await generateIssueResolutionPlan(
      {
        generateText: async () =>
          JSON.stringify({
            summary: "Create a reusable issue resolution plan comment.",
            implementationSteps: [
              "Generate the plan from the issue description.",
              "Persist it in a GitHub comment users can edit.",
            ],
            validationSteps: [
              "Verify the comment is posted successfully.",
              "Ensure later issue runs load the edited comment.",
            ],
            risks: null,
            openQuestions: null,
          }),
      },
      {
        issueNumber: 42,
        issueTitle: "Add Command to Generate and Modify Issue Resolution Plan",
        issueBody: "Add a command that posts an editable resolution plan comment.",
      }
    );

    expect(result.risks).toBeUndefined();
    expect(result.openQuestions).toBeUndefined();
  });

  it("accepts model output when optional lists are omitted", async () => {
    const result = await generateIssueResolutionPlan(
      {
        generateText: async () =>
          JSON.stringify({
            summary: "Create a reusable issue resolution plan comment.",
            implementationSteps: [
              "Generate the plan from the issue description.",
              "Persist it in a GitHub comment users can edit.",
            ],
            validationSteps: [
              "Verify the comment is posted successfully.",
              "Ensure later issue runs load the edited comment.",
            ],
          }),
      },
      {
        issueNumber: 42,
        issueTitle: "Add Command to Generate and Modify Issue Resolution Plan",
      }
    );

    expect(result.risks).toBeUndefined();
    expect(result.openQuestions).toBeUndefined();
  });
});
