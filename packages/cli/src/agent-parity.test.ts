import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectArtifactContract } from "./agent-skill-artifact-contract.test-support";
import { validateAgentSkillParity } from "./agent-parity";

const EXPECTED_SKILLS = ["prs", "prs-create", "prs-finish", "prs-issue", "prs-orchestrate", "prs-pr"];
const REQUIRED_SAFEGUARDS = ["artifact-locality", "staged-only-finalization"];
const GITHUB_CREDENTIAL_STORE_RECOVERY = `## GitHub credential-store recovery

- When \`forge.githubAccount\` is configured, honor that account without switching the global GitHub account or falling back to another account or an inherited token. Never run \`gh auth switch\`.
- If a structured result says \`retry-with-credential-store-access\`, retry the exact PRS command through the active host's normal permission mechanism. PRS must not elevate itself or invoke a host-specific permission mechanism.
- Preserve unchanged approval, artifact paths, targets and known issue numbers across the permission-only retry.
- Ask the user to log in or refresh credentials only after an unrestricted retry still reports missing or rejected credentials.
- Never print or capture token values, authentication headers, subprocess stderr, credential paths or inherited token variables in diagnostic output.
`;
const GITHUB_CREDENTIAL_STORE_RECOVERY_ERROR = "prs: missing GitHub credential-store recovery instructions";

function createSourceFixture(mutate: (content: string) => string): string {
  const sourceRoot = mkdtempSync(join(tmpdir(), "prs-agent-parity-source-"));
  cpSync(resolve("skills"), join(sourceRoot, "skills"), { recursive: true });

  for (const name of EXPECTED_SKILLS) {
    const skillPath = join(sourceRoot, "skills", name, "SKILL.md");
    writeFileSync(skillPath, mutate(readFileSync(skillPath, "utf8")), "utf8");
  }

  return sourceRoot;
}

function createGitHubCredentialRecoveryFixture(mutate: (content: string) => string): string {
  const sourceRoot = createSourceFixture(content => content);
  const skillPath = join(sourceRoot, "skills", "prs", "SKILL.md");
  const content = readFileSync(skillPath, "utf8");
  const recoveryPattern = /^## GitHub credential-store recovery\n[\s\S]*?(?=^## |$(?![\s\S]))/m;
  const withRecovery = recoveryPattern.test(content)
    ? content.replace(recoveryPattern, GITHUB_CREDENTIAL_STORE_RECOVERY)
    : `${content.trimEnd()}\n\n${GITHUB_CREDENTIAL_STORE_RECOVERY}`;
  const mutated = mutate(withRecovery);
  expect(mutated, "fixture must remove the intended recovery instruction").not.toBe(withRecovery);
  writeFileSync(skillPath, mutated, "utf8");
  return sourceRoot;
}

