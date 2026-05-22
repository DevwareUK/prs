import { describe, expect, it } from "vitest";
import {
  EMPTY_PR_IMPACT_PROFILE,
  formatPRImpactProfileMarkdown,
  serializePRImpactProfile,
} from "./pr-impact-profile";

describe("PR impact profile helpers", () => {
  it("serializes impact profiles consistently for action outputs", () => {
    expect(serializePRImpactProfile(EMPTY_PR_IMPACT_PROFILE)).toBe(
      JSON.stringify(EMPTY_PR_IMPACT_PROFILE, null, 2)
    );
  });

  it("renders high-risk profile details for PR review and assistant surfaces", () => {
    const markdown = formatPRImpactProfileMarkdown({
      riskLevel: "high",
      riskReasons: ["Auth guard behavior changes in the CLI runtime."],
      affectedAreas: ["packages/cli/src/runtime.ts"],
      rolloutImpact: ["Coordinate release notes for runtime users."],
      migrationImpact: ["Existing generated run artifacts remain compatible."],
      configurationImpact: ["Requires GITHUB_TOKEN for PR publishing."],
      flags: {
        security: true,
        performance: true,
      },
      manualVerification: ["Run an authenticated local PR review."],
    });

    expect(markdown).toContain("## Impact Profile");
    expect(markdown).toContain("Risk level: high");
    expect(markdown).toContain("- Auth guard behavior changes in the CLI runtime.");
    expect(markdown).toContain("- Security-sensitive change");
    expect(markdown).toContain("- Performance-sensitive change");
    expect(markdown).toContain("### Manual verification");
    expect(markdown).toContain("- Run an authenticated local PR review.");
  });

  it("renders calm empty states for low and empty profiles", () => {
    const lowRisk = formatPRImpactProfileMarkdown({
      ...EMPTY_PR_IMPACT_PROFILE,
      riskLevel: "low",
      affectedAreas: ["README.md"],
    });
    const empty = formatPRImpactProfileMarkdown(EMPTY_PR_IMPACT_PROFILE);

    expect(lowRisk).toContain("Risk level: low");
    expect(lowRisk).toContain("- README.md");
    expect(lowRisk).not.toContain("Rollout impact");
    expect(empty).toContain("Risk level: none");
    expect(empty).toContain("No specific impact concerns noted.");
    expect(empty).not.toContain("warning");
  });
});
