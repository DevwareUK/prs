import { describe, expect, it } from "vitest";
import {
  IssueDraftGuidanceOutput,
  IssueDraftSet,
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

  it("accepts clarification guidance output when missingInformation is empty", () => {
    const parsed = IssueDraftGuidanceOutput.parse({
      status: "clarify",
      assistantSummary: "The rough idea is usable, but the workflow details still need one follow-up.",
      missingInformation: [],
      questions: [
        "Should the first version stop after generating the local draft, or should it also create the GitHub issue automatically?",
      ],
    });

    expect(parsed).toMatchObject({
      status: "clarify",
      missingInformation: [],
    });
  });

  it("defaults missingInformation to an empty array when it is omitted", () => {
    const parsed = IssueDraftGuidanceOutput.parse({
      status: "clarify",
      assistantSummary: "The rough idea is usable, but one implementation decision still needs confirmation.",
      questions: [
        "Should the flow keep the current markdown sections, or should it add a technical considerations section when needed?",
      ],
    });

    expect(parsed).toMatchObject({
      status: "clarify",
      missingInformation: [],
    });
  });

  it("accepts all blocking clarification questions without an artificial cap", () => {
    const parsed = IssueDraftGuidanceOutput.parse({
      status: "clarify",
      assistantSummary:
        "The issue needs a full refinement pass before a specification can be written.",
      questions: [
        "Who can access the new order information?",
        "Should the new information appear in confirmation emails?",
        "Should the new information appear in admin reports?",
        "What should happen to existing orders that do not have this data?",
        "How will support users know the change is complete?",
      ],
    });

    expect(parsed.status).toBe("clarify");
    expect(parsed.questions).toHaveLength(5);
  });

  describe("issue set manifests", () => {
    it("accepts a valid multi-issue manifest", () => {
      const parsed = IssueDraftSet.parse({
        version: 1,
        mode: "multiple",
        sourceIssueNumber: 156,
        linkingStrategy: "Split the workflow into contract and CLI changes.",
        issues: [
          {
            id: "contracts",
            draftFile: ".prs/runs/run/contracts.md",
            blocks: ["cli"],
          },
          {
            id: "cli",
            draftFile: ".prs/runs/run/cli.md",
            dependsOn: ["contracts"],
            related: ["contracts"],
          },
        ],
      });

      expect(parsed.issues[0]).toMatchObject({
        id: "contracts",
        dependsOn: [],
        blocks: ["cli"],
        related: [],
      });
      expect(parsed.sourceIssueNumber).toBe(156);
    });

    it("rejects duplicate issue ids", () => {
      const parsed = IssueDraftSet.safeParse({
        version: 1,
        mode: "multiple",
        issues: [
          { id: "cli", draftFile: "one.md" },
          { id: "cli", draftFile: "two.md" },
        ],
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
        'duplicate issue id "cli"'
      );
    });

    it("rejects unknown relationship targets", () => {
      const parsed = IssueDraftSet.safeParse({
        version: 1,
        mode: "multiple",
        issues: [
          { id: "contracts", draftFile: "contracts.md", blocks: ["cli"] },
          { id: "docs", draftFile: "docs.md" },
        ],
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
        'issue "contracts" references unknown issue "cli"'
      );
    });

    it("rejects multiple mode with fewer than two issues", () => {
      expect(() =>
        IssueDraftSet.parse({
          version: 1,
          mode: "multiple",
          issues: [{ id: "only", draftFile: "only.md" }],
        })
      ).toThrow(/multiple issue sets require at least two issues/);
    });
  });
});
