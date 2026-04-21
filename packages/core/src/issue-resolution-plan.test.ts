import { describe, expect, it } from "vitest";
import { generateIssueResolutionPlan } from "./issue-resolution-plan";

describe("generateIssueResolutionPlan", () => {
  it("accepts model output when open questions are null", async () => {
    const result = await generateIssueResolutionPlan(
      {
        generateText: async () =>
          JSON.stringify({
            summary: "Create a reusable issue resolution plan comment.",
            acceptanceCriteria: [
              "Users can explicitly regenerate a managed issue plan comment.",
            ],
            likelyFiles: [
              "packages/cli/src/index.ts",
              "packages/cli/src/github.ts",
            ],
            implementationSteps: [
              "Generate the plan from the issue description.",
              "Persist it in a GitHub comment users can edit.",
            ],
            testPlan: [
              "Verify the comment is posted successfully.",
              "Ensure later issue runs load the edited comment.",
            ],
            risks: [
              "No concrete delivery risks were identified from the current issue context.",
            ],
            doneDefinition: [
              "The refreshed plan is visible in the managed issue comment.",
            ],
            openQuestions: null,
          }),
      },
      {
        issueNumber: 42,
        issueTitle: "Add Command to Generate and Modify Issue Resolution Plan",
        issueBody: "Add a command that posts an editable resolution plan comment.",
      }
    );

    expect(result.openQuestions).toBeUndefined();
  });

  it("accepts model output when open questions are omitted", async () => {
    const result = await generateIssueResolutionPlan(
      {
        generateText: async () =>
          JSON.stringify({
            summary: "Create a reusable issue resolution plan comment.",
            acceptanceCriteria: [
              "Users can explicitly regenerate a managed issue plan comment.",
            ],
            likelyFiles: [
              "packages/cli/src/index.ts",
              "packages/cli/src/github.ts",
            ],
            implementationSteps: [
              "Generate the plan from the issue description.",
              "Persist it in a GitHub comment users can edit.",
            ],
            testPlan: [
              "Verify the comment is posted successfully.",
              "Ensure later issue runs load the edited comment.",
            ],
            risks: [
              "No concrete delivery risks were identified from the current issue context.",
            ],
            doneDefinition: [
              "The refreshed plan is visible in the managed issue comment.",
            ],
          }),
      },
      {
        issueNumber: 42,
        issueTitle: "Add Command to Generate and Modify Issue Resolution Plan",
      }
    );

    expect(result.openQuestions).toBeUndefined();
  });
});
