import {
  installAgentSkills,
  type InstallAgentSkillsResult,
  type InstallableAgentHost,
} from "../agent-skills-installer";
import { validateAgentSkillParity } from "../agent-parity";
import { assertTelemetrySelection, selectedSkillHosts, SKILL_HOSTS, telemetryAction, type CopilotTelemetryAction, type SkillSelection } from "../skill-install-options";
import { promptForLine } from "../cli-prompts";
import { offerCopilotTelemetry } from "../copilot-telemetry-flow";
import type { CopilotTelemetryOptions } from "../copilot-app-telemetry";

const USAGE = [
  "Usage: prs skills install <codex|claude-code|copilot|all> [--json] [--copilot-telemetry <enable|disable|skip>]",
  "       prs skills validate [--json]",
].join("\n");

export type SkillsCommand =
  | { action: "install"; host: SkillSelection; json: boolean; copilotTelemetry?: CopilotTelemetryAction }
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
  if (action !== "install" || (!SKILL_HOSTS.includes(host as InstallableAgentHost) && host !== "all")) throw new Error(USAGE);
  let json = false, copilotTelemetry: CopilotTelemetryAction | undefined;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === "--json" && !json) json = true;
    else if ((flags[i] === "--copilot-telemetry" || flags[i].startsWith("--copilot-telemetry=")) && !copilotTelemetry) {
      copilotTelemetry = telemetryAction(flags[i].includes("=") ? flags[i].slice(flags[i].indexOf("=") + 1) : flags[++i]);
    } else throw new Error(USAGE);
  }
  assertTelemetrySelection(host, copilotTelemetry);
  return { action: "install", host: host as SkillSelection, json, ...(copilotTelemetry ? { copilotTelemetry } : {}) };
}

export async function runSkillsCommand(args: string[], options: {
  interactive?: boolean; promptForLine?: (prompt: string) => Promise<string>;
  installSkills?: (host: InstallableAgentHost) => InstallAgentSkillsResult;
  telemetryOptions?: CopilotTelemetryOptions;
} = {}) {
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
  const hosts = selectedSkillHosts(command.host);
  const results = hosts.map(host => (options.installSkills ?? (host => installAgentSkills({ host })))(host));
  const copilotTelemetry = hosts.includes("copilot") ? await offerCopilotTelemetry({
    action: command.copilotTelemetry, interactive: !command.json && (options.interactive ?? Boolean(process.stdin.isTTY)),
    promptForLine: options.promptForLine ?? promptForLine, options: options.telemetryOptions,
  }) : undefined;
  const result = { ...(command.host === "all" ? { hosts: results } : results[0]), ...(copilotTelemetry ? { copilotTelemetry } : {}) };
  if (command.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    for (const installed of results) {
      process.stdout.write(`${installed.host}: installed ${installed.installed.length}, updated ${installed.updated.length}, unchanged ${installed.unchanged.length}, skipped ${installed.skipped.length} skill files in ${installed.targetRoot}.\n`);
      if (installed.retiredLegacy.length > 0) process.stdout.write(`Retired ${installed.retiredLegacy.length} managed legacy Codex skill files.\n`);
    }
    if (copilotTelemetry) process.stdout.write(copilotTelemetry.message + "\n");
  }
  return result;
}
