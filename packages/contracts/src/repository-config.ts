import { z } from "zod";

export const RepositoryForgeType = z.enum(["github", "none"]);

export const RepositoryForgeConfig = z.object({
  type: RepositoryForgeType.optional(),
  githubCliPath: z
    .string()
    .trim()
    .min(1, "forge githubCliPath must be non-empty")
    .optional(),
});

export type RepositoryForgeConfigType = z.infer<typeof RepositoryForgeConfig>;

export const RepositoryAiContextConfig = z.object({
  excludePaths: z
    .array(z.string().trim().min(1, "excludePaths entries must be non-empty"))
    .optional(),
});

export type RepositoryAiContextConfigType = z.infer<typeof RepositoryAiContextConfig>;

export const RepositoryAiRuntimeType = z.enum(["codex", "claude-code"]);

export const RepositoryAiRuntimeConfig = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("codex"),
  }),
  z.object({
    type: z.literal("claude-code"),
  }),
]);

export type RepositoryAiRuntimeConfigType = z.infer<typeof RepositoryAiRuntimeConfig>;

export const DEFAULT_REPOSITORY_AI_MODEL_ROLES = [
  "planner",
  "implementer",
  "reviewer",
  "tester",
] as const;

export type RepositoryAiWorkflowRole = (typeof DEFAULT_REPOSITORY_AI_MODEL_ROLES)[number];

export const RepositoryAiThinkingLevel = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export type RepositoryAiThinkingLevelType = z.infer<
  typeof RepositoryAiThinkingLevel
>;

export const RepositoryAiProfileConfig = z.object({
  model: z.string().trim().min(1, "ai profile model must be non-empty"),
  thinking: RepositoryAiThinkingLevel,
});

export type RepositoryAiProfileConfigType = z.infer<typeof RepositoryAiProfileConfig>;

export const RepositoryAiProfilesConfig = z.record(
  z.string().trim().min(1, "ai profile names must be non-empty"),
  RepositoryAiProfileConfig
);

export type RepositoryAiProfilesConfigType = z.infer<typeof RepositoryAiProfilesConfig>;

export const RepositoryAiRoleProfileConfig = z.object({
  planner: z.string().trim().min(1, "planner profile must be non-empty").optional(),
  implementer: z.string().trim().min(1, "implementer profile must be non-empty").optional(),
  reviewer: z.string().trim().min(1, "reviewer profile must be non-empty").optional(),
  tester: z.string().trim().min(1, "tester profile must be non-empty").optional(),
});

export type RepositoryAiRoleProfileConfigType = z.infer<
  typeof RepositoryAiRoleProfileConfig
>;

export const RepositoryAiCodexConfig = z.object({
  preferSubagents: z.boolean().optional(),
});

export type RepositoryAiCodexConfigType = z.infer<typeof RepositoryAiCodexConfig>;

export const RepositoryAiIssueDraftConfig = z.object({
  useCodexSuperpowers: z.boolean().optional(),
});

export type RepositoryAiIssueDraftConfigType = z.infer<
  typeof RepositoryAiIssueDraftConfig
>;

export const RepositoryAiIssueConfig = z.object({
  useCodexSuperpowers: z.boolean().optional(),
});

export type RepositoryAiIssueConfigType = z.infer<typeof RepositoryAiIssueConfig>;

export const RepositoryAiCostEstimateModelRateConfig = z.object({
  inputPerMillionTokens: z.number().nonnegative(),
  outputPerMillionTokens: z.number().nonnegative(),
});

export type RepositoryAiCostEstimateModelRateConfigType = z.infer<
  typeof RepositoryAiCostEstimateModelRateConfig
>;

export const RepositoryAiCostEstimatesConfig = z
  .object({
    currency: z.literal("USD").optional(),
    inputTokenRatio: z.number().min(0).max(1).optional(),
    outputTokenRatio: z.number().min(0).max(1).optional(),
    modelRates: z
      .record(
        z.string().trim().min(1, "ai cost estimate model names must be non-empty"),
        RepositoryAiCostEstimateModelRateConfig
      )
      .optional(),
  })
  .strict()
  .superRefine((config, context) => {
    const hasInputRatio = config.inputTokenRatio !== undefined;
    const hasOutputRatio = config.outputTokenRatio !== undefined;

    if (hasInputRatio !== hasOutputRatio) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: hasInputRatio ? ["outputTokenRatio"] : ["inputTokenRatio"],
        message:
          "ai.costEstimates inputTokenRatio and outputTokenRatio must be configured together",
      });
      return;
    }

    if (
      config.inputTokenRatio !== undefined &&
      config.outputTokenRatio !== undefined &&
      Math.abs(config.inputTokenRatio + config.outputTokenRatio - 1) > 0.000001
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputTokenRatio"],
        message: "ai.costEstimates inputTokenRatio and outputTokenRatio must add up to 1",
      });
    }
  });

export type RepositoryAiCostEstimatesConfigType = z.infer<
  typeof RepositoryAiCostEstimatesConfig
>;

export const RepositoryAiProviderType = z.enum(["openai", "bedrock-claude"]);

export const RepositoryOpenAiProviderConfig = z.object({
  type: z.literal("openai"),
  model: z.string().trim().min(1, "openai model must be non-empty").optional(),
  baseUrl: z.string().trim().min(1, "openai baseUrl must be non-empty").optional(),
});

export type RepositoryOpenAiProviderConfigType = z.infer<
  typeof RepositoryOpenAiProviderConfig
>;

