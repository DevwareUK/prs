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
  "- Read `.prs/config.json` before starting prs workflow work.",
  "- Resolve the active workflow role through `.prs/config.json` `ai.roles` and `ai.profiles` before delegating or launching any separate Codex work. Supported roles are planner, implementer, reviewer, and tester.",
  "- Use the planner role for `prs:create`, issue refinement, specs, plans, and workflow planning; implementer for issue implementation and code changes; reviewer for PR/diff review; and tester for test-backlog, add-tests, failing-test, and verification work.",
  "- When spawning agents or creating/sending separate Codex threads, pass the resolved role model and thinking level when the available tool supports those overrides.",
  "- A managed skill cannot change the model of an already-open Codex app conversation. If the configured role model or thinking level cannot be applied to delegated or separate work, report the blocker instead of silently using the current Codex app window model.",
  "- If `ai.codex.preferSubagents` is enabled, or omitted and therefore resolved to the default enabled value, treat the repository config as the user's standing request to delegate suitable independent tasks to subagents when the subagent tool is available.",
  "- Use subagents for independent exploration, implementation, review, or verification tasks when they improve throughput or context isolation; keep coordination, user approval gates, final verification, and user-facing decisions in the main session.",
  "- If `ai.codex.preferSubagents` is explicitly disabled, do not treat the repository as having standing subagent delegation consent.",
  "- Use Superpowers for brainstorming, planning, worktrees, agents, and verification.",
  "- Let Superpowers create and manage fresh git worktrees from an updated origin base branch.",
  "- Keep the user's current checkout separate from issue implementation work.",
  "- Publish specs, plans, decisions, and completion notes to GitHub through `prs audit publish`.",
  "- Keep raw prompts, logs, metadata, and local artifacts under `.prs/runs`.",
  "- Never commit generated Superpowers specs or plans to `docs/superpowers`.",
  "- Finish by verifying, committing, pushing, opening or updating a pull request, publishing final audit, and cleaning up only when safe.",
].join("\n");

