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
import { getRepositoryConfigPath } from "./config";

const SETUP_USAGE = "Usage: prs setup [--skills <none|codex|claude-code|copilot|all>]";
const SETUP_SKILL_SELECTIONS = ["none", "codex", "claude-code", "copilot", "all"] as const;
type SetupSkillSelection = (typeof SETUP_SKILL_SELECTIONS)[number];

export type SetupCommandOptions = { skills?: SetupSkillSelection };

export function parseSetupCommandArgs(args: string[]): SetupCommandOptions {
  const optionArgs = args[0] === "setup" ? args.slice(1) : args;
  if (optionArgs.length === 0) return {};
  const equalsValue = optionArgs[0]?.startsWith("--skills=")
    ? optionArgs[0].slice("--skills=".length)
    : undefined;
  const value = equalsValue ?? (optionArgs[0] === "--skills" ? optionArgs[1] : undefined);
  const expectedLength = equalsValue === undefined ? 2 : 1;
  if (
    value &&
    SETUP_SKILL_SELECTIONS.includes(value as SetupSkillSelection) &&
    optionArgs.length === expectedLength
  ) {
    return { skills: value as SetupSkillSelection };
  }
  throw new Error(`Unknown setup option "${optionArgs[0] ?? ""}". ${SETUP_USAGE}`);
}

function selectedHosts(selection: SetupSkillSelection): InstallableAgentHost[] {
  if (selection === "none") return [];
  if (selection === "all") return ["codex", "claude-code", "copilot"];
  return [selection];
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
}): Promise<void> {
  assertGitRepository(options.repoRoot);
  const promptedSelection = options.skills
    ? options.skills
    : (await options.promptForLine(
        "Install Agent Skills? [none/codex/claude-code/copilot/all] (none): "
      ))
        .trim()
        .toLowerCase() || "none";
  if (!SETUP_SKILL_SELECTIONS.includes(promptedSelection as SetupSkillSelection)) {
    throw new Error(`Unknown Agent Skills selection "${promptedSelection}". ${SETUP_USAGE}`);
  }
  const skillSelection = promptedSelection as SetupSkillSelection;
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
  const requiredIgnores = ["runs/", "state/", "worktrees/"];
  const existingIgnores = existsSync(ignorePath)
    ? readFileSync(ignorePath, "utf8").split(/\r?\n/).filter(Boolean)
    : [];
  writeFileSync(ignorePath, `${[...new Set([...existingIgnores, ...requiredIgnores])].join("\n")}\n`, "utf8");

  console.log(`Wrote ${configPath}.`);
  console.log(`Configured base branch: ${config.baseBranch}.`);
  console.log(`Configured verification command: ${config.buildCommand?.join(" ")}.`);
  console.log(`Configured forge integration: ${config.forge?.type}.`);
  for (const notice of migration.notices) console.log(`Migration: ${notice}`);
  const installSkills = options.installSkills ?? ((host) => installAgentSkills({ host }));
  for (const host of selectedHosts(skillSelection)) {
    const result = installSkills(host);
    console.log(
      `Installed Agent Skills for ${host} in ${result.targetRoot}: ${result.installed.length} new, ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.skipped.length} custom files skipped.`
    );
  }
  console.log("Agent reasoning stays in Codex, Claude Code, or GitHub Copilot; prs keeps deterministic local GitHub tooling only.");
}
