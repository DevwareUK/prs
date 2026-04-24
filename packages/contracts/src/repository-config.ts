import { z } from "zod";

export const RepositoryForgeType = z.enum(["github", "none"]);

export const RepositoryForgeConfig = z.object({
  type: RepositoryForgeType.optional(),
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

export const RepositoryAiIssueDraftConfig = z.object({
  useCodexSuperpowers: z.boolean().optional(),
});

export type RepositoryAiIssueDraftConfigType = z.infer<
  typeof RepositoryAiIssueDraftConfig
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

export const RepositoryAiConfig = z.object({
  issueDraft: RepositoryAiIssueDraftConfig.optional(),
  runtime: RepositoryAiRuntimeConfig.optional(),
  provider: RepositoryAiProviderConfig.optional(),
});

export type RepositoryAiConfigType = z.infer<typeof RepositoryAiConfig>;

export const RepositoryConfigCommand = z
  .array(z.string().trim().min(1, "command segments must be non-empty"))
  .min(1, "command must contain at least one segment");

export const RepositoryConfig = z.object({
  ai: RepositoryAiConfig.optional(),
  aiContext: RepositoryAiContextConfig.optional(),
  baseBranch: z.string().trim().min(1, "baseBranch must be non-empty").optional(),
  buildCommand: RepositoryConfigCommand.optional(),
  forge: RepositoryForgeConfig.optional(),
});

export type RepositoryConfigType = z.infer<typeof RepositoryConfig>;

export const ResolvedRepositoryConfig = z.object({
  ai: z.object({
    issueDraft: z.object({
      useCodexSuperpowers: z.boolean(),
    }),
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
  }),
});

export type ResolvedRepositoryConfigType = z.infer<typeof ResolvedRepositoryConfig>;