function expectGitHubCredentialRecoveryRejected(sourceRoot: string): void {
  const report = validateAgentSkillParity({ sourceRoot });
  expect(report.status).toBe("failed");
  expect(report.hosts.map(row => row.host)).toEqual(["codex", "claude-code", "copilot"]);
  for (const row of report.hosts) {
    expect(row.status).toBe("failed");
    expect(row.errors).toContain(GITHUB_CREDENTIAL_STORE_RECOVERY_ERROR);
    expect(row.contentHashes).toEqual(report.canonical.contentHashes);
  }
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

describe("GitHub credential-store recovery contract", () => {
  it.each([
    [
      "configured account",
      "honor that account without switching the global GitHub account or falling back to another account or an inherited token",
      "use any available GitHub account",
    ],
    ["global account switch", "Never run `gh auth switch`", "Run `gh auth switch` before retrying"],
    [
      "permission retry",
      "retry the exact PRS command through the active host's normal permission mechanism. PRS must not elevate itself or invoke a host-specific permission mechanism",
      "run a different command through PRS elevation",
    ],
    [
      "preserved workflow state",
      "Preserve unchanged approval, artifact paths, targets and known issue numbers across the permission-only retry",
      "Recreate workflow state after retrying",
    ],
    [
      "deferred login",
      "Ask the user to log in or refresh credentials only after an unrestricted retry still reports missing or rejected credentials",
      "Ask the user to log in immediately",
    ],
    [
      "redacted diagnostics",
      "Never print or capture token values, authentication headers, subprocess stderr, credential paths or inherited token variables in diagnostic output",
      "Capture credential diagnostics for troubleshooting",
    ],
  ])("rejects identical host packs missing %s guidance", (_label, before, after) => {
    const sourceRoot = createGitHubCredentialRecoveryFixture(content => content.replace(before, after));
    expectGitHubCredentialRecoveryRejected(sourceRoot);
  });

  it("rejects recovery guidance moved outside its canonical section", () => {
    const sourceRoot = createGitHubCredentialRecoveryFixture(content => {
      const recovery = content.match(/^## GitHub credential-store recovery\n[\s\S]*?(?=^## |$(?![\s\S]))/m)?.[0];
      expect(recovery).toBeTruthy();
      return content.replace(recovery!, "## GitHub credential-store recovery\n\nRecovery details are documented elsewhere.\n") +
        `\n## Unrelated notes\n\n${recovery}`;
    });
    expectGitHubCredentialRecoveryRejected(sourceRoot);
  });
});

describe("installed create and refine unified approval contracts", () => {
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

    it.each(["Artifact preparation", "Unified approval", "Completion verification"])(
      `${name}: rejects a missing %s section`, (heading) => {
        const sourceRoot = mutateSkill(name, content => content.replace(
          new RegExp(`^${level} ${heading}\\n[\\s\\S]*?(?=^#{1,${level.length}} |$(?![\\s\\S]))`, "m"), ""
        ));
        expectRejected(sourceRoot, `${name}: missing ${heading.toLowerCase()} instructions`);
      }
    );

    it.each([
      ["brainstorming", "superpowers:brainstorming", "omitted-brainstorming", "artifact preparation"],
      ["planning", "superpowers:writing-plans", "omitted-planning", "artifact preparation"],
      ["specification preparation", "Write and self-review the specification", "Write the specification", "artifact preparation"],
      ["plan preparation", "write and self-review the implementation plan", "write the implementation plan", "artifact preparation"],
      ["uninterrupted preparation", "without requesting intermediate approval", "after requesting intermediate approval", "artifact preparation"],
      ["single approval", "one explicit user approval", "separate explicit user approvals", "unified approval"],
      ["artifact acceptance", "accepts the specification and plan", "acknowledges the artifacts", "unified approval"],
      ["exact target", name === "prs-create" ? "Show the exact issue draft or linked set" : "Show the original issue target", "Show some issue context", "unified approval"],
      ["remote-write authorization", "authorizes the workflow to", "does not authorize the workflow to", "unified approval"],
      ["complete revision", "complete revised packet", "changed fragment", "unified approval"],
      ["fresh approval", "one fresh approval", "the previous approval", "unified approval"],
      ["file preflight", "check both files exist, contain non-empty Markdown and match the displayed, approved versions", "check available files", "unified approval"],
      ["spec flag", "--spec-file", "--omitted-spec", "unified approval"],
      ["plan flag", "--plan-file", "--omitted-plan", "unified approval"],
      ["spec marker", "<!-- prs:issue-spec -->", "omitted-spec-marker", "completion verification"],
      ["plan marker", "<!-- prs:issue-plan -->", "omitted-plan-marker", "completion verification"],
      ["incomplete result", "mean incomplete work", "are acceptable", "completion verification"],
      ["recovery identity", name === "prs-create" ? "preserve the known issue numbers and approved files" : "preserve the known issue number and approved files", "discard the known issue identity", "completion verification"],
      ["recovery command", "prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json", "omitted-recovery-command", "completion verification"],
      ["renewed recovery approval", "Changed content or targets require renewed approval", "Changed content may reuse stale approval", "completion verification"],
      ["verified comment URLs", "both verified managed-comment URLs", "the issue URL", "completion verification"],
      ["mandatory artifacts", "Both written artifacts are required even for bounded work.", "Artifacts are optional for bounded work.", "mandatory written artifacts"],
    ])(`${name}: rejects weakened %s instructions`, (_label, before, after, phase) => {
      expectRejected(mutateSkill(name, content => content.replaceAll(before, after)), `${name}: missing ${phase} instructions`);
    });

    it(`${name}: rejects optional artifact instructions even alongside mandatory prose`, () => {
      expectRejected(mutateSkill(name, content => `${content}\nAdd approved artifacts when available.\n`), `${name}: optional artifact instructions`);
    });

    it(`${name}: rejects empty gate bodies even with complete guidance elsewhere`, () => {
      const sourceRoot = mutateSkill(name, content => {
        const pattern = new RegExp(`^${level} Artifact preparation\\n([\\s\\S]*?)(?=^#{1,${level.length}} |$(?![\\s\\S]))`, "m");
        const body = pattern.exec(content)?.[1];
        expect(body).toBeTruthy();
        return content.replace(pattern, `${level} Artifact preparation\n\n`) + `\n## Unrelated notes\n${body}`;
      });
      expectRejected(sourceRoot, `${name}: missing artifact preparation instructions`);
    });

    it.each([
      "Show the specification file and wait for explicit user approval before proceeding to the plan.",
      "Show the plan file and wait for explicit user approval before publication.",
      `${level} Specification approval\n\nApprove the specification before planning.`,
      `${level} Plan approval\n\nApprove the plan before publication.`,
    ])(`${name}: rejects contradictory staged approval instruction: %s`, directive => {
      expectRejected(
        mutateSkill(name, content => `${content}\n${directive}\n`),
        `${name}: contradictory staged approval instructions`
      );
    });

    it.each([
      "Create the issue before approval.",
      "Publish both managed comments before approval.",
    ])(`${name}: rejects unsafe pre-approval remote write: %s`, directive => {
      expectRejected(
        mutateSkill(name, content => `${content}\n${directive}\n`),
        `${name}: unsafe pre-approval remote-write instructions`
      );
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

describe("JDI completion audit authorization", () => {
  it.each(["prs-finish", "prs-issue", "prs-pr"])("rejects an unconditional audit approval rule in %s", name => {
    const sourceRoot = createSourceFixture(content => content);
    const path = join(sourceRoot, "skills", name, "SKILL.md");
    const content = readFileSync(path, "utf8");
    writeFileSync(path, `${content}\nObtain explicit user approval before publishing the reviewed Markdown with prs audit publish.\n`);
    const report = validateAgentSkillParity({ sourceRoot });
    expect(report.status).toBe("failed");
    for (const host of report.hosts) {
      expect(host.errors).toContain(`${name}: contradictory audit approval instructions`);
    }
  });
  it("requires the JDI policy even when all hosts install identical files", () => {
    const sourceRoot = createSourceFixture(content => content.replace(
      /^## Audit publication authorization\n[\s\S]*?(?=^## |$(?![\s\S]))/m, ""
    ));
    const report = validateAgentSkillParity({ sourceRoot });
    expect(report.status).toBe("failed");
    for (const host of report.hosts) {
      expect(host.errors).toContain("prs-finish: missing audit publication authorization instructions");
    }
  });
  it.each([
    ["mode", "--jdi", "--omitted-jdi"],
    ["completion", "routine completion and token-usage audits", "unrelated reports"],
    ["interactive approval", "Without that authorization, show the exact reports and obtain explicit user approval before publication.", "Always publish reports."],
    ["readiness boundary", "A readiness-tool flag alone does not grant audit publication authorization.", "Every readiness flag authorizes publication."],
    ["scope boundary", "This authorization does not cover issue creation, specification or plan publication, discussion comments, PR reviews, merging or destructive cleanup.", "This authorization covers all remote operations."],
  ])("rejects a finish policy missing the %s boundary on every host", (_label, before, after) => {
    const sourceRoot = createSourceFixture(content => content);
    const path = join(sourceRoot, "skills", "prs-finish", "SKILL.md");
    const content = readFileSync(path, "utf8");
    const mutated = content.replace(before, after);
    expect(mutated).not.toBe(content);
    writeFileSync(path, mutated);
    const report = validateAgentSkillParity({ sourceRoot });
    expect(report.status).toBe("failed");
    for (const host of report.hosts) {
      expect(host.errors).toContain("prs-finish: missing audit publication authorization instructions");
    }
  });

  it.each(["prs", "prs-issue", "prs-pr"])("rejects a missing %s audit authorization handoff", name => {
    const sourceRoot = createSourceFixture(content => content);
    const path = join(sourceRoot, "skills", name, "SKILL.md");
    const content = readFileSync(path, "utf8");
    const mutated = content.replaceAll("audit publication authorization in `prs-finish`", "unconditional publication approval");
    expect(mutated).not.toBe(content);
    writeFileSync(path, mutated);
    const report = validateAgentSkillParity({ sourceRoot });
    expect(report.status).toBe("failed");
    for (const host of report.hosts) {
      expect(host.errors).toContain(`${name}: missing audit authorization handoff`);
    }
  });
});
