import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAgentSkillParity } from "./agent-parity";

const EXPECTED_SKILLS = ["prs", "prs-create", "prs-finish", "prs-issue", "prs-orchestrate"];

function expectArtifactContract(markdown: string): void {
  for (const instruction of [
    ".prs/runs/<task-specific-run>/",
    "only repository-local root",
    "Use a run directory returned by `prs` when available",
    "issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence",
    "Never stage or commit them",
    ".prs-work",
  ]) {
    expect(markdown).toContain(instruction);
  }
}

describe("three-host Agent Skills parity", () => {
  it("installs and validates every host in its own temporary home", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-test-"));

    const report = validateAgentSkillParity({ sourceRoot: resolve("."), temporaryRoot });

    expect(report.status).toBe("passed");
    expect(report.hosts.map((row) => row.host)).toEqual(["codex", "claude-code", "copilot"]);
    expect(new Set(report.hosts.map((row) => row.home)).size).toBe(3);
    for (const row of report.hosts) {
      expect(row.status).toBe("passed");
      expect(row.inventory).toEqual(EXPECTED_SKILLS);
      expect(row.contentHashes).toEqual(report.canonical.contentHashes);
      expect(row.requiredOperations).toEqual(report.canonical.requiredOperations);
      expect(row.errors).toEqual([]);
      for (const name of EXPECTED_SKILLS) {
        expectArtifactContract(readFileSync(join(row.targetRoot, name, "SKILL.md"), "utf8"));
      }
    }
  });

  it("records one host failure separately instead of borrowing another host's pass", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-collision-"));
    const customFile = join(temporaryRoot, "codex", ".agents", "skills", "prs", "SKILL.md");
    mkdirSync(join(customFile, ".."), { recursive: true });
    writeFileSync(customFile, "custom collision\n");

    const report = validateAgentSkillParity({ sourceRoot: resolve("."), temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.find((row) => row.host === "codex")?.status).toBe("failed");
    expect(report.hosts.find((row) => row.host === "claude-code")?.status).toBe("passed");
    expect(report.hosts.find((row) => row.host === "copilot")?.status).toBe("passed");
    expect(readFileSync(customFile, "utf8")).toBe("custom collision\n");
  });
});
