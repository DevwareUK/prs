import { describe, expect, it } from "vitest";
import { generateIssueDraft, generateIssueDraftGuidance } from "./issue-draft";

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

  it("generates clarification guidance when the model requests more detail", async () => {
    const result = await generateIssueDraftGuidance(
      {
        generateText: async () =>
          JSON.stringify({
            status: "clarify",
            assistantSummary:
              "The feature direction is clear, but the workflow and rollout boundaries still need definition.",
            missingInformation: [
              "Whether the guided issue flow should stop after local draft generation or also update GitHub Actions surfaces.",
            ],
            questions: [
              "Should this first version be local CLI-only, or should it also update any GitHub Action entrypoints and docs in the same issue?",
            ],
          }),
      },
      {
        featureIdea: "Turn issue draft into a guided issue-spec workflow.",
        repositoryContext: "CLI lives in packages/cli and issue drafting logic lives in packages/core.",
      }
    );

    expect(result).toEqual({
      status: "clarify",
      assistantSummary:
        "The feature direction is clear, but the workflow and rollout boundaries still need definition.",
      missingInformation: [
        "Whether the guided issue flow should stop after local draft generation or also update GitHub Actions surfaces.",
      ],
      questions: [
        "Should this first version be local CLI-only, or should it also update any GitHub Action entrypoints and docs in the same issue?",
      ],
    });
  });
});
