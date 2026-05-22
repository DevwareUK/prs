import { describe, expect, it } from "vitest";
import { PRImpactProfile } from "./pr-impact-profile";

describe("PRImpactProfile", () => {
  it("parses an empty profile with calm defaults", () => {
    expect(PRImpactProfile.parse({})).toEqual({
      riskLevel: "none",
      riskReasons: [],
      affectedAreas: [],
      rolloutImpact: [],
      migrationImpact: [],
      configurationImpact: [],
      flags: {
        security: false,
        performance: false,
      },
      manualVerification: [],
    });
  });

  it("parses a high-risk profile with rollout and verification details", () => {
    expect(
      PRImpactProfile.parse({
        riskLevel: "high",
        riskReasons: ["Changes authentication behavior."],
        affectedAreas: ["packages/cli/src/github-auth.ts"],
        rolloutImpact: ["Coordinate rollout with CLI users."],
        migrationImpact: ["Existing sessions may need to refresh credentials."],
        configurationImpact: ["Requires GITHUB_TOKEN to be present."],
        flags: {
          security: true,
          performance: false,
        },
        manualVerification: ["Run an authenticated PR review flow."],
      })
    ).toEqual({
      riskLevel: "high",
      riskReasons: ["Changes authentication behavior."],
      affectedAreas: ["packages/cli/src/github-auth.ts"],
      rolloutImpact: ["Coordinate rollout with CLI users."],
      migrationImpact: ["Existing sessions may need to refresh credentials."],
      configurationImpact: ["Requires GITHUB_TOKEN to be present."],
      flags: {
        security: true,
        performance: false,
      },
      manualVerification: ["Run an authenticated PR review flow."],
    });
  });
});
