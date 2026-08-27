import {
  installAgentSkills,
  type InstallAgentSkillsResult,
  type InstallableAgentHost,
} from "../agent-skills-installer";

const USAGE = "Usage: prs skills install <codex|claude-code> [--json]";

export type SkillsCommand = {
  action: "install";
  host: InstallableAgentHost;
  json: boolean;
};

export function parseSkillsCommandArgs(args: string[]): SkillsCommand {
  const commandArgs = args[0] === "skills" ? args.slice(1) : args;
  const [action, host, ...flags] = commandArgs;
  if (
    action !== "install" ||
    (host !== "codex" && host !== "claude-code") ||
    flags.some((flag) => flag !== "--json") ||
    flags.filter((flag) => flag === "--json").length > 1
  ) {
    throw new Error(USAGE);
  }
  return { action: "install", host, json: flags.includes("--json") };
}

export function runSkillsCommand(args: string[]): InstallAgentSkillsResult {
  const command = parseSkillsCommandArgs(args);
  const result = installAgentSkills({ host: command.host });
  if (command.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Installed ${result.installed.length}, updated ${result.updated.length}, unchanged ${result.unchanged.length}, skipped ${result.skipped.length} skill files in ${result.targetRoot}.\n`
    );
    if (result.retiredLegacy.length > 0) {
      process.stdout.write(`Retired ${result.retiredLegacy.length} managed legacy Codex skill files.\n`);
    }
  }
  return result;
}
