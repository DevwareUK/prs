import { describe, expect, it, vi } from "vitest";
import type { AIProvider } from "@prs/providers";
import { generatePRAssistant } from "./pr-assistant";

describe("generatePRAssistant", () => {
  it("derives the files changed list from the diff structure", async () => {
    const provider: AIProvider = {
      generateText: vi.fn().mockResolvedValue(
        JSON.stringify({
          summary: "Reworks the managed PR assistant section into a stable reviewer format.",
          riskAreas: ["Managed section replacement logic now renders more sections."],
          testingNotes: ["Build coverage for the updated contract and renderer should be verified."],
          rolloutConcerns: [],
          reviewerChecklist: ["Confirm manual PR body content remains outside the managed markers."],
        })
      ),
    };

    const result = await generatePRAssistant(provider, {
      diff: [
        "diff --git a/packages/core/src/pr-assistant.ts b/packages/core/src/pr-assistant.ts",
        "--- a/packages/core/src/pr-assistant.ts",
        "+++ b/packages/core/src/pr-assistant.ts",
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new",
        "diff --git a/actions/pr-assistant/README.md b/actions/pr-assistant/README.md",
        "--- a/actions/pr-assistant/README.md",
        "+++ b/actions/pr-assistant/README.md",
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new",
      ].join("\n"),
    });

    expect(result.filesChanged).toEqual([
      "packages/core/src/pr-assistant.ts",
      "actions/pr-assistant/README.md",
    ]);
    expect(result.summary).toContain("stable reviewer format");
  });
});
