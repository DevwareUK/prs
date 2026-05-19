import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  parsePrsCommandSurfaceArgs,
  routePrsCommandSurfaceAction,
} from "./prs-command-surface";

export type ManagedCodexSkill = {
  folderName: string;
  name: string;
  description: string;
  body: string;
};

export type InstalledCodexSkillsResult = {
  root: string;
  installed: number;
  updated: number;
  unchanged: number;
  skipped: {
    filePath: string;
    skillName: string;
    reason: "custom-file";
  }[];
  skillFiles: string[];
};

export type CodexSkillRenderOptions = {
  cliFallbackCommand?: string[];
};

export type ManagedCodexSkillStatus = {
  filePath: string;
  skillName: string;
  status: "missing" | "current" | "stale" | "custom";
  expectedHash: string;
  installedHash?: string;
};

const MANAGED_SKILL_MARKER_VERSION = "1";
const MANAGED_SKILL_MARKER_PATTERN =
  /<!-- prs:managed-skill name="([^"]+)" version="([^"]+)" hash="([a-f0-9]+)" -->/;

const SHARED_WORKFLOW_CONTRACT = [
  "## prs Workflow Contract",
  "",
  "- Use Superpowers for brainstorming, planning, worktrees, agents, and verification.",
  "- Let Superpowers create and manage fresh git worktrees from an updated origin base branch.",
  "- Keep the user's current checkout separate from issue implementation work.",
  "- Publish specs, plans, decisions, and completion notes to GitHub through `prs audit publish`.",
  "- Keep raw prompts, logs, metadata, and local artifacts under `.prs/runs`.",
  "- Never commit generated Superpowers specs or plans to `docs/superpowers`.",
  "- Finish by verifying, committing, pushing, opening or updating a pull request, publishing final audit, and cleaning up only when safe.",
].join("\n");

function renderPrPrepareReviewToolCommand(): string {
  const route = routePrsCommandSurfaceAction(
    parsePrsCommandSurfaceArgs(["pr", "123", "prepare-review"])
  );
  const cliArgs = route.cliArgs?.join(" ");
  if (!route.toolOnly || !cliArgs) {
    throw new Error("Expected /prs pr <number> prepare-review to route to a prs tool command.");
  }

  return `prs ${cliArgs.replace("123", "<number>")}`;
}

function renderIssueReadyToolCommand(all = false): string {
  const route = routePrsCommandSurfaceAction(
    parsePrsCommandSurfaceArgs(all ? ["issue", "123", "--all"] : ["issue", "123"])
  );
  const cliArgs = route.cliArgs?.join(" ");
  if (!cliArgs) {
    throw new Error("Expected /prs issue <number> to route through a prs tool command.");
  }

  return `prs ${cliArgs.replace("123", "<number>")}`;
}

function renderPrReadyToolCommand(all = false): string {
  const route = routePrsCommandSurfaceAction(
    parsePrsCommandSurfaceArgs(all ? ["pr", "123", "--all"] : ["pr", "123"])
  );
  const cliArgs = route.cliArgs?.join(" ");
  if (!route.toolOnly || !cliArgs) {
    throw new Error("Expected /prs pr <number> to route to a prs tool command.");
  }

  return `prs ${cliArgs.replace("123", "<number>")}`;
}

function renderReviewCommand(action: "diff" | "tests" | "features"): string {
  const route = routePrsCommandSurfaceAction(parsePrsCommandSurfaceArgs(["review", action]));
  const cliArgs = route.cliArgs?.join(" ");
  if (!cliArgs) {
    throw new Error(`Expected /prs review ${action} to route through a prs command.`);
  }

  return `prs ${cliArgs}`;
}

function formatShellCommandSegment(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

function formatCliFallbackCommand(command: string[]): string | undefined {
  const normalized = command.map((segment) => segment.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return undefined;
  }

  return normalized.map(formatShellCommandSegment).join(" ");
}

function normalizeCliFallbackCommand(command: string[] | undefined): string[] {
  return (command ?? []).map((segment) => segment.trim()).filter(Boolean);
}

function computeManagedSkillHash(
  skill: ManagedCodexSkill,
  options: CodexSkillRenderOptions
): string {
  const payload = JSON.stringify({
    markerVersion: MANAGED_SKILL_MARKER_VERSION,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    cliFallbackCommand: normalizeCliFallbackCommand(options.cliFallbackCommand),
  });

  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function renderManagedSkillMarker(
  skill: ManagedCodexSkill,
  options: CodexSkillRenderOptions
): string {
  return `<!-- prs:managed-skill name="${skill.name}" version="${MANAGED_SKILL_MARKER_VERSION}" hash="${computeManagedSkillHash(
    skill,
    options
  )}" -->`;
}

function readManagedSkillMarker(content: string):
  | {
      name: string;
      version: string;
      hash: string;
    }
  | undefined {
  const match = content.match(MANAGED_SKILL_MARKER_PATTERN);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }

  return {
    name: match[1],
    version: match[2],
    hash: match[3],
  };
}

function isLegacyManagedSkillContent(content: string, skill: ManagedCodexSkill): boolean {
  return (
    content.includes(`name: ${skill.name}`) &&
    content.includes("## prs Workflow Contract") &&
    content.includes("prs audit publish")
  );
}

function renderSetupCapturedCliGuidance(options: CodexSkillRenderOptions): string[] {
  const formattedCommand = formatCliFallbackCommand(options.cliFallbackCommand ?? []);
  if (!formattedCommand) {
    return [];
  }

  return [
    `- Use the setup-captured fallback CLI as the primary Codex command path: \`${formattedCommand} <args>\`.`,
    `- Fast path for \`/prs issue\`: run \`${formattedCommand} tool issue list --actionable --json\` exactly once.`,
    `- Fast path for \`/prs pr\`: run \`${formattedCommand} tool pr list --actionable --json\` exactly once.`,
    "- Do not run `command -v prs`, `git status`, GitHub API fallbacks, SSH PR-ref discovery, or source-code inspection before this fast-path command.",
  ];
}

function renderGenericSetupCapturedCliGuidance(
  options: CodexSkillRenderOptions
): string[] {
  const formattedCommand = formatCliFallbackCommand(options.cliFallbackCommand ?? []);
  if (!formattedCommand) {
    return [];
  }

  return [
    "",
    "## Tooling Expectations",
    "",
    `- Use the setup-captured fallback CLI as the primary Codex command path: \`${formattedCommand} <args>\`.`,
    "- Do not report `prs` as unavailable solely because it is missing from PATH; use the setup-captured fallback command instead.",
    `- For audit publication, run \`${formattedCommand} audit publish --issue <number> --file <path> --section <name>\` or \`${formattedCommand} audit publish --pr <number> --file <path> --section <name>\`.`,
  ];
}

export const PRS_CODEX_SKILLS: ManagedCodexSkill[] = [
  {
    folderName: "prs",
    name: "prs",
    description:
      "Use as the unified prs workflow router for /prs, /prs issue, /prs pr, /prs audit, and /prs finish in prs-configured repositories.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Unified /prs Router",
      "",
      "Use this as the single front door for prs-configured repository work.",
      "Default workflow handoff: `/prs create` -> `/prs issue` -> `/prs pr`.",
      "",
      "### Tooling expectations",
      "",
      "- Do not assume the GitHub CLI (`gh`) is installed in Codex sessions.",
      "- Prefer the installed `prs` command when it is on `PATH`.",
      "- In a prs source checkout where `prs` is not on `PATH`, run the repository-local CLI with `corepack pnpm --filter @prs/cli... build` and `node packages/cli/dist/index.js <args>`.",
      "- For GitHub metadata, prefer `GH_TOKEN` or `GITHUB_TOKEN`, then authenticated `gh` when available.",
      "- If no GitHub API authentication is available, SSH pull refs may identify candidate PR numbers, but do not call that an actionable-for-me list because assignees, review requests, checks, comments, and draft state are unavailable.",
      "- Never call commands that launch Codex from inside a Codex session.",
      "- Do not recreate prs workflows with ad hoc git commands when a deterministic `prs tool ...` command exists.",
      "- For `/prs issue`, run `prs tool issue list --actionable --json`; if it returns `status: \"blocked\"`, report its `message` and `nextAction` instead of inspecting git refs or source files.",
      "- For `/prs pr`, run `prs tool pr list --actionable --json`; if it returns `status: \"blocked\"`, report its `message` and `nextAction` instead of inspecting git refs or source files.",
      "- For `/prs review tests`, run the existing test backlog command path instead of inventing a separate coverage audit.",
      "",
      "### Interactive forms",
      "",
      "- `/prs`: inspect repository state and offer likely next actions.",
      "- `/prs:create`, `/prs:review`, `/prs:issue`, `/prs:pr`, `/prs:audit`, and `/prs:finish` are top-level alias skills for the matching `/prs ...` routes.",
      "- `/prs create`: start the guided route for creating new GitHub work items from a rough idea. Use a descriptive working title such as `Draft GitHub Issue: <short topic>` in Codex status/summary text. After draft artifacts are created, stop and ask the user to approve the draft before creating it in GitHub; after creating the GitHub issue, offer the next `/prs issue` step for that issue.",
      "- `/prs create issue`: create one implementation-ready GitHub issue or a linked issue set from a rough idea. This currently uses the existing `prs issue draft` implementation; after artifacts are drafted, ask for approval and offer to create the GitHub issue or issue set. After creating issue(s), offer the next `/prs issue` step for the created issue context.",
      "- `/prs review`: show review lanes for diff review, test coverage strategy, and feature/product backlog discovery.",
      `- \`/prs review tests\`: run \`${renderReviewCommand("tests")}\`; review repository-wide testing strategy and coverage, then offer to turn approved gaps into GitHub issues.`,
      `- \`/prs review features\`: run \`${renderReviewCommand("features")}\`; review repository-wide feature/product opportunities, then offer to turn approved opportunities into GitHub issues.`,
      `- \`/prs review diff\`: run \`${renderReviewCommand("diff")}\`; review the current diff or supplied \`--base\`/\`--head\` comparison.`,
      "- `/prs issue`: run `prs tool issue list --actionable --json`, show actionable for me open issues, and then offer contextual issue actions. One selection prepares issue context; multiple selections start parallel issue work through Superpowers agents and worktrees.",
      "- `/prs pr`: run `prs tool pr list --actionable --json`, show the returned actionable pull requests, and then offer contextual PR actions.",
      "",
      "### Direct forms",
      "",
      `- \`/prs issue <number>\`: run \`${renderIssueReadyToolCommand()}\`; gather issue context, write readiness metadata, and stop with the next sensible action so Superpowers can create the implementation worktree.`,
      `- \`/prs issue <number> --all\`: run \`${renderIssueReadyToolCommand(true)}\`; if the result is ready, do not stop after the readiness JSON when \`--all\` is present. Instead, continue into Superpowers worktree creation and issue implementation from the updated base branch, publish approved spec/plan artifacts to GitHub audit, and then use \`/prs finish\` discipline for verification, commit, push, PR, audit, and safe cleanup.`,
      "- `/prs issue <number> refine`: refine the issue.",
      "- `/prs issue <number> plan`: publish or refresh the issue plan.",
      "- `/prs issue <number> finish`: finish work with the issue context preserved; after a pull request exists, offer the next `/prs pr` step for that pull request.",
      `- \`/prs pr <number>\`: run \`${renderPrReadyToolCommand()}\`; prepare the actual PR head branch in the current repository checkout used by the user's normal local runtime, fetch and merge the latest PR base branch, summarize \`prContext\` signals from GitHub, including grouped \`commentSummary\` entries with source links when available, and stop with the next sensible action so the user can browse the app quickly. If the PR head branch is locked by a clean prs worktree, the tool may remove that clean worktree and then check out the actual PR branch in the current checkout. If that worktree has uncommitted changes, stop and report the blocker.`,
      `- \`/prs pr <number> --all\`: run \`${renderPrReadyToolCommand(true)}\`; take all sensible readiness steps without prompting in the current repository checkout, including starting the configured local app runtime when needed. Do not push, review, fix, approve, merge, switch to an existing PR worktree, or run broad local verification.`,
      `- \`/prs pr <number> prepare-review\`: run \`${renderPrPrepareReviewToolCommand()}\`, keep the prepared branch checked out in the current repository, read the returned \`snapshotFilePath\` when useful, then continue review in this Codex session. The deterministic tool does not generate \`review-brief.md\`; do not look for one unless a separate command created it.`,
      "- `/prs pr <number> resolve-conflicts`: run `prs pr resolve-conflicts <number>`.",
      "- `/prs pr <number> fix-comments`: run `prs tool pr fix-comments <number> --json`, read the returned `promptFilePath` and `snapshotFilePath`, then continue the selected fixes in this Codex session. After fixes are complete, verify, commit reviewed changes, and run `prs tool pr push-reviewed <number> --json`. Do not run a command that launches nested Codex.",
      "- `/prs pr <number> fix-failing-tests`: run `prs tool pr fix-failing-tests <number> --json`, read the returned `promptFilePath` and `snapshotFilePath`, then continue the failing-test fix in this Codex session. After fixes are complete, verify, commit reviewed changes, and run `prs tool pr push-reviewed <number> --json`. Do not run a command that launches nested Codex.",
      "- `/prs pr <number> fix-tests`: run `prs tool pr fix-tests <number> --json`, read the returned `promptFilePath` and `snapshotFilePath`, then continue the selected test work in this Codex session. After fixes are complete, verify, commit reviewed changes, and run `prs tool pr push-reviewed <number> --json`. Do not run a command that launches nested Codex.",
      "- `/prs audit publish`: publish specs, plans, decisions, verification notes, or completion summaries.",
      "- `/prs finish`: verify, commit, push, open or update a PR, publish final audit, clean up only when safe, and then offer the next `/prs pr` step for that pull request.",
      "",
      "Existing managed skills are backing behaviors:",
      "- `prs:start-issue-work` backs `/prs create issue`, `/prs issue <number> refine`, and `/prs issue <number> plan`.",
      "- `prs:review` backs `/prs review`, `/prs review tests`, `/prs review features`, and `/prs review diff`.",
      "- `prs:parallel-batch` backs multi-select `/prs issue`.",
      "- `prs:publish-audit` backs `/prs audit publish`.",
      "- `prs:finish-work` backs `/prs finish`.",
      "- Alias skills such as `prs:create` and `prs:pr` only narrow the entrypoint; they should still follow this router contract.",
    ].join("\n"),
  },
  {
    folderName: "prs-start-issue-work",
    name: "prs:start-issue-work",
    description:
      "Use when starting GitHub issue work in a prs-configured repository; routes Codex through Superpowers worktrees and GitHub audit publication.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Start Issue Work",
      "",
      "1. Read the repository `AGENTS.md` and `.prs/config.json` if present.",
      "2. For draft creation, use a descriptive working title such as `Draft GitHub Issue: <short topic>` in Codex status/summary text.",
      "3. If creating draft issue artifacts, stop after the draft and ask the user to approve it before creating the GitHub issue or issue set.",
      "4. Use Superpowers before implementation work.",
      "5. Instruct Superpowers to create the working git worktree from updated `origin/main` or the configured base branch.",
      "6. Reserve or reuse a `.prs/runs` workspace for local artifacts.",
      "7. Publish approved spec and plan artifacts to GitHub with `prs audit publish`.",
      "8. After the implementation is pushed and a PR exists, clean up the issue worktree only when it has no uncommitted or unpushed work.",
      "9. Once issue work is complete and a PR exists, offer the next `/prs pr` step for that pull request.",
    ].join("\n"),
  },
  {
    folderName: "prs-publish-audit",
    name: "prs:publish-audit",
    description:
      "Use when publishing prs workflow specs, plans, decisions, verification notes, or completion summaries to GitHub audit comments.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Publish Audit",
      "",
      "Use `prs audit publish --issue <number> --file <path> --section <name>` for issue artifacts.",
      "Use `prs audit publish --pr <number> --file <path> --section <name>` for pull request artifacts.",
      "If publication fails, report the artifact path and do not claim the workflow is complete.",
    ].join("\n"),
  },
  {
    folderName: "prs-finish-work",
    name: "prs:finish-work",
    description:
      "Use when finishing work in a prs-configured repository; verifies, commits, pushes, opens or updates PRs, and publishes final audit.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Finish Work",
      "",
      "1. Use Superpowers verification-before-completion discipline.",
      "2. Run the repository configured verification command.",
      "3. Commit only reviewed implementation changes.",
      "4. Push the branch and open or update the pull request.",
      "5. Publish final verification and PR state with `prs audit publish`.",
      "6. Clean up the issue worktree after the pull request exists only when no uncommitted or unpushed work would be lost.",
      "7. Once the issue is complete and a PR exists, offer the next `/prs pr` step for that pull request.",
    ].join("\n"),
  },
  {
    folderName: "prs-parallel-batch",
    name: "prs:parallel-batch",
    description:
      "Use when running multiple independent prs issues; coordinates Superpowers agents and separate worktrees with GitHub audit trails.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Parallel Batch",
      "",
      "Use Superpowers agent and worktree workflows for each independent issue.",
      "Keep each issue in its own branch, run workspace, and GitHub audit thread.",
      "Summarize each issue independently as running, PR opened, no changes, failed, or needs human review.",
    ].join("\n"),
  },
  {
    folderName: "prs-create",
    name: "prs:create",
    description:
      "Draft a GitHub issue from a rough idea with the prs create workflow.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Create Work Item",
      "",
      "Use this alias exactly like `/prs create` or `/prs create issue`.",
      "If the user has not provided the rough idea yet, ask for it in one concise sentence.",
      "When the idea is present, use a descriptive working title such as `Draft GitHub Issue: <short topic>` in Codex status/summary text.",
      "Create draft artifacts with the configured prs issue-draft flow.",
      "After draft artifacts exist, stop and ask the user to approve them before creating the GitHub issue or linked issue set in GitHub.",
      "If the user approves, create the issue through the configured forge flow and publish any approved Superpowers plan artifact to GitHub audit.",
      "After creating the GitHub issue, offer the next `/prs issue` step for that issue so the user can work on it now.",
    ].join("\n"),
  },
  {
    folderName: "prs-review",
    name: "prs:review",
    description:
      "Review diffs, test coverage strategy, or feature backlog opportunities with prs.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Review Work",
      "",
      "Use this alias exactly like `/prs review`.",
      "For an interactive review lane, offer diff review, test coverage strategy review, and feature/product backlog review.",
      `For \`/prs:review tests\`, run \`${renderReviewCommand("tests")}\` with any user-supplied flags such as \`--top\`, \`--format\`, or \`--create-issues\`. Treat it as a repository-wide testing strategy and coverage review.`,
      `For \`/prs:review features\`, run \`${renderReviewCommand("features")}\` with any user-supplied flags. Treat it as repository-wide product and feature opportunity discovery.`,
      `For \`/prs:review diff\`, run \`${renderReviewCommand("diff")}\` with any user-supplied \`--base\`, \`--head\`, or \`--format\` flags.`,
      "When review output proposes GitHub issues, ask for approval before creating issues unless the user explicitly passed an issue-creation flag.",
    ].join("\n"),
  },
  {
    folderName: "prs-issue",
    name: "prs:issue",
    description:
      "List, prepare, or start actionable GitHub issue work with prs.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Issue Work",
      "",
      "Use this alias exactly like `/prs issue`.",
      `For \`/prs:issue <number>\`, run \`${renderIssueReadyToolCommand()}\` and stop with the next sensible action unless \`--all\` is present.`,
      `For \`/prs:issue <number> --all\`, run \`${renderIssueReadyToolCommand(true)}\`, then continue into Superpowers worktree creation and issue implementation from the updated base branch.`,
      "For interactive issue selection, use `prs tool issue list --actionable --json` as the source of truth.",
      "When implementation opens or updates a pull request, clean up the issue worktree only when no uncommitted or unpushed work would be lost.",
    ].join("\n"),
  },
  {
    folderName: "prs-pr",
    name: "prs:pr",
    description:
      "Prepare pull requests for local testing or review with prs.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Pull Request Work",
      "",
      "Use this alias exactly like `/prs pr`.",
      "For interactive PR selection, use `prs tool pr list --actionable --json` as the source of truth.",
      `For \`/prs:pr <number>\`, run \`${renderPrReadyToolCommand()}\`; prepare the actual PR head branch in the current repository checkout used by the user's local runtime, fetch and merge the latest PR base branch, summarize \`prContext\` GitHub signals, including grouped \`commentSummary\` entries with source links when available, and stop once the app is ready to browse or a blocker is clear.`,
      `For \`/prs:pr <number> --all\`, run \`${renderPrReadyToolCommand(true)}\`; take all sensible readiness steps but do not push, review, fix, approve, merge, switch into an existing PR worktree, or run broad local verification.`,
      "If the PR head branch is locked by a clean prs worktree, let the tool remove that worktree and check out the actual PR branch in the current checkout. If the worktree is dirty, stop and report the blocker.",
      "After readiness, offer the next sensible step: browse/functional test first, then inspect failed or pending checks, grouped comment summaries, managed AI test suggestions, and actionable review comments before any explicit fix/review command.",
    ].join("\n"),
  },
  {
    folderName: "prs-audit",
    name: "prs:audit",
    description:
      "Publish prs run artifacts to GitHub audit comments.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Audit Publication",
      "",
      "Use this alias exactly like `/prs audit publish`.",
      "Publish specs, plans, decisions, verification notes, and completion summaries with `prs audit publish`.",
      "If publication fails, report the artifact path and the exact blocker.",
    ].join("\n"),
  },
  {
    folderName: "prs-finish",
    name: "prs:finish",
    description:
      "Finish prs work by verifying, pushing, opening a PR, publishing audit, and safely cleaning up.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Finish Work",
      "",
      "Use this alias exactly like `/prs finish`.",
      "Verify with the repository configured command, commit reviewed implementation changes, push the branch, and open or update the pull request.",
      "Publish final verification and PR state with `prs audit publish`.",
      "Clean up an issue worktree after the pull request exists only when no uncommitted or unpushed work would be lost.",
      "Once the issue is complete and a PR exists, offer the next `/prs pr` step for that pull request.",
    ].join("\n"),
  },
];

