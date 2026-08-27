import { z } from "zod";

export const RepositoryForgeType = z.enum(["github", "none"]);

export const RepositoryForgeConfig = z
  .object({
    type: RepositoryForgeType.optional(),
    githubCliPath: z
      .string()
      .trim()
      .min(1, "forge githubCliPath must be non-empty")
      .optional(),
  })
  .strict();

export type RepositoryForgeConfigType = z.infer<typeof RepositoryForgeConfig>;

export const RepositoryAiContextConfig = z
  .object({
    excludePaths: z
      .array(z.string().trim().min(1, "excludePaths entries must be non-empty"))
      .optional(),
  })
  .strict();

export type RepositoryAiContextConfigType = z.infer<typeof RepositoryAiContextConfig>;

export const RepositoryConfigCommand = z
  .array(z.string().trim().min(1, "command segments must be non-empty"))
  .min(1, "command must contain at least one segment");

export const RepositoryLocalRuntimeConfig = z
  .object({
    type: z.literal("command"),
    url: z.string().trim().min(1, "localRuntime url must be non-empty").optional(),
    statusCommand: RepositoryConfigCommand.optional(),
    startCommand: RepositoryConfigCommand.optional(),
  })
  .strict();

export type RepositoryLocalRuntimeConfigType = z.infer<
  typeof RepositoryLocalRuntimeConfig
>;

export const RepositoryPrReadinessCommand = z
  .object({
    name: z.string().trim().min(1, "prReadiness command name must be non-empty"),
    command: RepositoryConfigCommand,
  })
  .strict();

export const RepositoryPrReadinessConfig = z
  .object({
    commands: z.array(RepositoryPrReadinessCommand).optional(),
  })
  .strict();

export type RepositoryPrReadinessConfigType = z.infer<
  typeof RepositoryPrReadinessConfig
>;

export const AgentRepositoryConfig = z
  .object({
    aiContext: RepositoryAiContextConfig.optional(),
    baseBranch: z.string().trim().min(1, "baseBranch must be non-empty").optional(),
    buildCommand: RepositoryConfigCommand.optional(),
    forge: RepositoryForgeConfig.optional(),
    localRuntime: RepositoryLocalRuntimeConfig.optional(),
    prReadiness: RepositoryPrReadinessConfig.optional(),
  })
  .strict();

export type AgentRepositoryConfigType = z.infer<typeof AgentRepositoryConfig>;

export const RepositoryConfig = AgentRepositoryConfig;
export type RepositoryConfigType = AgentRepositoryConfigType;

export type AgentRepositoryConfigMigration = {
  config: AgentRepositoryConfigType;
  notices: string[];
};

export function migrateRepositoryConfigToAgentWorkflow(
  input: unknown
): AgentRepositoryConfigMigration {
  const raw = input ?? {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Repository configuration must be a JSON object.");
  }
  const record = raw as Record<string, unknown>;
  const retiredKeys = ["ai", "githubActions"].filter((key) => key in record);
  const config = AgentRepositoryConfig.parse({
    aiContext: record.aiContext,
    baseBranch: record.baseBranch,
    buildCommand: record.buildCommand,
    forge: record.forge,
    localRuntime: record.localRuntime,
    prReadiness: record.prReadiness,
  });

  return {
    config,
    notices:
      retiredKeys.length === 0
        ? []
        : [
            `Removed retired prs configuration sections: ${retiredKeys.join(
              ", "
            )}. Agent reasoning now stays in the active coding-agent session.`,
          ],
  };
}

export const ResolvedRepositoryConfig = z
  .object({
    aiContext: z
      .object({
        excludePaths: z.array(z.string().trim().min(1)),
      })
      .strict(),
    baseBranch: z.string().trim().min(1),
    buildCommand: RepositoryConfigCommand,
    forge: z
      .object({
        type: RepositoryForgeType,
        githubCliPath: z.string().trim().min(1).optional(),
      })
      .strict(),
    localRuntime: RepositoryLocalRuntimeConfig.optional(),
    prReadiness: z
      .object({
        commands: z.array(RepositoryPrReadinessCommand),
      })
      .strict(),
  })
  .strict();

export type ResolvedRepositoryConfigType = z.infer<
  typeof ResolvedRepositoryConfig
>;
