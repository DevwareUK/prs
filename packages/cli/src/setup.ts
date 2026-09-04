import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  migrateRepositoryConfigToAgentWorkflow,
  type AgentRepositoryConfigType,
} from "@prs/contracts";
import {
  installAgentSkills,
  type InstallAgentSkillsResult,
  type InstallableAgentHost,
} from "./agent-skills-installer";
import { getRepositoryConfigPath, loadLocalRepositoryConfig, LOCAL_REPOSITORY_CONFIG_RELATIVE_PATH } from "./config";
import { listGitHubAccounts } from "./github-client";
import { assertTelemetrySelection, selectedSkillHosts, telemetryAction, type CopilotTelemetryAction } from "./skill-install-options";
import { offerCopilotTelemetry } from "./copilot-telemetry-flow";
import type { CopilotTelemetryOptions } from "./copilot-app-telemetry";

const SETUP_USAGE = "Usage: prs setup [--skills <none|codex|claude-code|copilot|all>] [--copilot-telemetry <enable|disable|skip>]";
const SETUP_SKILL_SELECTIONS = ["none", "codex", "claude-code", "copilot", "all"] as const;
type SetupSkillSelection = (typeof SETUP_SKILL_SELECTIONS)[number];

export type SetupCommandOptions = { skills?: SetupSkillSelection; copilotTelemetry?: CopilotTelemetryAction };

export function parseSetupCommandArgs(args: string[]): SetupCommandOptions {
  const optionArgs = args[0] === "setup" ? args.slice(1) : args;
  const result: SetupCommandOptions = {};
  for (let i = 0; i < optionArgs.length; i++) {
    const arg = optionArgs[i], equals = arg.indexOf("="), name = equals < 0 ? arg : arg.slice(0, equals);
    if (!["--skills", "--copilot-telemetry"].includes(name)) throw new Error(`Unknown setup option "${arg}". ${SETUP_USAGE}`);
    const value = equals < 0 ? optionArgs[++i] : arg.slice(equals + 1);
    if (name === "--skills" && !result.skills && SETUP_SKILL_SELECTIONS.includes(value as SetupSkillSelection)) result.skills = value as SetupSkillSelection;
    else if (name === "--copilot-telemetry" && !result.copilotTelemetry) result.copilotTelemetry = telemetryAction(value);
    else throw new Error(SETUP_USAGE);
  }
  if (result.skills) assertTelemetrySelection(result.skills, result.copilotTelemetry);
  return result;
}

function assertGitRepository(repoRoot: string): void {
  try {
    execFileSync("git", ["-C", repoRoot, "rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
    });
  } catch {
    throw new Error("prs setup must run inside a git repository.");
  }
}