const OBSERVABILITY_CREATE_WORKFLOW = [
  "- `/prs create observability`: reserved shortcut for DSM observability findings; do not treat `observability` as a rough idea. run `dsm grafana triage` first, then feed its JSON artifact to `prs issue draft --observability-findings <artifact>`. The defaults are `--env prod` and `--since 24h`; infer `--site` from the current repository, preferably `.dsm/site.json`, and ask for the site only if it cannot be inferred. Keep DSM and PRS loosely coupled through the JSON artifact file under `.prs/runs`; do not query Grafana, Prometheus, Loki, or Faro from PRS itself.",
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

function renderPrReviewToolCommand(unattended = false): string {
  const route = routePrsCommandSurfaceAction(
    parsePrsCommandSurfaceArgs(
      unattended ? ["pr", "123", "review", "--unattended"] : ["pr", "123", "review"]
    )
  );
  const cliArgs = route.cliArgs?.join(" ");
  if (!route.toolOnly || !cliArgs) {
    throw new Error("Expected /prs pr <number> review to route to a prs tool command.");
  }

  return `prs ${cliArgs.replace("123", "<number>")}`;
}

function renderPrPublishReviewToolCommand(unattended = false): string {
  return unattended
    ? "prs tool pr publish-review <number> --report <reportFilePath> --comments <commentsFilePath> --unattended --json"
    : "prs tool pr publish-review <number> --report <reportFilePath> --comments <commentsFilePath> --json";
}

function renderIssueReadyToolCommand(unattended = false): string {
  const route = routePrsCommandSurfaceAction(
    parsePrsCommandSurfaceArgs(unattended ? ["issue", "123", "--unattended"] : ["issue", "123"])
  );
  const cliArgs = route.cliArgs?.join(" ");
  if (!cliArgs) {
    throw new Error("Expected /prs issue <number> to route through a prs tool command.");
  }

  return `prs ${cliArgs.replace("123", "<number>")}`;
}

function renderPrReadyToolCommand(unattended = false): string {
  const route = routePrsCommandSurfaceAction(
    parsePrsCommandSurfaceArgs(unattended ? ["pr", "123", "--unattended"] : ["pr", "123"])
  );
  const cliArgs = route.cliArgs?.join(" ");
  if (!route.toolOnly || !cliArgs) {
    throw new Error("Expected /prs pr <number> to route to a prs tool command.");
  }

  return `prs ${cliArgs.replace("123", "<number>")}`;
}

function renderCleanupBranchesToolCommand(): string {
  const route = routePrsCommandSurfaceAction(parsePrsCommandSurfaceArgs(["cleanup", "branches"]));
  const cliArgs = route.cliArgs?.join(" ");
  if (!route.toolOnly || !cliArgs) {
    throw new Error("Expected /prs cleanup branches to route to a prs tool command.");
  }

  return `prs ${cliArgs}`;
}

function renderCleanupWorktreesToolCommand(): string {
  const route = routePrsCommandSurfaceAction(parsePrsCommandSurfaceArgs(["cleanup", "worktrees"]));
  const cliArgs = route.cliArgs?.join(" ");
  if (!route.toolOnly || !cliArgs) {
    throw new Error("Expected /prs cleanup worktrees to route to a prs tool command.");
  }

  return `prs ${cliArgs}`;
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
      OBSERVABILITY_CREATE_WORKFLOW,
      "- `/prs review`: show review lanes for diff review, test coverage strategy, and feature/product backlog discovery.",
      `- \`/prs review tests\`: run \`${renderReviewCommand("tests")}\`; review repository-wide testing strategy and coverage, then offer to turn approved gaps into GitHub issues.`,
      `- \`/prs review features\`: run \`${renderReviewCommand("features")}\`; review repository-wide feature/product opportunities, then offer to turn approved opportunities into GitHub issues.`,
      `- \`/prs review diff\`: run \`${renderReviewCommand("diff")}\`; review the current diff or supplied \`--base\`/\`--head\` comparison.`,
      "- `/prs issue`: run `prs tool issue list --actionable --json`, show each returned actionable for me issue number, title, and GitHub URL, and then offer contextual issue actions. One selection prepares issue context; multiple selections start parallel issue work through Superpowers agents and worktrees.",
      "- `/prs pr`: run `prs tool pr list --actionable --json`, show each returned pull request number, title, and GitHub URL, and then offer contextual PR actions.",
      "- `/prs cleanup branches`: run `prs tool branches cleanup --json`, report local branches already merged into the configured base branch plus protected/skipped branches, and ask before applying cleanup unless the user explicitly requested removal.",
      "- `/prs cleanup worktrees`: run `prs tool worktrees cleanup --json`, report safe removal candidates and blocked worktrees, and ask before applying cleanup unless the user explicitly requested removal.",
      "",
      "### Direct forms",
      "",
      `- \`/prs issue <number>\`: run \`${renderIssueReadyToolCommand()}\`; gather issue context, write readiness metadata, and stop with the next sensible action so Superpowers can create the implementation worktree.`,
      `- \`/prs issue <number> --unattended\` (aliases: \`--auto\`, \`--jdi\`): run \`${renderIssueReadyToolCommand(true)}\`; if the result is ready, do not stop after the readiness JSON. Continue into Superpowers worktree creation and issue implementation from the updated base branch, update \`.prs/config.json\` \`prReadiness.commands\` when new code introduces required local setup such as migrations, config import, generated assets, dependency updates, or cache rebuilds, publish unattended artifacts with automation framing, and then use \`/prs finish\` discipline for verification, commit, push, PR, audit, and safe cleanup.`,
      "- `/prs issue <number> estimate`: run `prs tool issue estimate-context <number> --json`; if it is ready, use the returned managed plan, profiles, verification commands, instructions, and output schema to create a Codex-authored estimate JSON artifact under `.prs/runs`, then run `prs tool issue publish-estimate <number> --file <artifact> --json`, show the compact estimate table fields and token telemetry comment URL, and stop. Do not launch a runtime, edit implementation files, commit, or push.",
      "- `/prs issue <number> refine`: run guided issue refinement on the GitHub issue comments until the user's intention, scope, access, data changes, acceptance criteria, existing-user impact, and nearby knock-on effects are clear. Ask all currently blocking high-value questions; once settled in an interactive run, review the refined issue draft, managed specification, and managed implementation plan before publishing those managed comments plus a final confidence comment.",
      "- `/prs issue <number> plan`: publish or refresh the issue plan.",
      "- `/prs issue <number> finish`: finish work with the issue context preserved; after a pull request exists, standalone guided runs offer the next `/prs pr` step for that pull request, while `/prs issue <number> --jdi` runs return to the issue pipeline for PR readiness, active Codex review, comments, CI, and final audit.",
      `- \`/prs pr <number>\`: run \`${renderPrReadyToolCommand()}\`; prepare the actual PR head branch in the current repository checkout used by the user's normal local runtime, fetch and merge the latest PR base branch, run configured \`prReadiness.commands\`, summarize \`localReadiness\` and \`prContext\` signals from GitHub, including grouped \`commentSummary\` entries with source links when available, and stop with the next sensible action so the user can browse the app quickly. If the PR head branch is locked by a clean prs worktree, the tool may remove that clean worktree and then check out the actual PR branch in the current checkout. If that worktree has uncommitted changes, stop and report the blocker.`,
      `- \`/prs pr <number> --unattended\` (aliases: \`--auto\`, \`--jdi\`): run \`${renderPrReadyToolCommand(true)}\`; take all sensible readiness steps without prompting in the current repository checkout, including configured \`prReadiness.commands\` and starting the configured local app runtime when needed. Do not push, review, fix, approve, merge, switch to an existing PR worktree, or run broad local verification.`,
      `- \`/prs pr <number> review\`: run \`${renderPrReviewToolCommand()}\`, read the returned \`promptFilePath\` and \`contextFilePath\`, inspect the prepared checkout in this active Codex session, write the final report to the returned \`reportFilePath\`, write inline review candidates to the returned \`commentsFilePath\`, present a concise approval summary, and run \`${renderPrPublishReviewToolCommand()}\` only after the user approves posting to GitHub. Do not edit code, commit, push, resolve comments, or post directly to GitHub outside the approved publish tool.`,
      `- \`/prs pr <number> review --unattended\` (aliases: \`--auto\`, \`--jdi\`): run \`${renderPrReviewToolCommand(true)}\`, write the report and inline review candidates, then publish with \`${renderPrPublishReviewToolCommand(true)}\`. This unattended GitHub-visible output must keep visible automation framing.`,
      `- \`/prs pr <number> prepare-review\`: run \`${renderPrPrepareReviewToolCommand()}\`, keep the prepared branch checked out in the current repository, read the returned \`snapshotFilePath\` when useful, then continue review in this Codex session. The deterministic tool does not generate \`review-brief.md\`; do not look for one unless a separate command created it.`,
      `- \`/prs cleanup worktrees\`: run \`${renderCleanupWorktreesToolCommand()}\`, summarize the removable and blocked worktrees, and only run \`prs tool worktrees cleanup --apply --json\` after the user explicitly requests cleanup or approves the dry-run report.`,
      "- `/prs pr <number> resolve-conflicts`: run `prs pr resolve-conflicts <number>`.",
      "- `/prs pr <number> address-comments`: run `prs tool pr address-comments <number> --json`, read the returned `promptFilePath` and `snapshotFilePath`, then continue the selected review-comment fixes in this Codex session. After fixes are complete, verify, commit reviewed changes, and run `prs tool pr push-reviewed <number> --json`. Do not run a command that launches nested Codex.",
      "- `/prs pr <number> fix-tests`: run `prs tool pr fix-tests <number> --json`, read the returned `promptFilePath` and `snapshotFilePath`, then continue the failing-test fix in this Codex session. After fixes are complete, verify, commit reviewed changes, and run `prs tool pr push-reviewed <number> --json`. Do not run a command that launches nested Codex.",
      "- `/prs pr <number> add-tests`: run `prs tool pr add-tests <number> --json`, read the returned `promptFilePath` and `snapshotFilePath`, then continue the selected AI test-suggestion work in this Codex session. After fixes are complete, verify, commit reviewed changes, and run `prs tool pr push-reviewed <number> --json`. Do not run a command that launches nested Codex.",
      "- Treat `packages/cli/src/workflows/pr-lifecycle/` as the internal PR lifecycle coordinator. It owns canonical PR action names and compatibility alias normalization while older PR workflow folders remain implementation steps.",
      `- \`/prs cleanup branches\`: run \`${renderCleanupBranchesToolCommand()}\`, summarize removable and skipped local branches, and only run \`prs tool branches cleanup --apply --json\` after the user explicitly requests cleanup or approves the dry-run report. Do not force-delete branches, delete remote branches, prune stale upstream state, or fall back to manual git branch deletion.`,
      "- `/prs audit publish`: publish specs, plans, decisions, verification notes, or completion summaries.",
      "- `/prs finish`: verify, commit, push, open or update a PR, publish final audit, clean up only when safe, and then offer the next `/prs pr` step for that pull request in standalone guided runs. If `/prs finish` is being used inside `/prs issue <number> --jdi`, return to that issue pipeline after the pull request exists instead of stopping at the handoff.",
      "",
      "Existing managed skills are backing behaviors:",
      "- `prs:start-issue-work` backs `/prs create issue` and `/prs issue <number> plan`; `/prs issue <number> refine` is handled directly in the active Codex session.",
      "- `prs:review` backs `/prs review`, `/prs review tests`, `/prs review features`, and `/prs review diff`.",
      "- `prs:cleanup-branches` backs `/prs cleanup branches`.",
      "- `prs:cleanup-worktrees` backs `/prs cleanup worktrees`.",
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
      "5. Before publishing the final audit, call `get_goal` when goal tools are available, capture the workflow role plus estimate-style profile/model/thinking tuple such as `standard (gpt-5.4-mini, medium thinking)` or `premium (gpt-5.5, high thinking)` when the Codex environment or configured role exposes it, and write the latest Codex usage snapshot to the issue run directory as `codex-token-usage.json` with a stable entry `id` for the workflow phase plus current run/session. If one run has multiple Codex goals or sessions, store them as a version 1 `token-usage-ledger` with an `entries` array. Prefer the actual active Codex session model when available; configured role/profile metadata is fallback provenance and must not be reported as the actual model. If usage or model metadata is unavailable, record that status or note instead of blocking completion. Treat Codex goals as telemetry sources, not as the lifecycle authority for audit publication.",
      "6. Publish final verification, PR state, and token-usage notes to the original issue with `prs audit publish --issue <number> --file <path> --section <name>`; when `codex-token-usage.json` exists beside the audit artifact, the audit publisher also updates the managed `token-usage` ledger.",
      "7. Publish the final issue audit before marking any Codex goal complete or reporting the managed skill run complete.",
      "8. Clean up the issue worktree after the pull request exists only when no uncommitted or unpushed work would be lost.",
      "9. When finishing issue work, publish implementation token usage to the original issue ledger before publishing any PR-lifetime token telemetry.",
      "10. If `/prs finish` is being used inside `/prs issue <number> --jdi`, return to that issue pipeline after the pull request exists instead of stopping at the handoff.",
      "11. Once the issue is complete and a PR exists, offer the next `/prs pr` step for that pull request.",
    ].join("\n"),
  },
  {
    folderName: "prs-cleanup-branches",
    name: "prs:cleanup-branches",
    description:
      "Use when cleaning local git branches that are already merged into the configured base branch.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Cleanup Branches",
      "",
      "Use this alias exactly like `/prs cleanup branches`.",
      `Run \`${renderCleanupBranchesToolCommand()}\` first and summarize removable and skipped local branches.`,
      "Only consider local branches that are already merged into the configured base branch.",
      "Do not force-delete branches, delete remote branches, clean stale upstream branches, prune remotes, or remove branches checked out by any worktree.",
      "Only run `prs tool branches cleanup --apply --json` after the user explicitly requests cleanup or approves the dry-run report.",
      "Do not fall back to manual git branch deletion.",
    ].join("\n"),
  },
  {
    folderName: "prs-cleanup-worktrees",
    name: "prs:cleanup-worktrees",
    description:
      "Use when cleaning prs-managed git worktrees safely.",
    body: [
      SHARED_WORKFLOW_CONTRACT,
      "",
      "## Cleanup Worktrees",
      "",
      "Use this alias exactly like `/prs cleanup worktrees`.",
      `Run \`${renderCleanupWorktreesToolCommand()}\` first and summarize the removable and blocked worktrees.`,
      "Do not remove dirty worktrees, non-PRS worktrees, the current checkout, or detached HEADs that are not reachable from a ref.",
      "Only run `prs tool worktrees cleanup --apply --json` after the user explicitly requests cleanup or approves the dry-run report.",
      "do not fall back to manual git worktree remove or filesystem deletion.",
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
      "If the supplied idea is exactly `observability`, treat it as the reserved DSM observability shortcut, not as a rough idea.",
      "If the first command topic is `observability`, keep using the reserved shortcut even when the user includes pasted notes, attachments, log excerpts, or old draft text. Do not turn pasted notes, attachments, logs, or prior draft text into the issue source for this shortcut.",
      "For observability create runs, infer the site from the current repository, preferably `.dsm/site.json`; default to `--env prod` and `--since 24h`; create a run directory under `.prs/runs`; run `dsm grafana triage` with `--output <runDir>/observability-findings.json` and `--markdown <runDir>/observability-findings.md`; then run `prs issue draft --observability-findings <runDir>/observability-findings.json` and stop at the normal approve/modify/cancel gate.",
      "Do not inspect old observability drafts, old branches, or memory as part of the happy path. Only inspect prior local context if the DSM triage command fails and you are debugging that failure.",
      "If the user has not provided the rough idea yet, ask for it in one concise sentence.",
      "When the idea is present, use a descriptive working title such as `Draft GitHub Issue: <short topic>` in Codex status/summary text.",
      "When a create run starts in an active Codex app session and goal tools are available, call `create_goal` with an objective like `Draft GitHub Issue: <short topic>` before drafting. Then call `get_goal` and confirm an active goal is visible before continuing. If a goal already exists, keep using it and record that fact in the run notes. If no goal is visible after the create/reuse attempt, say so before drafting and record token telemetry as unavailable because no active goal was available, not because model metadata was unavailable.",
      "Create draft artifacts with the configured prs issue-draft flow.",
      "During drafting, ask all currently blocking high-value questions needed to reach a settled specification, including the user's why and likely knock-on effects in nearby code or workflows.",
      "Keep the created issue body to concise summary/context. The approved specification and implementation plan should be published as managed issue comments after the GitHub issue exists.",
      "An issue is estimate-ready only after it has a managed `<!-- prs:issue-plan -->` comment. Keep the companion source-of-truth specification in a managed `<!-- prs:issue-spec -->` comment.",
      "`prs audit publish` comments are audit trail comments; do not treat them as a substitute for publishing or confirming the marker-based managed issue comments needed by `prs issue estimate <number>`.",
      "After draft artifacts exist, stop and ask the user to approve them before creating the GitHub issue or linked issue set in GitHub.",
      "Immediately before writing create-run token usage, call `get_goal` again when goal tools are available and map exposed usage fields into `codex-token-usage.json`: use `tokensUsed` or `usage.totalTokens` for total tokens, `timeUsedSeconds` or `usage.timeUsedSeconds` for elapsed time, the goal `threadId` as `sessionId` or `goal.threadId` when exposed, and an ISO `capturedAt`. The publisher will enrich the current Codex session model from local Codex thread state when `CODEX_THREAD_ID` is available; include the configured planner role profile/model/thinking from `.prs/config.json` as fallback provenance when actual session model metadata is unavailable, for example `premium (gpt-5.5, high thinking)`. Give each entry a stable `id` for the workflow phase plus current run/session, and if one run has multiple Codex goals or sessions, store them as a version 1 `token-usage-ledger` with an `entries` array. Use `status: \"tracked\"` when token totals are present, `status: \"partial\"` when a goal exists but only some fields are exposed, and `status: \"unavailable\"` only when `get_goal` is unavailable, no active goal exists, or the goal exposes no usable usage fields. Do not write an unavailable artifact merely because model metadata is unavailable.",
      "If the user approves and approved Superpowers spec and plan artifact files exist, run `prs tool issue create --draft-file <draft> --spec-file <spec> --plan-file <plan> --run-dir <run-dir> --json` so the deterministic create tool creates the issue and publishes the managed `<!-- prs:issue-spec -->` and `<!-- prs:issue-plan -->` comments in one step.",
      "After the create tool returns created issue numbers, confirm the issue-lifetime token-usage ledger was published as the managed `<!-- prs:token-usage -->` comment; if a run-local artifact still needs publishing, use `prs tool token-usage publish --issue <number> --file <path> --json` before reporting the create workflow complete.",
      "When recording model metadata, prefer the actual active Codex session model when available; configured role/profile metadata is fallback provenance and must not be reported as the actual model.",
      "After the create tool succeeds, trust its `managedComments` result for published marker comments. Do not run `prs issue plan`, `prs issue prepare`, or manual audit publication just to publish an already-approved plan artifact.",
      "If the create result includes `managedCommentHints`, report the remaining marker comments that still need publication before estimating.",
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
      "For `/prs:issue <number> refine`, do not run `prs issue refine <number>` and do not launch a nested Codex/runtime. Handle refinement directly in this Codex session: fetch the GitHub issue body and comments, use Superpowers brainstorming through GitHub issue comments against that thread, inspect nearby repository behavior for knock-on effects, and preserve the original issue body.",
      "If brainstorming is not satisfied, post one normal GitHub issue comment containing all currently blocking high-value questions with the `<!-- prs:issue-refinement-questions -->` marker, then stop. Do not write or publish a partial spec or plan while important questions remain open.",
      "Only once refinement is settled, present the proposed managed `<!-- prs:issue-spec -->` and `<!-- prs:issue-plan -->` comment bodies for approval before publishing or updating them on the same issue. If the user does not approve, keep the artifacts local and stop without posting them. After approval and publication, add the final `<!-- prs:issue-refinement-complete -->` confidence comment, and never create linked issues from this refinement flow.",
      "When a refinement run starts in an active Codex app session and goal tools are available, call `create_goal` with an objective like `Refine PRS issue #<number>: <title>` before refining. If a goal already exists, keep using it and record that fact in the run notes.",
      "For `/prs:issue <number> refine`, record planner token usage under the issue-refine run directory as `codex-token-usage.json` and update the source issue's token-usage ledger when refinement posts questions, publishes managed spec/plan comments, or posts the final confidence comment.",
      `For \`/prs:issue <number>\`, run \`${renderIssueReadyToolCommand()}\` and stop with the next sensible action unless \`--unattended\`, \`--auto\`, or \`--jdi\` is present.`,
      `For \`/prs:issue <number> --unattended\` (aliases: \`--auto\`, \`--jdi\`), run \`${renderIssueReadyToolCommand(true)}\`, then continue into Superpowers worktree creation and issue implementation from the updated base branch.`,
      "After implementation completes, use `/prs finish` discipline to verify, commit, push, and open or update the pull request before entering post-PR orchestration. Do not stop at implementation-only completion when `--unattended`, `--auto`, or `--jdi` was requested.",
      `After \`/prs finish\` opens or updates the pull request, continue immediately with the active issue pipeline: publish issue implementation token usage to the original issue before publishing any PR-lifetime token telemetry, run \`${renderPrReadyToolCommand(true).replace("<number>", "<pr-number>")}\`, run \`${renderPrReviewToolCommand(true).replace("<number>", "<pr-number>")}\`, write the returned report and comments artifacts, publish with \`${renderPrPublishReviewToolCommand(true).replace("<number>", "<pr-number>")}\`, and then continue review-comment, CI, fix, and final-audit stages. Do not treat GitHub Actions \`pr-review\` output as the active Codex review stage.`,
      "After implementation opens or updates a pull request, keep driving the issue lifecycle in this active Codex session: run PR readiness/review, publish or prepare review output according to workflow mode, address actionable review comments, wait for bounded CI/check completion, fix failing CI with the PR fix-tests workflow, and publish final audit/token telemetry before reporting completion.",
      "Use the run-local `.prs/runs/.../issue-orchestration-state.json` file as the resumable stage ledger. If a stage is blocked or skipped, report the recorded stage, summary, and retry command instead of implying the full pipeline finished.",
      "When implementation work starts in an active Codex app session and goal tools are available, call `create_goal` with an objective like `Complete PRS issue #<number>: <title>` before editing code. If a goal already exists, keep using it and record that fact in the run notes.",
      "Keep Codex token usage artifacts under the issue run directory as `codex-token-usage.json`; give each entry a stable `id` for the workflow phase plus current run/session, and if one run has multiple Codex goals or sessions, store them as a version 1 `token-usage-ledger` with an `entries` array. Include the workflow role, profile/tier name, model, thinking level, and source when the active Codex environment, configured role, or operator-provided run notes expose them. Mirror the `prs issue estimate` profile format: `<profile> (<model>, <thinking> thinking)`. Prefer the actual active Codex session model when available; configured role/profile metadata is fallback provenance and must not be reported as the actual model. Use `status: \"tracked\"` when `get_goal` exposes usage, `status: \"partial\"` when only some fields are available, and `status: \"unavailable\"` when the environment cannot expose usage.",
      "Treat Codex goals as telemetry sources, not as the lifecycle authority for audit publication.",
      "For interactive issue selection, use `prs tool issue list --actionable --json` as the source of truth and show each returned issue with its number, title, and GitHub URL.",
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
      "For interactive PR selection, use `prs tool pr list --actionable --json` as the source of truth and show each returned pull request with its number, title, and GitHub URL.",
      `For \`/prs:pr <number>\`, run \`${renderPrReadyToolCommand()}\`; prepare the actual PR head branch in the current repository checkout used by the user's local runtime, fetch and merge the latest PR base branch, summarize \`prContext\` GitHub signals, including grouped \`commentSummary\` entries with source links when available, and stop once the app is ready to browse or a blocker is clear.`,
      `For \`/prs:pr <number> --unattended\` (aliases: \`--auto\`, \`--jdi\`), run \`${renderPrReadyToolCommand(true)}\`; take all sensible readiness steps but do not push, review, fix, approve, merge, switch into an existing PR worktree, or run broad local verification.`,
      `For \`/prs:pr <number> review\`, run \`${renderPrReviewToolCommand()}\`; read the returned \`promptFilePath\` and \`contextFilePath\`, inspect the prepared checkout in this active Codex session, write the final report to the returned \`reportFilePath\`, write inline review candidates to the returned \`commentsFilePath\`, present a concise approval summary, and run \`${renderPrPublishReviewToolCommand()}\` only after the user approves posting to GitHub. Do not edit code, commit, push, resolve comments, or post directly to GitHub outside the approved publish tool.`,
      `For \`/prs:pr <number> review --unattended\` (aliases: \`--auto\`, \`--jdi\`), run \`${renderPrReviewToolCommand(true)}\`; write the report and inline review candidates, then publish with \`${renderPrPublishReviewToolCommand(true)}\`. This unattended GitHub-visible output must keep visible automation framing.`,
      "When a PR tool result or metadata includes `tokenUsage`, write the Codex usage snapshot to the returned `artifactFile` as `codex-token-usage.json` when active session usage is available, give each entry a stable `id` for the workflow phase plus current run/session, preserve the workflow name/role and PR target, and publish it with `prs tool token-usage publish --pr <number> --file <path> --json` at the listed publication point. If one run has multiple Codex goals or sessions, store them as a version 1 `token-usage-ledger` with an `entries` array. If usage or model metadata is unavailable, record `partial` or `unavailable` telemetry without blocking PR readiness, review publication, fixes, commits, or guarded pushes.",
      `For \`/prs:pr <number> prepare-review\`, run \`${renderPrPrepareReviewToolCommand()}\`; keep the prepared branch checked out in the current repository, read the returned \`snapshotFilePath\` when useful, then continue review in this Codex session. The deterministic tool does not generate \`review-brief.md\`; do not look for one unless a separate command created it.`,
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
      "Before publishing the final audit, call `get_goal` when goal tools are available, capture the workflow role plus estimate-style profile/model/thinking tuple such as `standard (gpt-5.4-mini, medium thinking)` or `premium (gpt-5.5, high thinking)` when the Codex environment or configured role exposes it, and write the latest Codex usage snapshot to the issue run directory as `codex-token-usage.json` with a stable entry `id` for the workflow phase plus current run/session. If one run has multiple Codex goals or sessions, store them as a version 1 `token-usage-ledger` with an `entries` array. Prefer the actual active Codex session model when available; configured role/profile metadata is fallback provenance and must not be reported as the actual model. If usage or model metadata is unavailable, record that status or note instead of blocking completion. Treat Codex goals as telemetry sources, not as the lifecycle authority for audit publication.",
      "Publish final verification, PR state, and token-usage notes to the original issue with `prs audit publish --issue <number> --file <path> --section <name>`; when `codex-token-usage.json` exists beside the audit artifact, the audit publisher also updates the managed `token-usage` ledger.",
      "Publish the final issue audit before marking any Codex goal complete or reporting the managed skill run complete.",
      "When finishing issue work, publish implementation token usage to the original issue ledger before publishing any PR-lifetime token telemetry.",
      "If `/prs finish` is being used inside `/prs issue <number> --jdi`, return to that issue pipeline after the pull request exists instead of stopping at the handoff.",
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
