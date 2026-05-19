import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRS_CODEX_SKILLS,
  installManagedCodexSkills,
  renderCodexSkillMarkdown,
  resolveCodexSkillsRoot,
} from "./codex-skills";
import { parsePrsToolCommandArgs } from "./prs-tool-command";

const cleanupTargets = new Set<string>();

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

describe("managed prs Codex skills", () => {
  it("defines the expected workflow skills", () => {
    expect(PRS_CODEX_SKILLS.map((skill) => skill.name)).toEqual([
      "prs",
      "prs:start-issue-work",
      "prs:publish-audit",
      "prs:finish-work",
      "prs:parallel-batch",
      "prs:create",
      "prs:review",
      "prs:issue",
      "prs:pr",
      "prs:audit",
      "prs:finish",
    ]);
  });

  it("renders skill markdown with the GitHub audit contract", () => {
    const markdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[1]);

    expect(markdown).toContain("name: prs:start-issue-work");
    expect(markdown).toContain('<!-- prs:managed-skill name="prs:start-issue-work"');
    expect(markdown).toContain("Use Superpowers for brainstorming, planning, worktrees, agents, and verification.");
    expect(markdown).toContain("Publish specs, plans, decisions, and completion notes to GitHub through `prs audit publish`.");
    expect(markdown).toContain("Never commit generated Superpowers specs or plans to `docs/superpowers`.");
  });

  it("renders the unified prs command router skill", () => {
    const markdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[0]);

    expect(markdown).toContain("name: prs");
    expect(markdown).toContain("/prs create");
    expect(markdown).toContain("/prs:create");
    expect(markdown).toContain("/prs create issue");
    expect(markdown).toContain("Default workflow handoff: `/prs create` -> `/prs issue` -> `/prs pr`");
    expect(markdown).toContain("Draft GitHub Issue: <short topic>");
    expect(markdown).toContain("ask the user to approve the draft before creating it in GitHub");
    expect(markdown).toContain("offer the next `/prs issue` step for that issue");
    expect(markdown).toContain("/prs:review");
    expect(markdown).toContain("/prs review tests`: run `prs test-backlog`");
    expect(markdown).toContain("/prs review features`: run `prs feature-backlog`");
    expect(markdown).toContain("/prs review diff`: run `prs review`");
    expect(markdown).toContain("/prs issue");
    expect(markdown).toContain(
      "/prs issue`: run `prs tool issue list --actionable --json`"
    );
    expect(markdown).toContain(
      "/prs issue <number>`: run `prs tool issue ready <number> --json`"
    );
    expect(markdown).toContain(
      "/prs issue <number> --all`: run `prs tool issue ready <number> --all --json`"
    );
    expect(markdown).toContain(
      "continue into Superpowers worktree creation and issue implementation"
    );
    expect(markdown).toContain(
      "do not stop after the readiness JSON when `--all` is present."
    );
    expect(markdown).toContain("/prs issue <number> finish");
    expect(markdown).toContain("offer the next `/prs pr` step for that pull request");
    expect(markdown).toContain("/prs pr <number> resolve-conflicts");
    expect(markdown).toContain(
      "/prs pr <number>`: run `prs tool pr ready <number> --json`"
    );
    expect(markdown).toContain(
      "current repository checkout used by the user's normal local runtime"
    );
    expect(markdown).toContain("fetch and merge the latest PR base branch");
    expect(markdown).toContain("summarize `prContext` signals from GitHub");
    expect(markdown).toContain("actual PR head branch");
    expect(markdown).toContain("remove that clean worktree");
    expect(markdown).toContain("If that worktree has uncommitted changes");
    expect(markdown).toContain(
      "/prs pr <number> --all`: run `prs tool pr ready <number> --all --json`"
    );
    expect(markdown).toContain("starting the configured local app runtime");
    expect(markdown).toContain(
      "Do not push, review, fix, approve, merge, switch to an existing PR worktree, or run broad local verification."
    );
    expect(markdown).toContain(
      "/prs pr <number> prepare-review`: run `prs tool pr prepare-review <number> --json`"
    );
    expect(markdown).toContain("read the returned `snapshotFilePath`");
    expect(markdown).toContain("does not generate `review-brief.md`");
    expect(markdown).toContain("verify, commit reviewed changes");
    expect(markdown).toContain("prs tool pr push-reviewed <number> --json");
    expect(markdown).not.toContain("prs codex");
    expect(markdown).not.toContain("codex exec");
    expect(markdown).toContain("Do not recreate prs workflows with ad hoc git commands");
    expect(markdown).toContain(
      "/prs pr`: run `prs tool pr list --actionable --json`"
    );
    expect(markdown).toContain("instead of inspecting git refs or source files");
    expect(markdown).toContain("actionable for me");
    expect(markdown).toContain("Do not assume the GitHub CLI (`gh`) is installed");
    expect(markdown).toContain("node packages/cli/dist/index.js <args>");
    expect(markdown).toContain("do not call that an actionable-for-me list");
    expect(markdown).toContain("Existing managed skills are backing behaviors");
  });

  it("renders top-level alias skills for the shorter /prs colon commands", () => {
    const createMarkdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[5]);
    const reviewMarkdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[6]);
    const issueMarkdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[7]);
    const prMarkdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[8]);
    const auditMarkdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[9]);
    const finishMarkdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[10]);

    expect(createMarkdown).toContain("name: prs:create");
    expect(createMarkdown).toContain("Draft a GitHub issue from a rough idea");
    expect(createMarkdown).toContain("Draft GitHub Issue: <short topic>");
    expect(createMarkdown).toContain("ask the user to approve them before creating");
    expect(createMarkdown).toContain("offer the next `/prs issue` step for that issue");
    expect(createMarkdown).not.toContain("offer the `/prs issue <number>` step");
    expect(createMarkdown).not.toContain("offer to start `prs:start-issue-work`");
    expect(reviewMarkdown).toContain("name: prs:review");
    expect(reviewMarkdown).toContain("testing strategy and coverage review");
    expect(reviewMarkdown).toContain("/prs:review tests");
    expect(issueMarkdown).toContain("name: prs:issue");
    expect(issueMarkdown).toContain("/prs:issue <number> --all");
    expect(prMarkdown).toContain("name: prs:pr");
    expect(prMarkdown).toContain("actual PR head branch");
    expect(prMarkdown).toContain("browse/functional test first");
    expect(auditMarkdown).toContain("name: prs:audit");
    expect(auditMarkdown).toContain("prs audit publish");
    expect(finishMarkdown).toContain("name: prs:finish");
    expect(finishMarkdown).toContain("safely cleaning up");
    expect(finishMarkdown).toContain("offer the next `/prs pr` step for that pull request");
    expect(finishMarkdown).not.toContain("offer to prepare the pull request for review with `/prs pr <number> prepare-review`");
  });

  it("renders a setup-captured fallback CLI command for Codex sessions", () => {
    const markdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[0], {
      cliFallbackCommand: [
        "/usr/local/bin/node",
        "/Users/tester/Projects/prs/packages/cli/dist/index.js",
      ],
    });

    expect(markdown).toContain(
      "Use the setup-captured fallback CLI as the primary Codex command path: `/usr/local/bin/node /Users/tester/Projects/prs/packages/cli/dist/index.js <args>`."
    );
    expect(markdown).not.toContain("Prefer the installed `prs` command when it is on `PATH`.");
  });

  it("renders one-shot fast paths for /prs issue and /prs pr when a fallback CLI is captured", () => {
    const markdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[0], {
      cliFallbackCommand: [
        "/usr/local/bin/node",
        "/Users/tester/Projects/prs/packages/cli/dist/index.js",
      ],
    });

    expect(markdown).toContain(
      "Fast path for `/prs issue`: run `/usr/local/bin/node /Users/tester/Projects/prs/packages/cli/dist/index.js tool issue list --actionable --json` exactly once."
    );
    expect(markdown).toContain(
      "Fast path for `/prs pr`: run `/usr/local/bin/node /Users/tester/Projects/prs/packages/cli/dist/index.js tool pr list --actionable --json` exactly once."
    );
    expect(markdown).toContain(
      "Do not run `command -v prs`, `git status`, GitHub API fallbacks, SSH PR-ref discovery, or source-code inspection before this fast-path command."
    );
  });

  it("keeps documented prs tool commands parseable by the bundled CLI", () => {
    const markdown = PRS_CODEX_SKILLS.map((skill) =>
      renderCodexSkillMarkdown(skill)
    ).join("\n");
    const documentedToolCommands = [
      ...markdown.matchAll(/prs tool ([^`.\n]+)/g),
    ].map((match) => match[1]?.trim().replace("<number>", "123"));

    expect(documentedToolCommands).toContain("issue list --actionable --json");
    for (const documentedCommand of documentedToolCommands) {
      expect(() =>
        parsePrsToolCommandArgs(documentedCommand.split(/\s+/))
      ).not.toThrow();
    }
  });

  it("renders setup-captured fallback guidance in finish and audit skills", () => {
    const options = {
      cliFallbackCommand: [
        "/usr/local/bin/node",
        "/Users/tester/Projects/prs/packages/cli/dist/index.js",
      ],
    };
    const finishMarkdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[3], options);
    const auditMarkdown = renderCodexSkillMarkdown(PRS_CODEX_SKILLS[2], options);

    for (const markdown of [finishMarkdown, auditMarkdown]) {
      expect(markdown).toContain(
        "Use the setup-captured fallback CLI as the primary Codex command path: `/usr/local/bin/node /Users/tester/Projects/prs/packages/cli/dist/index.js <args>`."
      );
      expect(markdown).toContain(
        "Do not report `prs` as unavailable solely because it is missing from PATH; use the setup-captured fallback command instead."
      );
    }
    expect(auditMarkdown).toContain(
      "`/usr/local/bin/node /Users/tester/Projects/prs/packages/cli/dist/index.js audit publish --pr <number> --file <path> --section <name>`"
    );
  });

  it("resolves CODEX_HOME before the user home fallback", () => {
    expect(resolveCodexSkillsRoot({ CODEX_HOME: "/tmp/codex-home" }, "/Users/tester")).toBe(
      "/tmp/codex-home/skills"
    );
    expect(resolveCodexSkillsRoot({}, "/Users/tester")).toBe("/Users/tester/.codex/skills");
  });

  it("installs managed skills under the Codex skills root", () => {
    const codexHome = mkdtempSync(resolve(tmpdir(), "prs-codex-home-"));
    cleanupTargets.add(codexHome);

    const result = installManagedCodexSkills({ CODEX_HOME: codexHome }, "/Users/tester", {
      cliFallbackCommand: [
        "/usr/local/bin/node",
        "/Users/tester/Projects/prs/packages/cli/dist/index.js",
      ],
    });

    expect(result.installed).toBe(11);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.skipped).toEqual([]);
    const unifiedSkillPath = resolve(codexHome, "skills", "prs", "SKILL.md");
    expect(existsSync(unifiedSkillPath)).toBe(true);
    expect(readFileSync(unifiedSkillPath, "utf8")).toContain("name: prs");
    expect(readFileSync(unifiedSkillPath, "utf8")).toContain(
      "/usr/local/bin/node /Users/tester/Projects/prs/packages/cli/dist/index.js <args>"
    );
    const skillPath = resolve(codexHome, "skills", "prs-start-issue-work", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, "utf8")).toContain("name: prs:start-issue-work");
    const aliasSkillPath = resolve(codexHome, "skills", "prs-create", "SKILL.md");
    expect(existsSync(aliasSkillPath)).toBe(true);
    expect(readFileSync(aliasSkillPath, "utf8")).toContain("name: prs:create");
    const reviewSkillPath = resolve(codexHome, "skills", "prs-review", "SKILL.md");
    expect(existsSync(reviewSkillPath)).toBe(true);
    expect(readFileSync(reviewSkillPath, "utf8")).toContain("name: prs:review");
  });

  it("reports no slash command installation when no command root is configured", () => {
    const codexHome = mkdtempSync(resolve(tmpdir(), "prs-codex-home-"));
    cleanupTargets.add(codexHome);

    const result = installManagedCodexSkills({ CODEX_HOME: codexHome }, "/Users/tester");

    expect(result.installed).toBe(11);
    expect(result.skillFiles.some((file) => file.endsWith("/prs/SKILL.md"))).toBe(true);
  });

  it("is idempotent for current managed skills", () => {
    const codexHome = mkdtempSync(resolve(tmpdir(), "prs-codex-home-"));
    cleanupTargets.add(codexHome);

    installManagedCodexSkills({ CODEX_HOME: codexHome }, "/Users/tester");
    const result = installManagedCodexSkills({ CODEX_HOME: codexHome }, "/Users/tester");

    expect(result.installed).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(11);
    expect(result.skipped).toEqual([]);
  });

  it("refreshes legacy managed skills that do not have a marker yet", () => {
    const codexHome = mkdtempSync(resolve(tmpdir(), "prs-codex-home-"));
    cleanupTargets.add(codexHome);
    const skillDir = resolve(codexHome, "skills", "prs");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      resolve(skillDir, "SKILL.md"),
      [
        "---",
        "name: prs",
        'description: "old managed skill"',
        "---",
        "",
        "## prs Workflow Contract",
        "",
        "Use `prs audit publish`.",
        "",
      ].join("\n"),
      "utf8"
    );

    const result = installManagedCodexSkills({ CODEX_HOME: codexHome }, "/Users/tester");

    expect(result.installed).toBe(10);
    expect(result.updated).toBe(1);
    expect(readFileSync(resolve(skillDir, "SKILL.md"), "utf8")).toContain(
      '<!-- prs:managed-skill name="prs"'
    );
  });

  it("skips custom files at managed skill paths", () => {
    const codexHome = mkdtempSync(resolve(tmpdir(), "prs-codex-home-"));
    cleanupTargets.add(codexHome);
    const skillDir = resolve(codexHome, "skills", "prs");
    const skillPath = resolve(skillDir, "SKILL.md");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, "# My local prs helper\n", "utf8");

    const result = installManagedCodexSkills({ CODEX_HOME: codexHome }, "/Users/tester");

    expect(result.installed).toBe(10);
    expect(result.updated).toBe(0);
    expect(result.skipped).toEqual([
      {
        filePath: skillPath,
        skillName: "prs",
        reason: "custom-file",
      },
    ]);
    expect(readFileSync(skillPath, "utf8")).toBe("# My local prs helper\n");
  });
});