function detectBaseBranch(repoRoot: string): string {
  try {
    const remoteHead = execFileSync(
      "git",
      ["-C", repoRoot, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (remoteHead.startsWith("origin/")) return remoteHead.slice("origin/".length);
  } catch {
    // A repository without a configured remote uses the conventional default.
  }
  return "main";
}

function detectBuildCommand(repoRoot: string): string[] {
  if (existsSync(resolve(repoRoot, "pnpm-lock.yaml"))) return ["pnpm", "build"];
  if (existsSync(resolve(repoRoot, "yarn.lock"))) return ["yarn", "build"];
  if (existsSync(resolve(repoRoot, "package-lock.json"))) return ["npm", "run", "build"];
  if (existsSync(resolve(repoRoot, "Makefile"))) return ["make", "test"];
  return ["pnpm", "build"];
}

function loadMigratedConfig(repoRoot: string): {
  config: AgentRepositoryConfigType;
  notices: string[];
} {
  const configPath = getRepositoryConfigPath(repoRoot);
  if (!existsSync(configPath)) return { config: {}, notices: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse .prs/config.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  return migrateRepositoryConfigToAgentWorkflow(parsed);
}

export async function runSetupCommand(options: {
  installSkills?: (host: InstallableAgentHost) => InstallAgentSkillsResult;
  promptForLine(prompt: string): Promise<string>;
  repoRoot: string;
  skills?: SetupSkillSelection;
  copilotTelemetry?: CopilotTelemetryAction;
  telemetryOptions?: CopilotTelemetryOptions;
  interactive?: boolean;
  discoverAccounts?: typeof listGitHubAccounts;
}): Promise<void> {
  assertGitRepository(options.repoRoot);
  const interactive = !options.skills && (options.interactive ?? Boolean(process.stdin.isTTY));
  const promptedSelection = options.skills
    ? options.skills
    : !interactive ? "none" : (await options.promptForLine(
        "Install Agent Skills? [none/codex/claude-code/copilot/all] (none): "
      ))
        .trim()
        .toLowerCase() || "none";
  if (!SETUP_SKILL_SELECTIONS.includes(promptedSelection as SetupSkillSelection)) {
    throw new Error(`Unknown Agent Skills selection "${promptedSelection}". ${SETUP_USAGE}`);
  }
  const skillSelection = promptedSelection as SetupSkillSelection;
  assertTelemetrySelection(skillSelection, options.copilotTelemetry);
  const migration = loadMigratedConfig(options.repoRoot);
  const config: AgentRepositoryConfigType = {
    ...migration.config,
    baseBranch: migration.config.baseBranch ?? detectBaseBranch(options.repoRoot),
    buildCommand: migration.config.buildCommand ?? detectBuildCommand(options.repoRoot),
    forge: migration.config.forge ?? { type: "github" },
  };
  const configPath = getRepositoryConfigPath(options.repoRoot);
  mkdirSync(resolve(options.repoRoot, ".prs"), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const ignorePath = resolve(options.repoRoot, ".prs", ".gitignore");
  const requiredIgnores = ["runs/", "state/", "worktrees/", "config.local.json"];
  const existingIgnores = existsSync(ignorePath)
    ? readFileSync(ignorePath, "utf8").split(/\r?\n/).filter(Boolean)
    : [];
  writeFileSync(ignorePath, `${[...new Set([...existingIgnores, ...requiredIgnores])].join("\n")}\n`, "utf8");

  if (interactive && (config.forge?.type ?? "github") === "github") {
    const local = loadLocalRepositoryConfig(options.repoRoot);
    const current = local.forge?.githubAccount;
    const { accounts, guidance } = (options.discoverAccounts ?? listGitHubAccounts)({ repoRoot: options.repoRoot });
    if (guidance) console.log(guidance);
    if (current && !accounts.includes(current)) {
      console.log(`Saved account "${current}" is unavailable; log in with gh auth login --hostname github.com to use it. Keeping the existing selection unless changed.`);
    }
    if (accounts.length) {
      const choices = ["0: Use the default account", ...accounts.map((account, index) => `${index + 1}: ${account}`)];
      const answer = (await options.promptForLine(`GitHub account for this project:\n${choices.join("\n")}\nSelection (keep ${current ?? "default"}): `)).trim();
      if (answer) {
        const index = /^\d+$/.test(answer) ? Number(answer) : -1;
        if (index < 0 || index > accounts.length) throw new Error("Choose a listed GitHub account number, or rerun setup and press Enter to keep the current selection.");
        const selected = index === 0 ? undefined : accounts[index - 1];
        if (selected || current) {
          const updated = { ...local, forge: { ...local.forge } };
          if (selected) updated.forge.githubAccount = selected;
          else delete updated.forge.githubAccount;
          const localPath = resolve(options.repoRoot, LOCAL_REPOSITORY_CONFIG_RELATIVE_PATH);
          writeFileSync(localPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
          console.log(`Wrote ${localPath}.`);
        }
      }
    }
  }

  console.log(`Wrote ${configPath}.`);
  console.log(`Configured base branch: ${config.baseBranch}.`);
  console.log(`Configured verification command: ${config.buildCommand?.join(" ")}.`);
  console.log(`Configured forge integration: ${config.forge?.type}.`);
  for (const notice of migration.notices) console.log(`Migration: ${notice}`);
  const installSkills = options.installSkills ?? ((host) => installAgentSkills({ host }));
  for (const host of selectedSkillHosts(skillSelection)) {
    const result = installSkills(host);
    console.log(
      `Installed Agent Skills for ${host} in ${result.targetRoot}: ${result.installed.length} new, ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.skipped.length} custom files skipped.`
    );
  }
  if (skillSelection === "copilot" || skillSelection === "all") {
    const telemetry = await offerCopilotTelemetry({ action: options.copilotTelemetry, interactive, promptForLine: options.promptForLine, options: options.telemetryOptions });
    console.log(telemetry.message);
  }
  console.log("Agent reasoning stays in Codex, Claude Code, or GitHub Copilot; prs keeps deterministic local GitHub tooling only.");
}
