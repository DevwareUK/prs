import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentSkillManifest } from "@prs/contracts";
import { expectArtifactContract } from "./agent-skill-artifact-contract.test-support";

const EXPECTED_SKILLS = ["prs", "prs-create", "prs-finish", "prs-issue", "prs-orchestrate"];

describe("canonical agent skill pack", () => {
  it("publishes the exact portable inventory through one manifest", () => {
    const manifest = AgentSkillManifest.parse(
      JSON.parse(readFileSync(resolve("skills/manifest.json"), "utf8"))
    );
    expect(manifest.skills.map((skill) => skill.name).sort()).toEqual(EXPECTED_SKILLS);
    for (const skill of manifest.skills) {
      expect(skill.source).toBe(`skills/${skill.name}/SKILL.md`);
      expect(existsSync(resolve(skill.source))).toBe(true);
    }
  });

  it("keeps canonical bodies host-neutral and tied to deterministic commands", () => {
    for (const name of EXPECTED_SKILLS) {
      const markdown = readFileSync(resolve("skills", name, "SKILL.md"), "utf8");
      expect(markdown).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: Use when `));
      expect(markdown).toContain("prs tool");
      expect(markdown).not.toMatch(/~\/\.(?:codex|claude)|slash command|Superpowers|model profile|API key|OPENAI|Bedrock/i);
    }
  });

  it("keeps generated workflow artifacts under the ignored run root", () => {
    for (const name of EXPECTED_SKILLS) {
      expectArtifactContract(readFileSync(resolve("skills", name, "SKILL.md"), "utf8"));
    }
  });

  it("preserves approval, isolation, delegation, and verification fallbacks", () => {
    const combined = EXPECTED_SKILLS.map((name) =>
      readFileSync(resolve("skills", name, "SKILL.md"), "utf8")
    ).join("\n");
    expect(combined).toContain("explicit user approval");
    expect(combined).toContain("active workspace");
    expect(combined).toContain("sequentially");
    expect(combined).toContain("verification");
    expect(combined).toContain("usage-evidence.json");
    expect(combined).toContain("cumulative-snapshot");
    expect(combined).toContain("prs tool token-usage render");
    expect(combined).toContain("unavailable");
  });

  it("requires deliberate staging before issue finalization", () => {
    const finish = readFileSync(resolve("skills/prs-finish/SKILL.md"), "utf8");
    expect(finish).toContain("Stage only files that belong to the approved issue");
    expect(finish).toContain("git diff --cached --name-status");
    expect(finish).toContain("displayed commit message and staged paths");
    expect(finish).toContain("existing index");
    expect(finish).toContain("unstaged changes");
    expect(finish).toContain("untracked files");
  });
});
