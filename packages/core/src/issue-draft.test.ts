import { describe, expect, it } from "vitest";
import { generateIssueDraft } from "./issue-draft";

describe("generateIssueDraft", () => {
  it("accepts model output when constraints are null", async () => {
    const result = await generateIssueDraft(
      {
        generateText: async () =>
          JSON.stringify({
            title: "Add issue implementation plan command",
            summary: "Introduce a command to draft an issue resolution plan.",
            motivation:
              "Contributors need an editable plan before implementation starts.",
            goal: "Make issue execution more deliberate and reviewable.",
            proposedBehavior: [
              "Generate a plan from the issue context.",
              "Store the plan somewhere collaborators can edit before implementation.",
            ],
            requirements: [
              "Allow the user to revise the generated plan.",
              "Reuse the plan during later issue execution.",
            ],
            constraints: null,
            acceptanceCriteria: [
              "The plan can be generated from the CLI.",
              "Later issue work can reference the saved plan.",
            ],
          }),
      },
      {
        featureIdea: "Add an issue plan command.",
      }
    );

    expect(result.constraints).toBeUndefined();
  });

  it("accepts model output when constraints are omitted", async () => {
    const result = await generateIssueDraft(
      {
        generateText: async () =>
          JSON.stringify({
            title: "Add issue implementation plan command",
            summary: "Introduce a command to draft an issue resolution plan.",
            motivation:
              "Contributors need an editable plan before implementation starts.",
            goal: "Make issue execution more deliberate and reviewable.",
            proposedBehavior: [
              "Generate a plan from the issue context.",
              "Store the plan somewhere collaborators can edit before implementation.",
            ],
            requirements: [
              "Allow the user to revise the generated plan.",
              "Reuse the plan during later issue execution.",
            ],
            acceptanceCriteria: [
              "The plan can be generated from the CLI.",
              "Later issue work can reference the saved plan.",
            ],
          }),
      },
      {
        featureIdea: "Add an issue plan command.",
      }
    );

    expect(result.constraints).toBeUndefined();
  });
});
