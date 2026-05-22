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

  it("returns the shared impact profile for PR assistant output", async () => {
    const provider: AIProvider = {
      generateText: vi.fn().mockResolvedValue(
        JSON.stringify({
          summary: "Adds a structured impact profile to the assistant section.",
          impactProfile: {
            riskLevel: "low",
            riskReasons: ["The rendered dashboard shape changes."],
            affectedAreas: ["actions/pr-assistant/src/index.ts"],
            rolloutImpact: [],
            migrationImpact: [],
            configurationImpact: [],
            flags: {
              security: false,
              performance: false,
            },
            manualVerification: ["Preview the managed PR assistant section."],
          },
          testingNotes: ["Unit tests cover the renderer."],
          reviewerChecklist: [],
        })
      ),
    };

    const result = await generatePRAssistant(provider, {
      diff: [
        "diff --git a/actions/pr-assistant/src/index.ts b/actions/pr-assistant/src/index.ts",
        "--- a/actions/pr-assistant/src/index.ts",
        "+++ b/actions/pr-assistant/src/index.ts",
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new",
      ].join("\n"),
    });

    expect(result.impactProfile.riskLevel).toBe("low");
    expect(result.impactProfile.manualVerification).toEqual([
      "Preview the managed PR assistant section.",
    ]);

    const request = vi.mocked(provider.generateText).mock.calls[0]?.[0];
    expect(request?.prompt).toContain('"impactProfile": {');
    expect(request?.prompt).toContain(
      "Use the shared impact profile for PR-level risk metadata"
    );
  });
});
