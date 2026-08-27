import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { installAgentSkills } from "./agent-skills-installer";

function fixture(): { home: string; sourceRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "prs-codex-skills-"));
  const sourceRoot = join(root, "source");
  mkdirSync(sourceRoot, { recursive: true });
  cpSync(resolve("skills"), join(sourceRoot, "skills"), { recursive: true });
  return { home: join(root, "home"), sourceRoot };
}

describe("Codex Agent Skills installer", () => {
  it("finds the repository canonical pack without a source override", () => {
    const root = mkdtempSync(join(tmpdir(), "prs-codex-default-source-"));
    const result = installAgentSkills({ host: "codex", home: join(root, "home") });
    expect(result.installed).toHaveLength(5);
  });

  it("installs the canonical files unchanged under the shared skills root", () => {
    const { home, sourceRoot } = fixture();

    const result = installAgentSkills({ host: "codex", home, sourceRoot });

    expect(result.targetRoot).toBe(join(home, ".agents", "skills"));
    expect(result.installed).toHaveLength(5);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);
    for (const name of ["prs", "prs-create", "prs-issue", "prs-finish", "prs-orchestrate"]) {
      expect(readFileSync(join(result.targetRoot, name, "SKILL.md"), "utf8")).toBe(
        readFileSync(join(sourceRoot, "skills", name, "SKILL.md"), "utf8")
      );
    }
    expect(existsSync(join(result.targetRoot, ".prs-managed-skills.json"))).toBe(true);
  });

  it("is idempotent and updates only files that still match their managed hash", () => {
    const { home, sourceRoot } = fixture();
    const first = installAgentSkills({ host: "codex", home, sourceRoot });
    const second = installAgentSkills({ host: "codex", home, sourceRoot });
    expect(second.unchanged).toHaveLength(5);

    const managedFile = join(first.targetRoot, "prs", "SKILL.md");
    writeFileSync(managedFile, `${readFileSync(managedFile, "utf8")}\ncustom note\n`);
    const canonicalFile = join(sourceRoot, "skills", "prs", "SKILL.md");
    writeFileSync(canonicalFile, `${readFileSync(canonicalFile, "utf8")}\ncanonical update\n`);

    const third = installAgentSkills({ host: "codex", home, sourceRoot });
    expect(third.skipped).toEqual([
      expect.objectContaining({ name: "prs", reason: "custom-file" }),
    ]);
    expect(readFileSync(managedFile, "utf8")).toContain("custom note");
  });

  it("protects an untracked custom collision", () => {
    const { home, sourceRoot } = fixture();
    const customFile = join(home, ".agents", "skills", "prs", "SKILL.md");
    mkdirSync(join(customFile, ".."), { recursive: true });
    writeFileSync(customFile, "custom prs skill\n");

    const result = installAgentSkills({ host: "codex", home, sourceRoot });

    expect(result.skipped).toEqual([
      expect.objectContaining({ name: "prs", reason: "custom-file" }),
    ]);
    expect(readFileSync(customFile, "utf8")).toBe("custom prs skill\n");
  });

  it("retires marked legacy Codex copies without touching custom legacy skills", () => {
    const { home, sourceRoot } = fixture();
    const legacyRoot = join(home, ".codex", "skills");
    const managedLegacy = join(legacyRoot, "prs", "SKILL.md");
    const customLegacy = join(legacyRoot, "prs-create", "SKILL.md");
    mkdirSync(join(managedLegacy, ".."), { recursive: true });
    mkdirSync(join(customLegacy, ".."), { recursive: true });
    writeFileSync(
      managedLegacy,
      '---\nname: prs\n---\n<!-- prs:managed-skill name="prs" version="1" hash="abc123" -->\n'
    );
    writeFileSync(customLegacy, "custom legacy skill\n");

    const result = installAgentSkills({ host: "codex", home, sourceRoot });

    expect(result.retiredLegacy).toEqual([`${managedLegacy}.prs-retired`]);
    expect(existsSync(managedLegacy)).toBe(false);
    expect(existsSync(`${managedLegacy}.prs-retired`)).toBe(true);
    expect(readFileSync(customLegacy, "utf8")).toBe("custom legacy skill\n");
    expect(result.legacySkipped).toEqual([customLegacy]);
  });
});
