export type LaunchStageNoticeId =
  | "feature-backlog"
  | "issue-batch"
  | "issue-draft"
  | "issue-finalize"
  | "issue-plan"
  | "issue-prepare"
  | "issue-run"
  | "pr-prepare-review";

type LaunchStageNoticeDefinition = {
  tier: "advanced" | "beta";
  command: string;
  reason: string;
  recommendedFirst: string;
  constraints: string;
};

const NOTICE_BORDER = "!".repeat(78);

const LAUNCH_STAGE_NOTICE_DEFINITIONS: Record<
  LaunchStageNoticeId,
  LaunchStageNoticeDefinition
> = {
  "feature-backlog": {
    tier: "beta",
    command: "`git-ai feature-backlog`",
    reason:
      "Repository-wide feature discovery is still a higher-variance workflow than the primary review and testing paths.",
    recommendedFirst: "`git-ai test-backlog --top 5` or `git-ai review`.",
    constraints:
      "Scans the repository heuristically, and optional issue creation also needs GitHub access.",
  },
  "issue-batch": {
    tier: "beta",
    command: "`git-ai issue batch ...`",
    reason:
      "It chains unattended issue-to-PR runs and is the most operationally fragile automation path in the CLI today.",
    recommendedFirst:
      "`git-ai review`, `git-ai pr fix-comments <pr-number>`, or a single `git-ai issue <number>` run.",
    constraints:
      'Requires a clean working tree, at least two issue numbers, authenticated GitHub access, and `ai.runtime.type: "codex"`.',
  },
  "issue-draft": {
    tier: "advanced",
    command: "`git-ai issue draft`",
    reason:
      "It depends on interactive runtime judgment and broader repository exploration to turn an idea into an implementation-ready issue.",
    recommendedFirst:
      "`git-ai review`, `git-ai pr fix-comments <pr-number>`, or `git-ai test-backlog --top 5`.",
    constraints:
      "Requires the configured interactive runtime on PATH and writes draft artifacts under `.git-ai/`.",
  },
  "issue-finalize": {
    tier: "advanced",
    command: "`git-ai issue finalize <number>`",
    reason:
      "It assumes you are already in the wider issue automation flow and are ready to review a generated commit proposal.",
    recommendedFirst:
      "`git-ai review` and the PR fix workflows before moving into full issue automation.",
    constraints:
      "Requires an existing issue-run branch with file changes ready for commit review.",
  },
  "issue-plan": {
    tier: "advanced",
    command: "`git-ai issue plan <number>`",
    reason:
      "It prepares issue-plan comments for the wider issue-to-PR automation path rather than the primary review and fix loop.",
    recommendedFirst:
      "`git-ai review` first, then move into issue automation once the team trusts the narrower path.",
    constraints:
      "Requires GitHub issue access plus a working text-provider configuration.",
  },
  "issue-prepare": {
    tier: "advanced",
    command: "`git-ai issue prepare <number>`",
    reason:
      "It stages full issue automation by switching branches and generating run artifacts before code work starts.",
    recommendedFirst:
      "`git-ai review` and the PR fix workflows before preparing a full issue run.",
    constraints:
      "Requires a clean working tree, GitHub issue access, and will check out and pull the configured base branch.",
  },
  "issue-run": {
    tier: "advanced",
    command: "`git-ai issue <number>`",
    reason:
      "It performs full issue-to-PR automation with branch switching, runtime execution, build verification, and optional PR creation.",
    recommendedFirst:
      "`git-ai review`, `git-ai pr fix-comments <pr-number>`, or `git-ai pr fix-tests <pr-number>`.",
    constraints:
      'Requires a clean working tree; interactive runs need the configured runtime, and `--mode unattended` also needs authenticated GitHub access plus `ai.runtime.type: "codex"`.',
  },
  "pr-prepare-review": {
    tier: "beta",
    command: "`git-ai pr prepare-review <pr-number>`",
    reason:
      "It automates reviewer workspace setup, base-branch sync, and a live Codex handoff around a pull request.",
    recommendedFirst:
      "`git-ai review` for the lower-risk review path, then `git-ai pr fix-comments <pr-number>` or `git-ai pr fix-tests <pr-number>` when you want guided local changes.",
    constraints:
      "Requires a clean working tree, GitHub PR access, `codex` on PATH, and may merge the latest base branch into the review workspace.",
  },
};

export function formatLaunchStageNotice(id: LaunchStageNoticeId): string {
  const definition = LAUNCH_STAGE_NOTICE_DEFINITIONS[id];
  const heading =
    definition.tier === "beta"
      ? "BETA WORKFLOW NOTICE"
      : "ADVANCED WORKFLOW NOTICE";

  return [
    NOTICE_BORDER,
    heading,
    definition.command,
    `Why: ${definition.reason}`,
    `Recommended first: ${definition.recommendedFirst}`,
    `Constraints: ${definition.constraints}`,
    NOTICE_BORDER,
  ].join("\n");
}
