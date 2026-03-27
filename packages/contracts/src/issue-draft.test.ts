import { describe, expect, it } from "vitest";
import {
  IssueDraftGuidanceOutput,
  IssueDraftModelOutput,
  IssueDraftOutput,
} from "./issue-draft";

function createIssueDraftPayload() {
  return {
    title: "Add issue implementation plan command",
    summary: "Introduce a command to draft an issue resolution plan.",
    motivation: "Contributors need an editable plan before implementation starts.",
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
  };
}

describe("Issue draft schemas", () => {
  it("accepts model output when constraints are omitted", () => {
    const parsed = IssueDraftModelOutput.parse(createIssueDraftPayload());

    expect(parsed.constraints).toBeUndefined();
  });

  it("accepts normalized output when constraints are omitted", () => {
    const parsed = IssueDraftOutput.parse(createIssueDraftPayload());

    expect(parsed.constraints).toBeUndefined();
  });

  it("accepts clarification guidance output", () => {
    const parsed = IssueDraftGuidanceOutput.parse({
      status: "clarify",
      assistantSummary: "The rough idea is directionally clear, but the workflow scope is still ambiguous.",
      missingInformation: [
        "Whether the guided flow should keep the current issue markdown structure.",
      ],
      questions: [
        "Should the guided flow preserve the current issue draft markdown sections or introduce new sections such as out-of-scope and technical considerations?",
      ],
    });

    expect(parsed.status).toBe("clarify");
  });
});
