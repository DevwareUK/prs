import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { RepositoryConfigType } from "@git-ai/contracts";
import {
  DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
  DEFAULT_REPOSITORY_BASE_BRANCH,
  DEFAULT_REPOSITORY_BUILD_COMMAND,
} from "@git-ai/core";
import {
  formatCommandForDisplay,
  getRepositoryConfigPath,
  loadRepositoryConfig,
} from "./config";

const SETUP_USAGE = ["Usage:", "  git-ai setup"].join("\n");
const AGENTS_SECTION_START = "<!-- git-ai:setup:start -->";
const AGENTS_SECTION_END = "<!-- git-ai:setup:end -->";

type ForgeType = "github" | "none";

type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
  workspaces?: unknown;
};

type ComposerJson = {
  scripts?: Record<string, unknown>;
};

type RepositoryInspection = {
  summary: string;
  signals: string[];
  suggestedBaseBranch: string;
  suggestedBuildCommand: string[];
  suggestedBuildCommandSource: string;
  suggestedExcludePaths: string[];
  suggestedForgeType: ForgeType;
  stackLabel: string;
  hasGitHubWorkflows: boolean;
};

type SetupAnswers = {
  baseBranch: string;
  buildCommand: string[];
  excludePaths: string[];
  forgeType: ForgeType;
  updateAgents: boolean;
};

function readJsonFile<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function fileExists(repoRoot: string, relativePath: string): boolean {
  return existsSync(resolve(repoRoot, relativePath));
}

