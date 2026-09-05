import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Structural regression guards, not evidence of native agent behavior.
describe("create and refine approval instructions", () => {
  it("requires approval of written creation artifacts and verified publication", () => {
    const skill = readFileSync("skills/prs-create/SKILL.md", "utf8");
    for (const heading of ["Specification approval", "Plan approval", "Publication approval", "Completion verification"]) {
      expect(skill).toContain(`## ${heading}`);
    }
    for (const reference of ["superpowers:brainstorming", "superpowers:writing-plans", "prs tool issue context", "prs tool issue publish-artifacts"]) {
      expect(skill).toContain(reference);
    }
    for (const mode of ["--draft-file", "--issue-set"]) {
      expect(skill.split("\n").some(line => line.includes(`prs tool issue create ${mode}`) && line.includes("--spec-file") && line.includes("--plan-file"))).toBe(true);
    }
    expect(skill).not.toContain("artifacts when available");
  });

  it("keeps refinement on the original issue and gates implementation separately", () => {
    const skill = readFileSync("skills/prs-issue/SKILL.md", "utf8");
    const refinement = skill.split("## Refinement\n")[1]?.split("\n## ")[0] ?? "";
    for (const reference of ["superpowers:brainstorming", "superpowers:writing-plans", "explicit user approval", "prs tool issue publish-artifacts", "prs tool issue context"]) {
      expect(refinement).toContain(reference);
    }
    expect(refinement).toMatch(/preserve the original issue number, URL and request body/i);
    expect(refinement).toMatch(/stop after verified publication unless implementation was requested/i);
    expect(skill.split("## Lifecycle\n")[1]).toMatch(/only when implementation was requested/i);
  });
});