export function resolveCodexSkillsRoot(
  env: { CODEX_HOME?: string } = process.env,
  home = homedir()
): string {
  const codexHome = env.CODEX_HOME?.trim() || resolve(home, ".codex");
  return resolve(codexHome, "skills");
}

export function renderCodexSkillMarkdown(
  skill: ManagedCodexSkill,
  options: CodexSkillRenderOptions = {}
): string {
  const bodyWithSkillGuidance =
    skill.name === "prs"
      ? skill.body.replace(
          "- Prefer the installed `prs` command when it is on `PATH`.",
          renderSetupCapturedCliGuidance(options).join("\n") ||
            "- Prefer the installed `prs` command when it is on `PATH`."
        )
      : skill.body;
  const body =
    skill.name === "prs"
      ? bodyWithSkillGuidance
      : bodyWithSkillGuidance.replace(
          SHARED_WORKFLOW_CONTRACT,
          [SHARED_WORKFLOW_CONTRACT, ...renderGenericSetupCapturedCliGuidance(options)].join("\n")
        );

  return [
    "---",
    `name: ${skill.name}`,
    `description: ${JSON.stringify(skill.description)}`,
    "---",
    "",
    renderManagedSkillMarker(skill, options),
    "",
    body.trim(),
    "",
  ].join("\n");
}

