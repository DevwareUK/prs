import { describe, expect, it } from "vitest";
import { PRAssistantOutput } from "./pr-assistant";

describe("PRAssistantOutput", () => {
  it("parses a valid PR assistant payload", () => {
    const parsed = PRAssistantOutput.parse({
      summary: "Adds a shared PR assistant section for generated review guidance.",
      keyChanges: ["Introduces a unified action and workflow."],
      riskAreas: ["Managed section replacement logic in the PR body."],
      reviewerFocus: ["Verify existing body content remains unchanged outside markers."],
    });

    expect(parsed).toEqual({
      summary: "Adds a shared PR assistant section for generated review guidance.",
      keyChanges: ["Introduces a unified action and workflow."],
      riskAreas: ["Managed section replacement logic in the PR body."],
      reviewerFocus: ["Verify existing body content remains unchanged outside markers."],
    });
  });

  it("rejects empty required fields", () => {
    expect(() =>
      PRAssistantOutput.parse({
        summary: "   ",
        keyChanges: ["Valid change"],
        riskAreas: [],
        reviewerFocus: ["Valid focus"],
      })
    ).toThrow();
  });
});
