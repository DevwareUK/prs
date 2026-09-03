import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";

const ARTIFACT_SKILL_NAMES = ["prs", "prs-create", "prs-issue", "prs-finish", "prs-orchestrate", "prs-pr"];
const REQUIRED_ARTIFACT_INSTRUCTIONS = [
  ".prs/runs/<task-specific-run>/",
  "only repository-local root",
  "Use a run directory returned by `prs` when available",
  "issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence",
  "Never stage or commit them",
  ".prs-work",
];

export function expectArtifactContract(markdown: string): void {
  for (const instruction of REQUIRED_ARTIFACT_INSTRUCTIONS) {
    expect(markdown).toContain(instruction);
  }
}

export function expectInstalledArtifactContract(root: string): void {
  for (const name of ARTIFACT_SKILL_NAMES) {
    expectArtifactContract(readFileSync(join(root, name, "SKILL.md"), "utf8"));
  }
}