function directoryExists(repoRoot: string, relativePath: string): boolean {
  const path = resolve(repoRoot, relativePath);
  if (!existsSync(path)) {
    return false;
  }

  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listDirectoryEntries(repoRoot: string, relativePath: string): string[] {
  try {
    return readdirSync(resolve(repoRoot, relativePath));
  } catch {
    return [];
  }
}

function detectPackageManager(repoRoot: string, packageJson?: PackageJson): "pnpm" | "yarn" | "npm" {
  const packageManager = packageJson?.packageManager?.trim();
  if (packageManager?.startsWith("pnpm@") || fileExists(repoRoot, "pnpm-lock.yaml")) {
    return "pnpm";
  }

  if (packageManager?.startsWith("yarn@") || fileExists(repoRoot, "yarn.lock")) {
    return "yarn";
  }

  return "npm";
}

function commandForScript(packageManager: "pnpm" | "yarn" | "npm", scriptName: string): string[] {
  if (packageManager === "yarn") {
    return ["yarn", scriptName];
  }

  if (packageManager === "pnpm" && (scriptName === "build" || scriptName === "test")) {
    return ["pnpm", scriptName];
  }

  if (scriptName === "test") {
    return ["npm", "test"];
  }

  return ["npm", "run", scriptName];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseOriginDefaultBranch(rawValue: string): string | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed.split("/");
  return parts[parts.length - 1] || undefined;
}

function tryGitCommand(repoRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
}

function detectBaseBranch(repoRoot: string, existingConfig?: RepositoryConfigType): string {
  if (existingConfig?.baseBranch) {
    return existingConfig.baseBranch;
  }

  const originHead = tryGitCommand(repoRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  const originBranch = originHead ? parseOriginDefaultBranch(originHead) : undefined;
  if (originBranch) {
    return originBranch;
  }

  const currentBranch = tryGitCommand(repoRoot, ["branch", "--show-current"]);
  if (currentBranch) {
    return currentBranch;
  }

  return DEFAULT_REPOSITORY_BASE_BRANCH;
}

function detectForgeType(repoRoot: string, existingConfig?: RepositoryConfigType): ForgeType {
  const existingType = existingConfig?.forge?.type;
  if (existingType === "github" || existingType === "none") {
    return existingType;
  }

  const remoteUrl = tryGitCommand(repoRoot, ["remote", "get-url", "origin"]);
  if (remoteUrl && /github\.com[:/]/i.test(remoteUrl)) {
    return "github";
  }

  if (directoryExists(repoRoot, ".github")) {
    return "github";
  }

  return "none";
}

function detectRepositoryShape(repoRoot: string, packageJson?: PackageJson, composerJson?: ComposerJson) {
  const hasPackageJson = packageJson !== undefined;
  const hasComposerJson = composerJson !== undefined;
  const hasTypeScript = fileExists(repoRoot, "tsconfig.json");
  const hasPnpmWorkspace = fileExists(repoRoot, "pnpm-workspace.yaml");
  const packageDirs = ["packages", "apps", "services", "actions"].filter((dir) =>
    directoryExists(repoRoot, dir)
  );
  const workspaceCount = packageDirs.reduce((count, dir) => {
    return (
      count +
      listDirectoryEntries(repoRoot, dir).filter((entry) =>
        fileExists(repoRoot, `${dir}/${entry}/package.json`)
      ).length
    );
  }, 0);
  const isMonorepo =
    hasPnpmWorkspace ||
    (Array.isArray(packageJson?.workspaces) && packageJson.workspaces.length > 0) ||
    workspaceCount > 1;
  const hasDrupal =
    hasComposerJson &&
    [
      "web/core",
      "docroot/core",
      "web/modules",
      "docroot/modules",
      "web/themes",
      "docroot/themes",
    ].some((path) => directoryExists(repoRoot, path));
  const hasGitHubWorkflows = directoryExists(repoRoot, ".github/workflows");

  let stackLabel = "repository";
  if (hasPackageJson && hasComposerJson && hasDrupal) {
    stackLabel = "mixed Node.js + Drupal/PHP repository";
  } else if (hasPackageJson && hasComposerJson) {
    stackLabel = "mixed Node.js + PHP repository";
  } else if (hasDrupal) {
    stackLabel = "Drupal/PHP repository";
  } else if (hasPackageJson && hasTypeScript && isMonorepo) {
    stackLabel = "TypeScript monorepo";
  } else if (hasPackageJson && hasTypeScript) {
    stackLabel = "TypeScript repository";
  } else if (hasPackageJson && isMonorepo) {
    stackLabel = "Node.js monorepo";
  } else if (hasPackageJson) {
    stackLabel = "Node.js repository";
  } else if (hasComposerJson) {
    stackLabel = "PHP repository";
  }

  return {
    hasComposerJson,
    hasDrupal,
    hasGitHubWorkflows,
    hasPackageJson,
    hasTypeScript,
    isMonorepo,
    stackLabel,
  };
}

function detectBuildCommand(
  repoRoot: string,
  existingConfig: RepositoryConfigType | undefined,
  packageJson: PackageJson | undefined,
  composerJson: ComposerJson | undefined
): { command: string[]; source: string } {
  if (existingConfig?.buildCommand) {
    return {
      command: existingConfig.buildCommand,
      source: "existing .git-ai/config.json",
    };
  }

  const packageManager = detectPackageManager(repoRoot, packageJson);
  const scripts = packageJson?.scripts ?? {};
  for (const scriptName of ["verify", "build", "test"]) {
    if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim().length > 0) {
      return {
        command: commandForScript(packageManager, scriptName),
        source: `package.json script "${scriptName}"`,
      };
    }
  }

  const composerScripts = composerJson?.scripts ?? {};
  for (const scriptName of ["verify", "build", "test"]) {
    if (composerScripts[scriptName] !== undefined) {
      return {
        command: ["composer", scriptName],
        source: `composer.json script "${scriptName}"`,
      };
    }
  }

  if (fileExists(repoRoot, "vendor/bin/phpunit")) {
    return {
      command: ["vendor/bin/phpunit"],
      source: "vendor/bin/phpunit",
    };
  }

  if (fileExists(repoRoot, "phpunit.xml") || fileExists(repoRoot, "phpunit.xml.dist")) {
    return {
      command: ["phpunit"],
      source: "phpunit.xml",
    };
  }

  return {
    command: [...DEFAULT_REPOSITORY_BUILD_COMMAND],
    source: "git-ai default",
  };
}

function detectSuggestedExcludePaths(
  repoRoot: string,
  existingConfig: RepositoryConfigType | undefined
): string[] {
  const suggestions: string[] = [];
  const defaultExcludePaths = [...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS];

  const optionalGeneratedPaths = [
    { exists: directoryExists(repoRoot, "coverage"), pattern: "**/coverage/**" },
    { exists: directoryExists(repoRoot, ".next"), pattern: "**/.next/**" },
    { exists: directoryExists(repoRoot, ".nuxt"), pattern: "**/.nuxt/**" },
    { exists: directoryExists(repoRoot, ".svelte-kit"), pattern: "**/.svelte-kit/**" },
    { exists: directoryExists(repoRoot, ".turbo"), pattern: "**/.turbo/**" },
    { exists: directoryExists(repoRoot, "storybook-static"), pattern: "**/storybook-static/**" },
    { exists: directoryExists(repoRoot, ".cache"), pattern: "**/.cache/**" },
    { exists: directoryExists(repoRoot, "public/build"), pattern: "public/build/**" },
    { exists: directoryExists(repoRoot, "generated"), pattern: "**/generated/**" },
    {
      exists: directoryExists(repoRoot, "web/sites/default/files"),
      pattern: "web/sites/default/files/**",
    },
    {
      exists: directoryExists(repoRoot, "docroot/sites/default/files"),
      pattern: "docroot/sites/default/files/**",
    },
    {
      exists: directoryExists(repoRoot, "web/themes"),
      pattern: "web/themes/**/css/**",
    },
    {
      exists: directoryExists(repoRoot, "web/themes"),
      pattern: "web/themes/**/js/**",
    },
    {
      exists: directoryExists(repoRoot, "docroot/themes"),
      pattern: "docroot/themes/**/css/**",
    },
    {
      exists: directoryExists(repoRoot, "docroot/themes"),
      pattern: "docroot/themes/**/js/**",
    },
  ];

  for (const suggestion of optionalGeneratedPaths) {
    if (suggestion.exists) {
      suggestions.push(suggestion.pattern);
    }
  }

  return uniqueStrings([
    ...(existingConfig?.aiContext?.excludePaths ?? []),
    ...suggestions.filter(
      (pattern) => !defaultExcludePaths.some((defaultPattern) => defaultPattern === pattern)
    ),
  ]);
}

function inspectRepository(
  repoRoot: string,
  existingConfig: RepositoryConfigType | undefined
): RepositoryInspection {
  const packageJson = readJsonFile<PackageJson>(resolve(repoRoot, "package.json"));
  const composerJson = readJsonFile<ComposerJson>(resolve(repoRoot, "composer.json"));
  const shape = detectRepositoryShape(repoRoot, packageJson, composerJson);
  const buildCommand = detectBuildCommand(repoRoot, existingConfig, packageJson, composerJson);

  const signals = [shape.stackLabel];
  if (shape.isMonorepo) {
    signals.push("workspace layout detected");
  }
  if (shape.hasGitHubWorkflows) {
    signals.push("GitHub Actions workflows detected");
  }
  if (shape.hasDrupal) {
    signals.push("Drupal-style web/ or docroot/ structure detected");
  }
  if (shape.hasTypeScript) {
    signals.push("TypeScript config detected");
  }

  return {
    summary: `Detected ${shape.stackLabel}.`,
    signals,
    suggestedBaseBranch: detectBaseBranch(repoRoot, existingConfig),
    suggestedBuildCommand: buildCommand.command,
    suggestedBuildCommandSource: buildCommand.source,
    suggestedExcludePaths: detectSuggestedExcludePaths(repoRoot, existingConfig),
    suggestedForgeType: detectForgeType(repoRoot, existingConfig),
    stackLabel: shape.stackLabel,
    hasGitHubWorkflows: shape.hasGitHubWorkflows,
  };
}

function renderList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function parseCommandString(value: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        segments.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaped) {
    current += "\\";
  }

  if (quote) {
    throw new Error("Command contains an unmatched quote.");
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

function parseExcludePathList(value: string): string[] {
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "none") {
    return [];
  }

  return uniqueStrings(normalized.split(","));
}

function renderDefaultValue(value: string): string {
  return value ? ` [${value}]` : "";
}

async function promptWithDefault(
  promptForLine: (prompt: string) => Promise<string>,
  prompt: string,
  defaultValue: string
): Promise<string> {
  const response = (await promptForLine(`${prompt}${renderDefaultValue(defaultValue)}: `)).trim();
  return response || defaultValue;
}

async function promptChoice<T extends string>(
  promptForLine: (prompt: string) => Promise<string>,
  prompt: string,
  choices: readonly T[],
  defaultValue: T
): Promise<T> {
  while (true) {
    const rawValue = (
      await promptForLine(`${prompt}${renderDefaultValue(defaultValue)}: `)
    )
      .trim()
      .toLowerCase();
    const value = (rawValue || defaultValue) as T;
    if (choices.includes(value)) {
      return value;
    }

    console.log(`Choose one of: ${choices.join(", ")}.`);
  }
}

async function promptCommand(
  promptForLine: (prompt: string) => Promise<string>,
  defaultCommand: string[]
): Promise<string[]> {
  while (true) {
    const response = await promptForLine(
      `Verification/build command${renderDefaultValue(
        formatCommandForDisplay(defaultCommand)
      )}: `
    );
    const normalized = response.trim();
    if (!normalized) {
      return defaultCommand;
    }

    try {
      const command = parseCommandString(normalized);
      if (command.length > 0) {
        return command;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(message);
      continue;
    }

    console.log("Enter a command like `pnpm build` or `composer test`.");
  }
}

async function promptExcludePaths(
  promptForLine: (prompt: string) => Promise<string>,
  defaultValue: string[]
): Promise<string[]> {
  while (true) {
    const response = await promptForLine(
      `Additional AI context exclusions beyond git-ai defaults${renderDefaultValue(
        renderList(defaultValue)
      )}: `
    );

    try {
      return response.trim() ? parseExcludePathList(response) : defaultValue;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(message);
    }
  }
}

async function promptYesNo(
  promptForLine: (prompt: string) => Promise<string>,
  prompt: string,
  defaultValue: boolean
): Promise<boolean> {
  while (true) {
    const suffix = defaultValue ? " [Y/n]" : " [y/N]";
    const response = (await promptForLine(`${prompt}${suffix}: `)).trim().toLowerCase();
    if (!response) {
      return defaultValue;
    }

    if (response === "y" || response === "yes") {
      return true;
    }

    if (response === "n" || response === "no") {
      return false;
    }

    console.log("Answer with yes or no.");
  }
}

function ensureGitAiIgnored(repoRoot: string): boolean {
  const gitignorePath = resolve(repoRoot, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());

  if (lines.includes(".git-ai") || lines.includes(".git-ai/")) {
    return false;
  }

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, `${existing}${prefix}.git-ai/\n`, "utf8");
  return true;
}

function buildRepositoryConfig(answers: SetupAnswers): RepositoryConfigType {
  const config: RepositoryConfigType = {
    baseBranch: answers.baseBranch,
    buildCommand: answers.buildCommand,
    forge: {
      type: answers.forgeType,
    },
  };

  if (answers.excludePaths.length > 0) {
    config.aiContext = {
      excludePaths: answers.excludePaths,
    };
  }

  return config;
}

function writeRepositoryConfig(repoRoot: string, config: RepositoryConfigType): void {
  const configPath = getRepositoryConfigPath(repoRoot);
  mkdirSync(resolve(repoRoot, ".git-ai"), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function renderAgentsSection(
  inspection: RepositoryInspection,
  answers: SetupAnswers
): string {
  const lines = [
    AGENTS_SECTION_START,
    "## git-ai repository guidance",
    "",
    `- Detected stack: ${inspection.stackLabel}.`,
    `- Default branch for issue and PR flows: \`${answers.baseBranch}\`.`,
    `- Verification command after Codex work: \`${formatCommandForDisplay(answers.buildCommand)}\`.`,
    `- Forge integration: \`${answers.forgeType}\`.`,
  ];

  if (answers.excludePaths.length > 0) {
    lines.push(
      `- Prefer source files over generated output covered by AI context exclusions: ${answers.excludePaths
        .map((pattern) => `\`${pattern}\``)
        .join(", ")}.`
    );
  } else {
    lines.push(
      "- Repository-specific AI context exclusions were not added; git-ai default generated-path exclusions still apply."
    );
  }

  if (inspection.hasGitHubWorkflows) {
    lines.push("- GitHub workflows are present, so keep command choices aligned with automation.");
  }

  lines.push(
    "- Add any deployment, environment, or directory-specific caveats below this managed section as plain repository guidance.",
    AGENTS_SECTION_END,
    ""
  );

  return lines.join("\n");
}

function upsertAgentsSection(repoRoot: string, section: string): void {
  const agentsPath = resolve(repoRoot, "AGENTS.md");
  const existing = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
  const markerPattern = new RegExp(
    `${AGENTS_SECTION_START}[\\s\\S]*?${AGENTS_SECTION_END}\\n?`,
    "m"
  );
  const nextContent = markerPattern.test(existing)
    ? existing.replace(markerPattern, section)
    : existing.trim().length > 0
      ? `${existing.replace(/\s*$/, "\n\n")}${section}`
      : section;

  writeFileSync(agentsPath, nextContent, "utf8");
}

function ensureGitRepository(repoRoot: string): void {
  const actualRepoRoot = tryGitCommand(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (!actualRepoRoot) {
    throw new Error("git-ai setup must be run inside a Git repository.");
  }
}

function logInspection(repoRoot: string, inspection: RepositoryInspection): void {
  console.log(`Repository root: ${repoRoot}`);
  console.log(inspection.summary);
  console.log(`Signals: ${inspection.signals.join("; ")}`);
  console.log(
    `Suggested verification command: ${formatCommandForDisplay(
      inspection.suggestedBuildCommand
    )} (${inspection.suggestedBuildCommandSource})`
  );
  console.log(
    `Suggested extra AI context exclusions: ${renderList(inspection.suggestedExcludePaths)}`
  );
  console.log("");
}

async function collectSetupAnswers(
  promptForLine: (prompt: string) => Promise<string>,
  inspection: RepositoryInspection,
  agentsFileExists: boolean
): Promise<SetupAnswers> {
  const baseBranch = await promptWithDefault(
    promptForLine,
    "Default branch",
    inspection.suggestedBaseBranch
  );
  const forgeType = await promptChoice(promptForLine, "Forge integration", ["github", "none"], inspection.suggestedForgeType);
  const buildCommand = await promptCommand(promptForLine, inspection.suggestedBuildCommand);
  const excludePaths = await promptExcludePaths(
    promptForLine,
    inspection.suggestedExcludePaths
  );
  const updateAgents = await promptYesNo(
    promptForLine,
    agentsFileExists ? "Update the managed AGENTS.md section" : "Create AGENTS.md guidance",
    true
  );

  return {
    baseBranch,
    buildCommand,
    excludePaths,
    forgeType,
    updateAgents,
  };
}

export function parseSetupCommandArgs(args: string[]): void {
  if (args.length > 1) {
    throw new Error(`Unknown setup option "${args[1]}". ${SETUP_USAGE}`);
  }
}

export async function runSetupCommand(options: {
  promptForLine(prompt: string): Promise<string>;
  repoRoot: string;
}): Promise<void> {
  ensureGitRepository(options.repoRoot);

  const existingConfig = loadRepositoryConfig(options.repoRoot);
  const inspection = inspectRepository(options.repoRoot, existingConfig);
  const agentsPath = resolve(options.repoRoot, "AGENTS.md");

  console.log("Guided repository setup for git-ai");
  console.log("");
  logInspection(options.repoRoot, inspection);

  const answers = await collectSetupAnswers(
    options.promptForLine,
    inspection,
    existsSync(agentsPath)
  );

  writeRepositoryConfig(options.repoRoot, buildRepositoryConfig(answers));
  const gitignoreUpdated = ensureGitAiIgnored(options.repoRoot);

  if (answers.updateAgents) {
    upsertAgentsSection(options.repoRoot, renderAgentsSection(inspection, answers));
  }

  console.log("");
  console.log(`Wrote ${getRepositoryConfigPath(options.repoRoot)}.`);
  console.log(
    gitignoreUpdated ? "Added `.git-ai/` to .gitignore." : "`.git-ai/` was already gitignored."
  );

  if (answers.updateAgents) {
    console.log(`Updated ${resolve(options.repoRoot, "AGENTS.md")}.`);
  }

  if (!fileExists(options.repoRoot, ".env")) {
    console.log("");
    console.log("Next step: create `.env` in the repository root with `OPENAI_API_KEY`.");
    console.log("Optional variables: `OPENAI_MODEL`, `OPENAI_BASE_URL`.");
  }
}