export const RepositoryBedrockClaudeProviderConfig = z.object({
  type: z.literal("bedrock-claude"),
  model: z
    .string()
    .trim()
    .min(1, "bedrock-claude model must be non-empty"),
  region: z
    .string()
    .trim()
    .min(1, "bedrock-claude region must be non-empty")
    .optional(),
});

export type RepositoryBedrockClaudeProviderConfigType = z.infer<
  typeof RepositoryBedrockClaudeProviderConfig
>;

export const RepositoryAiProviderConfig = z.discriminatedUnion("type", [
  RepositoryOpenAiProviderConfig,
  RepositoryBedrockClaudeProviderConfig,
]);

export type RepositoryAiProviderConfigType = z.infer<typeof RepositoryAiProviderConfig>;

export const RepositoryAiConfig = z
  .object({
    codex: RepositoryAiCodexConfig.optional(),
    issue: RepositoryAiIssueConfig.optional(),
    issueDraft: RepositoryAiIssueDraftConfig.optional(),
    costEstimates: RepositoryAiCostEstimatesConfig.optional(),
    profiles: RepositoryAiProfilesConfig.optional(),
    roles: RepositoryAiRoleProfileConfig.optional(),
    runtime: RepositoryAiRuntimeConfig.optional(),
    provider: RepositoryAiProviderConfig.optional(),
  })
  .strict()
  .superRefine((config, context) => {
    const profiles = config.profiles ?? {};
    const roles = config.roles ?? {};

    for (const role of DEFAULT_REPOSITORY_AI_MODEL_ROLES) {
      const profileName = roles[role];
      if (profileName !== undefined && profiles[profileName] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["roles", role],
          message: `ai.roles.${role} must reference an existing ai.profiles entry`,
        });
      }
    }
  });

export type RepositoryAiConfigType = z.infer<typeof RepositoryAiConfig>;

export const RepositoryConfigCommand = z
  .array(z.string().trim().min(1, "command segments must be non-empty"))
  .min(1, "command must contain at least one segment");

export const RepositoryLocalRuntimeConfig = z.object({
  type: z.literal("command"),
  url: z.string().trim().min(1, "localRuntime url must be non-empty").optional(),
  statusCommand: RepositoryConfigCommand.optional(),
  startCommand: RepositoryConfigCommand.optional(),
});

export type RepositoryLocalRuntimeConfigType = z.infer<
  typeof RepositoryLocalRuntimeConfig
>;

export const RepositoryPrReadinessCommand = z.object({
  name: z.string().trim().min(1, "prReadiness command name must be non-empty"),
  command: RepositoryConfigCommand,
});

export const RepositoryPrReadinessConfig = z.object({
  commands: z.array(RepositoryPrReadinessCommand).optional(),
});

export type RepositoryPrReadinessConfigType = z.infer<
  typeof RepositoryPrReadinessConfig
>;

export const RepositoryGitHubActionWorkflowConfig = z.object({
  enabled: z.boolean(),
});

export const RepositoryGitHubActionsConfig = z.object({
  workflows: z
    .record(
      z.string().trim().min(1, "githubActions workflow ids must be non-empty"),
      RepositoryGitHubActionWorkflowConfig
    )
    .optional(),
});

export type RepositoryGitHubActionsConfigType = z.infer<
  typeof RepositoryGitHubActionsConfig
>;

export const RepositoryConfig = z.object({
  ai: RepositoryAiConfig.optional(),
  aiContext: RepositoryAiContextConfig.optional(),
  baseBranch: z.string().trim().min(1, "baseBranch must be non-empty").optional(),
  buildCommand: RepositoryConfigCommand.optional(),
  forge: RepositoryForgeConfig.optional(),
  githubActions: RepositoryGitHubActionsConfig.optional(),
  localRuntime: RepositoryLocalRuntimeConfig.optional(),
  prReadiness: RepositoryPrReadinessConfig.optional(),
});

export type RepositoryConfigType = z.infer<typeof RepositoryConfig>;

export const ResolvedRepositoryConfig = z.object({
  ai: z.object({
    codex: z.object({
      preferSubagents: z.boolean(),
    }),
    issue: z.object({
      useCodexSuperpowers: z.boolean(),
    }),
    issueDraft: z.object({
      useCodexSuperpowers: z.boolean(),
    }),
    costEstimates: z.object({
      currency: z.literal("USD"),
      inputTokenRatio: z.number().min(0).max(1),
      outputTokenRatio: z.number().min(0).max(1),
      modelRates: z.record(
        z.string().trim().min(1),
        RepositoryAiCostEstimateModelRateConfig
      ),
    }),
    profiles: RepositoryAiProfilesConfig,
    roles: RepositoryAiRoleProfileConfig,
    runtime: RepositoryAiRuntimeConfig,
    provider: RepositoryAiProviderConfig,
  }),
  aiContext: z.object({
    excludePaths: z.array(z.string().trim().min(1)),
  }),
  baseBranch: z.string().trim().min(1),
  buildCommand: RepositoryConfigCommand,
  forge: z.object({
    type: RepositoryForgeType,
    githubCliPath: z.string().trim().min(1).optional(),
  }),
  githubActions: RepositoryGitHubActionsConfig,
  localRuntime: RepositoryLocalRuntimeConfig.optional(),
  prReadiness: z.object({
    commands: z.array(RepositoryPrReadinessCommand),
  }),
});

export type ResolvedRepositoryConfigType = z.infer<typeof ResolvedRepositoryConfig>;
