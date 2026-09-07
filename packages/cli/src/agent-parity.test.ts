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
  it("requires local usage capture in installed workflow guidance", () => {
    const sourceRoot = createSourceFixture(content => content.replaceAll("prs tool token-usage capture", "removed-capture-command"));
    const report = validateAgentSkillParity({ sourceRoot });
    expect(report.status).toBe("failed");
    for (const host of report.hosts) expect(host.errors).toContain("missing operation reference: prs tool token-usage capture");
  });
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

describe("installed create and refine approval gates", () => {
  function mutateSkill(name: string, mutate: (content: string) => string): string {
    const sourceRoot = createSourceFixture(content => content);
    const path = join(sourceRoot, "skills", name, "SKILL.md");
    const before = readFileSync(path, "utf8");
    const after = mutate(before);
    expect(after, "fixture must change the intended instructions").not.toBe(before);
    writeFileSync(path, after);
    return sourceRoot;
  }

  function expectRejected(sourceRoot: string, error: string): void {
    const report = validateAgentSkillParity({ sourceRoot });
    expect(report.status).toBe("failed");
    expect(report.hosts.map(row => row.host)).toEqual(["codex", "claude-code", "copilot"]);
    for (const row of report.hosts) {
      expect(row.status).toBe("failed");
      expect(row.errors).toContain(error);
      // The error must survive even though every host installs the same pack.
      expect(row.contentHashes).toEqual(report.canonical.contentHashes);
    }
  }

  for (const name of ["prs-create", "prs-issue"]) {
    const level = name === "prs-create" ? "##" : "###";
    it(`${name}: rejects an omitted workflow independently of manifest parity`, () => {
      const sourceRoot = createSourceFixture(content => content);
      const path = join(sourceRoot, "skills", "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.skills = manifest.skills.filter((skill: { name: string }) => skill.name !== name);
      writeFileSync(path, JSON.stringify(manifest));
      expectRejected(sourceRoot, `missing workflow skill: ${name}`);
    });

    it.each(["Specification approval", "Plan approval", "Publication approval", "Completion verification"])(
      `${name}: rejects a missing %s section`, (heading) => {
        const sourceRoot = mutateSkill(name, content => content.replace(
          new RegExp(`^${level} ${heading}\\n[\\s\\S]*?(?=^#{1,${level.length}} |$(?![\\s\\S]))`, "m"), ""
        ));
        expectRejected(sourceRoot, `${name}: missing ${heading.toLowerCase()} instructions`);
      }
    );

    it.each([
      ["brainstorming", "superpowers:brainstorming", "omitted-brainstorming", "specification approval"],
      ["planning", "superpowers:writing-plans", "omitted-planning", "plan approval"],
      ["spec approval", "Show the specification file and wait for explicit user approval before proceeding to the plan.", "Write a specification and proceed to the plan.", "specification approval"],
      ["plan approval", "Show the plan file and wait for explicit user approval before", "Finish the plan before", "plan approval"],
      ["publication approval", "Obtain explicit user approval to", "Proceed to", "publication approval"],
      ["file preflight", "check both files exist, contain non-empty Markdown and match the approved versions", "check available files", "publication approval"],
      ["spec flag", "--spec-file", "--omitted-spec", "publication approval"],
      ["plan flag", "--plan-file", "--omitted-plan", "publication approval"],
      ["spec marker", "<!-- prs:issue-spec -->", "omitted-spec-marker", "completion verification"],
      ["plan marker", "<!-- prs:issue-plan -->", "omitted-plan-marker", "completion verification"],
      ["incomplete result", "mean incomplete work", "are acceptable", "completion verification"],
      ["mandatory artifacts", "Both written artifacts are required even for bounded work.", "Artifacts are optional for bounded work.", "mandatory written artifacts"],
    ])(`${name}: rejects weakened %s instructions`, (_label, before, after, phase) => {
      expectRejected(mutateSkill(name, content => content.replaceAll(before, after)), `${name}: missing ${phase} instructions`);
    });

    it(`${name}: rejects optional artifact instructions even alongside mandatory prose`, () => {
      expectRejected(mutateSkill(name, content => `${content}\nAdd approved artifacts when available.\n`), `${name}: optional artifact instructions`);
    });

    it(`${name}: rejects empty gate bodies even with complete guidance elsewhere`, () => {
      const sourceRoot = mutateSkill(name, content => {
        const pattern = new RegExp(`^${level} Specification approval\\n([\\s\\S]*?)(?=^#{1,${level.length}} |$(?![\\s\\S]))`, "m");
        const body = pattern.exec(content)?.[1];
        expect(body).toBeTruthy();
        return content.replace(pattern, `${level} Specification approval\n\n`) + `\n## Unrelated notes\n${body}`;
      });
      expectRejected(sourceRoot, `${name}: missing specification approval instructions`);
    });

    it(`${name}: requires live context in the completion section itself`, () => {
      const sourceRoot = mutateSkill(name, content => content.replace(
        "Read `prs tool issue context <number> --json` and confirm both managed artifacts are present; check the published content matches the approved files.",
        "Assume publication succeeded."
      ));
      expectRejected(sourceRoot, `${name}: missing completion verification instructions`);
    });
  }

  it.each([
    ["original issue", "Preserve the original issue number, URL and request body.", "Use any issue.", "refinement identity"],
    ["refine-only stop", "stop after verified publication unless implementation was requested", "continue after publication", "refinement boundary"],
    ["lifecycle entry", "Continue here only when implementation was requested.", "Continue here after refinement.", "refinement boundary"],
  ])("rejects removal of the %s boundary", (_label, before, after, phase) => {
    expectRejected(mutateSkill("prs-issue", content => content.replace(before, after)), `prs-issue: missing ${phase} instructions`);
  });

  it.each([
    "Always create a replacement issue after refinement.",
    "Always create linked issues from refinement.",
    "Automatically run readiness after refinement.",
    "Automatically implement after refinement.",
    "1. Always create a replacement issue after refinement.",
    "2) Always create linked issues from refinement.",
    "  3. Automatically run readiness after refinement.",
    "  Automatically implement after refinement.",
  ])("rejects contradictory refinement instruction: %s", (directive) => {
    expectRejected(mutateSkill("prs-issue", content => `${content}\n${directive}\n`), "prs-issue: unsafe refinement instructions");
  });
});
