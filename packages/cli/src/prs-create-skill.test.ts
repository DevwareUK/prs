import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Structural regression guards, not evidence of native agent behavior.
describe("create and refine approval instructions", () => {
  it("prepares one exact creation packet for a single approval and verified publication", () => {
    const skill = readFileSync("skills/prs-create/SKILL.md", "utf8");
    for (const heading of ["Artifact preparation", "Unified approval", "Completion verification"]) {
      expect(skill).toContain(`## ${heading}`);
    }
    for (const reference of ["superpowers:brainstorming", "superpowers:writing-plans", "prs tool issue context", "prs tool issue publish-artifacts"]) {
      expect(skill).toContain(reference);
    }
    const preparation = skill.split("## Artifact preparation\n")[1]?.split("\n## ")[0] ?? "";
    const approval = skill.split("## Unified approval\n")[1]?.split("\n## ")[0] ?? "";
    expect(preparation).toMatch(/write and self-review (?:each|the) specification/i);
    expect(preparation).toMatch(/write and self-review (?:each|the) implementation plan/i);
    expect(preparation).toMatch(/without (?:requesting|waiting for) intermediate approval/i);
    expect(approval).toMatch(/one explicit user approval/i);
    expect(approval).toMatch(/accepts (?:every|the) specification and plan/i);
    expect(approval).toMatch(/authorizes[^.\n]*creat[^.\n]*publish both managed comments[^.\n]*hierarchy/i);
    expect(approval).toMatch(/complete revised packet/i);
    expect(approval).toMatch(/one fresh approval/i);
    expect(skill.split("\n").some(line => line.includes("prs tool issue create --draft-file") && line.includes("--spec-file") && line.includes("--plan-file"))).toBe(true);
    expect(skill.split("\n").some(line => line.includes("prs tool issue create --issue-set") && !line.includes("--spec-file") && !line.includes("--plan-file"))).toBe(true);
    expect(skill).not.toMatch(/wait for explicit user approval before proceeding to the plan/i);
    expect(skill).not.toContain("artifacts when available");
  });

  it("requires issue-specific linked artifacts and explicit native hierarchy", () => {
    const create = readFileSync("skills/prs-create/SKILL.md", "utf8");
    const orchestrate = readFileSync("skills/prs-orchestrate/SKILL.md", "utf8");
    for (const reference of ["\"version\": 2", "specFile", "planFile", "orchestration", "orchestratorId", "parentId", "native", "flat"]) {
      expect(create).toContain(reference);
    }
    expect(create).toMatch(/every issue.{0,120}(?:own|issue-specific).{0,120}specification.{0,120}plan/is);
    expect(create).toMatch(/explicit user approval.{0,240}hierarchy/is);
    expect(create).not.toMatch(/publishes the shared pair on every issue/i);
    expect(orchestrate).toMatch(/designated parent.{0,160}coordination.{0,160}final acceptance/is);
    expect(orchestrate).toMatch(/issue-specific.{0,160}specification.{0,160}plan/is);
    expect(orchestrate).toMatch(/dependency.{0,80}separate.{0,80}(?:parent|hierarchy)/is);
  });

  it("prepares one exact refinement packet while keeping the original issue and implementation boundary", () => {
    const skill = readFileSync("skills/prs-issue/SKILL.md", "utf8");
    const refinement = skill.split("## Refinement\n")[1]?.split("\n## ")[0] ?? "";
    for (const heading of ["Artifact preparation", "Unified approval", "Completion verification"]) {
      expect(refinement).toContain(`### ${heading}`);
    }
    for (const reference of ["superpowers:brainstorming", "superpowers:writing-plans", "one explicit user approval", "prs tool issue publish-artifacts", "prs tool issue context"]) {
      expect(refinement).toContain(reference);
    }
    const preparation = refinement.split("### Artifact preparation\n")[1]?.split("\n### ")[0] ?? "";
    const approval = refinement.split("### Unified approval\n")[1]?.split("\n### ")[0] ?? "";
    expect(preparation).toMatch(/without (?:requesting|waiting for) intermediate approval/i);
    expect(approval).toMatch(/accepts the specification and plan/i);
    expect(approval).toMatch(/authorizes[^.\n]*publish both managed comments/i);
    expect(approval).toMatch(/complete revised packet/i);
    expect(approval).toMatch(/one fresh approval/i);
    expect(refinement).not.toMatch(/wait for explicit user approval before proceeding to the plan/i);
    expect(refinement).toMatch(/preserve the original issue number, URL and request body/i);
    expect(refinement).toMatch(/stop after verified publication unless implementation was requested/i);
    expect(skill.split("## Lifecycle\n")[1]).toMatch(/only when implementation was requested/i);
  });
});
