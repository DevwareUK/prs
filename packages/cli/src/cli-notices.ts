import { getCliArgs } from "./cli-context";
import { inspectManagedCodexSkills } from "./codex-skills";
import {
parseIssueCommandArgs,
parseIssueNumber
} from "./commands/issue";
import { parsePrCommandArgs } from "./commands/pr";
import {
formatLaunchStageNotice,
type LaunchStageNoticeId,
} from "./launch-stage";
import {
logManagedCodexSkillsRefreshResult,
parseSetupCommandArgs,
refreshManagedCodexSkills,
resolveCurrentCliFallbackCommand
} from "./setup";

export { parseAuditCommandArgs } from "./commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "./commands/backlog";
export { parseIssueCommandArgs } from "./commands/issue";
export { parseReviewCommandArgs } from "./commands/review";
export { parseSetupCommandArgs };

export const TOP_LEVEL_HELP = [
  "prs",
  "",
  "GitHub-first AI workflows for pull request review, follow-up fixes, and backlog discovery.",
  "",
  "Start here:",
  "  prs review",
  "  prs tool pr review <pr-number> --json",
  "  prs tool pr address-comments <pr-number> --json",
  "  prs tool pr fix-tests <pr-number> --json",
  "  prs tool pr add-tests <pr-number> --json",
  "  prs review tests [--top <count>]",
  "",
  "Advanced:",
  "  prs issue draft --draft-file <path> [--media-manifest <path>]",
  "  prs issue refine <number>",
  "  prs issue plan <number> [--refresh]",
  "  prs issue estimate <number>",
  "  prs issue <number> [--unattended|--auto|--jdi|--mode <interactive|unattended>]",
  "",
  "Beta:",
  "  prs issue <number> <number> [...number] [--unattended|--auto|--jdi]",
  "  prs pr resolve-conflicts <pr-number>",
  "  prs review features [repo-path]",
  "",
  "Compatibility aliases:",
  "  prs pr address-comments <pr-number>",
  "  prs pr fix-tests <pr-number>",
  "  prs pr add-tests <pr-number>",
  "",
  "Supporting commands:",
  "  prs setup",
  "  prs setup --update-skills",
  "  prs update skills",
  "  prs tool issue list [--actionable] --json",
  "  prs tool issue ready <issue-number> [--unattended|--auto|--jdi] --json",
  "  prs tool issue create (--draft-file <path>|--issue-set <path>) --json [--spec-file <path>] [--plan-file <path>] [--media-manifest <path>]",
  "  prs tool pr list [--actionable] --json",
  "  prs tool pr ready <pr-number> [--unattended|--auto|--jdi] --json",
  "  prs tool pr review <pr-number> --json",
  "  prs tool pr publish-review <pr-number> --report <path> --comments <path> --json",
  "  prs tool pr prepare-review <pr-number> --json",
  "  prs tool pr push-reviewed <pr-number> --json",
  "  prs tool pr address-comments <pr-number> [--selection <value>] --json",
  "  prs tool pr fix-tests <pr-number> --json",
  "  prs tool pr add-tests <pr-number> [--selection <value>] --json",
  "  prs tool worktrees cleanup [--apply] --json",
  "  prs test-backlog [--top <count>]",
  "  prs feature-backlog [repo-path]",
  "  prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name> [--local-run <path>] [--media-manifest <path>]",
  "  prs commit",
  "  prs diff",
  "",
  "GitHub-only by design: forge-backed issue and pull request workflows currently target GitHub repositories.",
].join("\n");

export const UPDATE_USAGE = ["Usage:", "  prs update skills"].join("\n");

export function warnIfManagedCodexSkillsAreStale(command: string): void {
  if (command === "setup" || command === "update") {
    return;
  }

  try {
    const staleSkills = inspectManagedCodexSkills(undefined, undefined, {
      cliFallbackCommand: resolveCurrentCliFallbackCommand(),
    }).filter((status) => status.status === "stale");

    if (staleSkills.length === 0) {
      return;
    }

    const names = staleSkills
      .slice(0, 3)
      .map((status) => status.skillName)
      .join(", ");
    const suffix = staleSkills.length > 3 ? `, and ${staleSkills.length - 3} more` : "";
    console.error(
      `prs Codex skills look stale (${names}${suffix}). Run \`prs update skills\` to refresh them.`
    );
  } catch {
    // Skill freshness should never block the requested command.
  }
}

export function parseUpdateCommandArgs(args: string[]): { action: "skills" } {
  const updateArgs = args[0] === "update" ? args.slice(1) : args;
  if (updateArgs.length === 1 && updateArgs[0] === "skills") {
    return { action: "skills" };
  }

  throw new Error(UPDATE_USAGE);
}

export function resolveLaunchStageNoticeId(args: string[]): LaunchStageNoticeId | undefined {
  const command = args[0] ?? "commit";

  if (command === "feature-backlog") {
    return "feature-backlog";
  }

  if (command === "review" && args[1] === "features") {
    return "feature-backlog";
  }

  if (command === "issue") {
    const issueCommand = parseIssueCommandArgs(args);

    switch (issueCommand.action) {
      case "batch":
        return "issue-batch";
      case "draft":
        return "issue-draft";
      case "finalize":
        return "issue-finalize";
      case "estimate":
        return undefined;
      case "plan":
        return "issue-plan";
      case "prepare":
        return "issue-prepare";
      case "run":
        return "issue-run";
    }
  }

  if (command === "pr") {
    const prCommand = parsePrCommandArgs(args, parseIssueNumber);
    if (prCommand.action === "resolve-conflicts") {
      return "pr-resolve-conflicts";
    }
    return undefined;
  }

  return undefined;
}

export function emitLaunchStageNotice(args: string[]): void {
  const noticeId = resolveLaunchStageNoticeId(args);
  if (!noticeId) {
    return;
  }

  process.stdout.write(`${formatLaunchStageNotice(noticeId)}\n`);
}

export async function runUpdateCommand(): Promise<void> {
  const command = parseUpdateCommandArgs(getCliArgs());
  if (command.action === "skills") {
    logManagedCodexSkillsRefreshResult(refreshManagedCodexSkills());
  }
}
