import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectArtifactContract } from "./agent-skill-artifact-contract.test-support";
import { validateAgentSkillParity } from "./agent-parity";

const EXPECTED_SKILLS = ["prs", "prs-create", "prs-finish", "prs-issue", "prs-orchestrate", "prs-pr"];
const REQUIRED_SAFEGUARDS = ["artifact-locality", "staged-only-finalization"];

function createSourceFixture(mutate: (content: string) => string): string {
  const sourceRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-source-"));
  cpSync(resolve("skills"), join(sourceRoot, "skills"), { recursive: true });

  for (const name of EXPECTED_SKILLS) {
    const skillPath = join(sourceRoot, "skills", name, "SKILL.md");
    writeFileSync(skillPath, mutate(readFileSync(skillPath, "utf8")), "utf8");
  }

  return sourceRoot;
}

describe("three-host Agent Skills parity", () => {
  it("requires the local usage renderer in installed workflow guidance", () => {
    const sourceRoot = createSourceFixture(content => content.replaceAll("prs tool token-usage render", "removed-usage-command"));
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-usage-"));
    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });
    expect(report.status).toBe("failed");
    for (const host of report.hosts) expect(host.errors).toContain("missing operation reference: prs tool token-usage render");
  });
  it("rejects a canonical pack that omits prs-pr even when all hosts install identical files", () => {
    const sourceRoot = createSourceFixture((content) => content);
    const manifestPath = join(sourceRoot, "skills", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.skills = manifest.skills.filter((skill: { name: string }) => skill.name !== "prs-pr");
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const report = validateAgentSkillParity({ sourceRoot });
    expect(report.status).toBe("failed");
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing workflow skill: prs-pr");
    }
  });

  it.each(["review", "resolve-conflicts", "address-comments", "fix-tests"])(
    "rejects identical installs with no %s action instructions",
    (action) => {
      const sourceRoot = createSourceFixture((content) => content);
      const prPath = join(sourceRoot, "skills", "prs-pr", "SKILL.md");
      const content = readFileSync(prPath, "utf8");
      writeFileSync(prPath, content.replace(new RegExp(`^### ${action}\\n[\\s\\S]*?(?=^#{2,3} |$(?![\\s\\S]))`, "m"), ""));

      const report = validateAgentSkillParity({ sourceRoot });
      expect(report.status).toBe("failed");
      for (const row of report.hosts) {
        expect(row.errors).toContain(`prs-pr: missing action instructions: ${action}`);
      }
    }
  );

  it("rejects a router that stops at readiness without the dedicated PR handoff", () => {
    const sourceRoot = createSourceFixture((content) => content);
    const routerPath = join(sourceRoot, "skills", "prs", "SKILL.md");
    const content = readFileSync(routerPath, "utf8");
    writeFileSync(routerPath, content.replace(/^.*Existing pull request:.*$/m, "- Existing pull request: run `prs tool pr ready <number> --json`."));

    const report = validateAgentSkillParity({ sourceRoot });
    expect(report.status).toBe("failed");
    for (const row of report.hosts) {
      expect(row.errors).toContain("prs: missing prs-pr route");
    }
  });

  it("installs and validates every host in its own temporary home", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-test-"));

    const report = validateAgentSkillParity({ sourceRoot: resolve("."), temporaryRoot });

    expect(report.status).toBe("passed");
    expect(report.canonical.requiredSafeguards).toEqual(REQUIRED_SAFEGUARDS);
    expect(report.hosts.map((row) => row.host)).toEqual(["codex", "claude-code", "copilot"]);
    expect(new Set(report.hosts.map((row) => row.home)).size).toBe(3);
    for (const row of report.hosts) {
      expect(row.status).toBe("passed");
      expect(row.inventory).toEqual(EXPECTED_SKILLS);
      expect(row.contentHashes).toEqual(report.canonical.contentHashes);
      expect(row.requiredOperations).toEqual(report.canonical.requiredOperations);
      expect(row.safeguards).toEqual(REQUIRED_SAFEGUARDS);
      expect(row.errors).toEqual([]);
      for (const name of EXPECTED_SKILLS) {
        expectArtifactContract(readFileSync(join(row.targetRoot, name, "SKILL.md"), "utf8"));
      }
    }
  });

  it("fails every installed host when artifact locality safeguards are absent", () => {
    const sourceRoot = createSourceFixture((content) => content.replaceAll(".prs/runs", ".prs-work"));
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-artifact-locality-"));

    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing safeguard: artifact-locality");
    }
  });

  it("fails every installed host when staged-only finalization safeguards are absent", () => {
    const sourceRoot = createSourceFixture((content) =>
      content.replace(/\b(?:staged|index|unstaged|untracked)\b/gi, "")
    );
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-finalization-"));

    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing safeguard: staged-only-finalization");
    }
  });

  it("fails every installed host when staging raw artifacts is required", () => {
    const sourceRoot = createSourceFixture((content) =>
      content.replaceAll("Never stage or commit them", "Always stage and commit them")
    );
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-artifact-reversed-"));

    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing safeguard: artifact-locality");
    }
  });

  it("fails every installed host when finalization deletes preserved files", () => {
    const sourceRoot = createSourceFixture((content) =>
      content.replace(
        "The command commits only the existing index and leaves unstaged changes and untracked files untouched.",
        "The command commits only the existing index and deletes unstaged changes and untracked files."
      )
    );
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-finalization-reversed-"));

    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing safeguard: staged-only-finalization");
    }
  });

  it("fails every installed host when an unrelated commit prohibition masks raw artifact staging", () => {
    const sourceRoot = createSourceFixture((content) =>
      content.replaceAll(
        "They are raw workflow artifacts and stay local. Never stage or commit them",
        "Always stage and commit raw workflow artifacts. Never commit implementation files"
      )
    );
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-artifact-unrelated-"));

    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing safeguard: artifact-locality");
    }
  });

  it("fails every installed host when unrelated preservation prose masks destructive finalization", () => {
    const sourceRoot = createSourceFixture((content) =>
      content.replace(
        "The command commits only the existing index and leaves unstaged changes and untracked files untouched.",
        "The command commits only the existing index and deletes unstaged changes and untracked files.\nPreserve unstaged changes and untracked files outside finalization."
      )
    );
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-finalization-unrelated-"));

    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing safeguard: staged-only-finalization");
    }
  });

  it("fails every installed host when a preceding raw-artifact staging directive contradicts a prohibition", () => {
    const sourceRoot = createSourceFixture((content) =>
      content.replaceAll(
        "They are raw workflow artifacts and stay local. Never stage or commit them",
        "Always stage and commit raw workflow artifacts. Never stage or commit them"
      )
    );
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-artifact-contradictory-"));

    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing safeguard: artifact-locality");
    }
  });

  it("fails every installed host when a same-line destructive finalization statement contradicts preservation", () => {
    const sourceRoot = createSourceFixture((content) =>
      content.replace(
        "The command commits only the existing index and leaves unstaged changes and untracked files untouched.",
        "The command commits only the existing index and deletes unstaged changes and untracked files. The command commits only the existing index and leaves unstaged changes and untracked files untouched."
      )
    );
    const temporaryRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-finalization-contradictory-"));

    const report = validateAgentSkillParity({ sourceRoot, temporaryRoot });

    expect(report.status).toBe("failed");
    expect(report.hosts.map((row) => row.status)).toEqual(["failed", "failed", "failed"]);
    for (const row of report.hosts) {
      expect(row.errors).toContain("missing safeguard: staged-only-finalization");
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
