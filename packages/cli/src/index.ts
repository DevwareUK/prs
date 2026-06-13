#!/usr/bin/env node

import { generateCommitMessage, generateDiffSummary } from "@prs/core";
import { createProvider, getCliArgs, getDefaultRepoRoot } from "./cli-context";
import { formatCommitMessage, formatDiffSummary } from "./cli-format";
import { readHeadDiff, readStagedDiff } from "./cli-git";
import {
  TOP_LEVEL_HELP,
  emitLaunchStageNotice,
  runUpdateCommand,
  warnIfManagedCodexSkillsAreStale,
} from "./cli-notices";
import { promptForLine } from "./cli-prompts";
import { runAuditCommand } from "./commands/audit-runner";
import {
  runFeatureBacklogCommand,
  runTestBacklogCommand,
} from "./commands/backlog-runner";
import { CODEX_RETIRED_MESSAGE } from "./commands/codex";
import { parseIssueNumber } from "./commands/issue";
import {
  parsePrCommandArgs as parsePrCommandArgsImpl,
  type PrCommandOptions,
} from "./commands/pr";
import { runPrCommand } from "./commands/pr-runner";
import { runReviewCommand } from "./commands/review-runner";
import { runToolCommand } from "./commands/tool-runner";
import {
  logManagedCodexSkillsRefreshResult,
  parseSetupCommandArgs,
  refreshManagedCodexSkills,
  runSetupCommand,
} from "./setup";
import { runIssueCommand } from "./workflows/issue/runner";

export { formatDiffSummary } from "./cli-format";
export {
  readReviewDiff,
  readReviewDiffForAutomation,
} from "./cli-git";
export { parseUpdateCommandArgs } from "./cli-notices";
export { parseAuditCommandArgs } from "./commands/audit";
export {
  parseFeatureBacklogCommandArgs,
  parseTestBacklogCommandArgs,
} from "./commands/backlog";
export { parseCodexCommandArgs as parseCodexCommand } from "./commands/codex";
export { parseIssueCommandArgs } from "./commands/issue";
export { parseReviewCommandArgs } from "./commands/review";
export {
  extractIssuePlanLikelyFiles,
  findOverlappingPullRequests,
  normalizeRepositoryPath,
  recommendIssueBranchBase,
} from "./workflows/issue/publication";
export { parseSetupCommandArgs };

export function parsePrCommandArgs(args: string[]): PrCommandOptions {
  return parsePrCommandArgsImpl(args, parseIssueNumber);
}

const SUPPORTED_COMMANDS = new Set([
  "commit",
  "diff",
  "setup",
  "update",
  "audit",
  "issue",
  "pr",
  "tool",
  "review",
  "test-backlog",
  "feature-backlog",
]);

export async function run(): Promise<void> {
  const args = getCliArgs();
  const firstArg = args[0];

  if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
    process.stdout.write(`${TOP_LEVEL_HELP}\n`);
    return;
  }

  const command = firstArg ?? "commit";
  if (command === "codex") {
    throw new Error(CODEX_RETIRED_MESSAGE);
  }

  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}.\n\n${TOP_LEVEL_HELP}`);
  }

  warnIfManagedCodexSkillsAreStale(command);
  emitLaunchStageNotice(args);

  if (command === "commit") {
    const diff = readStagedDiff();
    const { provider } = await createProvider(undefined, "implementer");
    const result = await generateCommitMessage(provider, diff);
    process.stdout.write(formatCommitMessage(result.title, result.body));
    return;
  }

  if (command === "issue") {
    await runIssueCommand();
    return;
  }

  if (command === "setup") {
    const setupCommand = parseSetupCommandArgs(args);
    if (setupCommand.updateSkills) {
      logManagedCodexSkillsRefreshResult(refreshManagedCodexSkills());
      return;
    }

    await runSetupCommand({
      repoRoot: getDefaultRepoRoot(),
      promptForLine,
    });
    return;
  }

  if (command === "update") {
    await runUpdateCommand();
    return;
  }

  if (command === "audit") {
    await runAuditCommand();
    return;
  }

  if (command === "pr") {
    await runPrCommand();
    return;
  }

  if (command === "tool") {
    await runToolCommand();
    return;
  }

  if (command === "review") {
    await runReviewCommand();
    return;
  }

  if (command === "test-backlog") {
    await runTestBacklogCommand();
    return;
  }

  if (command === "feature-backlog") {
    await runFeatureBacklogCommand();
    return;
  }

  const diff = readHeadDiff();
  const { provider } = await createProvider(undefined, "implementer");
  const result = await generateDiffSummary(provider, { diff });
  process.stdout.write(formatDiffSummary(result));
}

if (process.env.PRS_DISABLE_AUTO_RUN !== "1") {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
