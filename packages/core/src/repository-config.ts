import {
  RepositoryConfig,
  type RepositoryConfigType,
  type RepositoryAiCostEstimatesConfigType,
  ResolvedRepositoryConfig,
  type ResolvedRepositoryConfigType,
} from "@prs/contracts";
import { DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS } from "./issue-token-estimate";

export const DEFAULT_REPOSITORY_BASE_BRANCH = "main";
export const DEFAULT_REPOSITORY_BUILD_COMMAND = ["pnpm", "build"] as const;
export const DEFAULT_REPOSITORY_FORGE_TYPE = "github" as const;
export const DEFAULT_REPOSITORY_AI_RUNTIME_TYPE = "codex" as const;
export const DEFAULT_REPOSITORY_AI_PROVIDER_TYPE = "openai" as const;
export const DEFAULT_REPOSITORY_AI_CODEX_PREFER_SUBAGENTS = true;
export const DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS = false;
export const DEFAULT_REPOSITORY_AI_COST_ESTIMATES = {
  ...DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS,
  modelRates: {
    ...DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS.modelRates,
  },
} satisfies Required<RepositoryAiCostEstimatesConfigType>;
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
  config?: RepositoryConfigType
): ResolvedRepositoryConfigType {
  const parsedConfig = RepositoryConfig.parse(config ?? {});
  const costEstimates = {
    ...DEFAULT_REPOSITORY_AI_COST_ESTIMATES,
    ...(parsedConfig.ai?.costEstimates ?? {}),
    modelRates: {
      ...DEFAULT_REPOSITORY_AI_COST_ESTIMATES.modelRates,
      ...(parsedConfig.ai?.costEstimates?.modelRates ?? {}),
    },
  };

  const useCodexSuperpowers =
    parsedConfig.ai?.issue?.useCodexSuperpowers ??
    parsedConfig.ai?.issueDraft?.useCodexSuperpowers ??
    DEFAULT_REPOSITORY_AI_ISSUE_DRAFT_USE_CODEX_SUPERPOWERS;

  return ResolvedRepositoryConfig.parse({
    ai: {
      codex: {
        preferSubagents:
          parsedConfig.ai?.codex?.preferSubagents ??
          DEFAULT_REPOSITORY_AI_CODEX_PREFER_SUBAGENTS,
      },
      issue: {
        useCodexSuperpowers,
      },
      issueDraft: {
        useCodexSuperpowers,
      },
      costEstimates,
      runtime: parsedConfig.ai?.runtime ?? {
        type: DEFAULT_REPOSITORY_AI_RUNTIME_TYPE,
      },
      provider: parsedConfig.ai?.provider ?? {
        type: DEFAULT_REPOSITORY_AI_PROVIDER_TYPE,
      },
    },
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
    githubActions: parsedConfig.githubActions ?? {},
    localRuntime: parsedConfig.localRuntime,
    prReadiness: {
      commands: parsedConfig.prReadiness?.commands ?? [],
    },
  });
}