export function inspectManagedCodexSkills(
  env: { CODEX_HOME?: string } = process.env,
  home = homedir(),
  options: CodexSkillRenderOptions = {}
): ManagedCodexSkillStatus[] {
  const root = resolveCodexSkillsRoot(env, home);

  return PRS_CODEX_SKILLS.map((skill) => {
    const skillFile = resolve(root, skill.folderName, "SKILL.md");
    const expectedHash = computeManagedSkillHash(skill, options);

    if (!existsSync(skillFile)) {
      return {
        filePath: skillFile,
        skillName: skill.name,
        status: "missing",
        expectedHash,
      };
    }

    const content = readFileSync(skillFile, "utf8");
    const marker = readManagedSkillMarker(content);
    if (marker?.name === skill.name) {
      return {
        filePath: skillFile,
        skillName: skill.name,
        status:
          marker.version === MANAGED_SKILL_MARKER_VERSION && marker.hash === expectedHash
            ? "current"
            : "stale",
        expectedHash,
        installedHash: marker.hash,
      };
    }

    if (isLegacyManagedSkillContent(content, skill)) {
      return {
        filePath: skillFile,
        skillName: skill.name,
        status: "stale",
        expectedHash,
      };
    }

    return {
      filePath: skillFile,
      skillName: skill.name,
      status: "custom",
      expectedHash,
    };
  });
}

