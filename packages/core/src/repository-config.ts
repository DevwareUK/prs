import {
  AgentRepositoryConfig,
  ResolvedRepositoryConfig,
  type AgentRepositoryConfigType,
  type ResolvedRepositoryConfigType,
} from "@prs/contracts";

export const DEFAULT_REPOSITORY_BASE_BRANCH = "main";
export const DEFAULT_REPOSITORY_BUILD_COMMAND = ["pnpm", "build"] as const;
export const DEFAULT_REPOSITORY_FORGE_TYPE = "github" as const;
export const DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/dist/**",
  "**/build/**",
  "*.map",
] as const;

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
}

export function resolveRepositoryConfig(
  config?: AgentRepositoryConfigType
): ResolvedRepositoryConfigType {
  const parsedConfig = AgentRepositoryConfig.parse(config ?? {});

  return ResolvedRepositoryConfig.parse({
    aiContext: {
      excludePaths: uniquePaths([
        ...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
        ...(parsedConfig.aiContext?.excludePaths ?? []),
      ]),
    },
    baseBranch: parsedConfig.baseBranch ?? DEFAULT_REPOSITORY_BASE_BRANCH,
    buildCommand: parsedConfig.buildCommand ?? [...DEFAULT_REPOSITORY_BUILD_COMMAND],
    forge: {
      type: parsedConfig.forge?.type ?? DEFAULT_REPOSITORY_FORGE_TYPE,
      ...(parsedConfig.forge?.githubCliPath
        ? { githubCliPath: parsedConfig.forge.githubCliPath }
        : {}),
    },
    localRuntime: parsedConfig.localRuntime,
    prReadiness: {
      commands: parsedConfig.prReadiness?.commands ?? [],
    },
  });
}
