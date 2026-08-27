import {
  installAgentSkills,
  type InstallAgentSkillsResult,
  type InstallableAgentHost,
} from "../agent-skills-installer";
import { validateAgentSkillParity, type AgentSkillParityReport } from "../agent-parity";

const USAGE = [
  "Usage: prs skills install <codex|claude-code|copilot> [--json]",
  "       prs skills validate [--json]",
].join("\n");

export type SkillsCommand =
  | { action: "install"; host: InstallableAgentHost; json: boolean }
  | { action: "validate"; json: boolean };

export function parseSkillsCommandArgs(args: string[]): SkillsCommand {
  const commandArgs = args[0] === "skills" ? args.slice(1) : args;
  const [action, host, ...flags] = commandArgs;
  if (
    action === "validate" &&
    (host === undefined || host === "--json") &&
    flags.length === 0
  ) {
    return { action: "validate", json: host === "--json" };
  }
  if (
    action !== "install" ||
    (host !== "codex" && host !== "claude-code" && host !== "copilot") ||
    flags.some((flag) => flag !== "--json") ||
    flags.filter((flag) => flag === "--json").length > 1
  ) {
    throw new Error(USAGE);
  }
  return { action: "install", host, json: flags.includes("--json") };
}

export function runSkillsCommand(args: string[]): InstallAgentSkillsResult | AgentSkillParityReport {
  const command = parseSkillsCommandArgs(args);
  if (command.action === "validate") {
    const report = validateAgentSkillParity();
    if (command.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      for (const host of report.hosts) {
        process.stdout.write(`${host.host}: ${host.status} (${host.inventory.length} skills)\n`);
      }
      process.stdout.write(`Agent Skills parity: ${report.status}. Evidence: ${report.temporaryRoot}\n`);
    }
    if (report.status === "failed") process.exitCode = 1;
    return report;
  }
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
