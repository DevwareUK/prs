import { describe, expect, it } from "vitest";
import { PRAssistantOutput } from "./pr-assistant";

describe("PRAssistantOutput", () => {
  it("parses a valid PR assistant payload", () => {
    const parsed = PRAssistantOutput.parse({
      summary: "Adds a shared PR assistant section for generated review guidance.",
      riskAreas: ["Managed section replacement logic in the PR body."],
      filesChanged: ["actions/pr-assistant/src/index.ts"],
      testingNotes: ["pnpm build"],
      rolloutConcerns: ["Managed section replacement depends on stable markers."],
      reviewerChecklist: [
        "Verify existing body content remains unchanged outside markers.",
      ],
    });

    expect(parsed).toEqual({
      summary: "Adds a shared PR assistant section for generated review guidance.",
      riskAreas: ["Managed section replacement logic in the PR body."],
      filesChanged: ["actions/pr-assistant/src/index.ts"],
      testingNotes: ["pnpm build"],
      rolloutConcerns: ["Managed section replacement depends on stable markers."],
      reviewerChecklist: [
        "Verify existing body content remains unchanged outside markers.",
      ],
    });
  });

  it("rejects empty required fields", () => {
    expect(() =>
      PRAssistantOutput.parse({
        summary: "   ",
        riskAreas: [],
        filesChanged: ["actions/pr-assistant/src/index.ts"],
        testingNotes: [],
        rolloutConcerns: [],
        reviewerChecklist: ["Valid focus"],
      })
    ).toThrow();
  });
});
