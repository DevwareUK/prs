#!/usr/bin/env node

import { getCliArgs, getDefaultRepoRoot, getRepositoryForge } from "./cli-context";
import { TOP_LEVEL_HELP } from "./cli-notices";
import { promptForLine } from "./cli-prompts";
import { runAuditCommand } from "./commands/audit-runner";
import { parseIssueCommandArgs } from "./commands/issue";
import { runSkillsCommand } from "./commands/skills";
import { runToolCommand } from "./commands/tool-runner";
import { finalizeIssueChanges, formatIssueFinalizePreview } from "./issue-finalize-tool";
import { parseSetupCommandArgs, runSetupCommand } from "./setup";

export { parseAuditCommandArgs } from "./commands/audit";
export { parseIssueCommandArgs } from "./commands/issue";
export { parseSkillsCommandArgs } from "./commands/skills";
export { parsePrsToolCommandArgs } from "./prs-tool-command";
export { parseSetupCommandArgs };

const SUPPORTED_COMMANDS = new Set(["setup", "audit", "issue", "skills", "tool"]);

export async function run(): Promise<void> {
  const args = getCliArgs();
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${TOP_LEVEL_HELP}\n`);
    return;
  }
  if (!SUPPORTED_COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}.\n\n${TOP_LEVEL_HELP}`);
  }
  if (command === "setup") {
    const setup = parseSetupCommandArgs(args);
    await runSetupCommand({ repoRoot: getDefaultRepoRoot(), promptForLine, ...setup });
    return;
  }
  if (command === "audit") {
    await runAuditCommand();
    return;
  }
  if (command === "skills") {
    runSkillsCommand(args);
    return;
  }
  if (command === "tool") {
    await runToolCommand();
    return;
  }

  const issue = parseIssueCommandArgs(args);
  const result = await finalizeIssueChanges({
    repoRoot: getDefaultRepoRoot(),
    issueNumber: issue.issueNumber,
    forge: getRepositoryForge(getDefaultRepoRoot()),
    confirm: async (preview) => {
      process.stdout.write(formatIssueFinalizePreview(preview) + "\n\n");
      const answer = (await promptForLine("Create this commit? [y/N]: ")).trim().toLowerCase();
      return answer === "y" || answer === "yes";
    },
  });
  console.log(result.message);
  if (result.commit) console.log(`Created commit ${result.commit}.`);
}

if (process.env.PRS_DISABLE_AUTO_RUN !== "1") {
  void run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