export function installManagedCodexSkills(
  env: { CODEX_HOME?: string } = process.env,
  home = homedir(),
  options: CodexSkillRenderOptions = {}
): InstalledCodexSkillsResult {
  const root = resolveCodexSkillsRoot(env, home);
  const skillFiles: string[] = [];
  const skipped: InstalledCodexSkillsResult["skipped"] = [];
  let installed = 0;
  let updated = 0;
  let unchanged = 0;
  const statuses = inspectManagedCodexSkills(env, home, options);

  for (const [index, skill] of PRS_CODEX_SKILLS.entries()) {
    const skillDir = resolve(root, skill.folderName);
    const skillFile = resolve(skillDir, "SKILL.md");
    const status = statuses[index];

    if (status?.status === "custom") {
      skipped.push({
        filePath: skillFile,
        skillName: skill.name,
        reason: "custom-file",
      });
      continue;
    }

    if (status?.status === "current") {
      unchanged += 1;
      skillFiles.push(skillFile);
      continue;
    }

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillFile, renderCodexSkillMarkdown(skill, options), "utf8");
    if (status?.status === "stale") {
      updated += 1;
    } else {
      installed += 1;
    }
    skillFiles.push(skillFile);
  }

  return {
    root,
    installed,
    updated,
    unchanged,
    skipped,
    skillFiles,
  };
}
