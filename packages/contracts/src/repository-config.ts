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

export const RepositoryIssueTrackerType = z.enum(["github", "monday", "none"]);
const positiveId = z.string().regex(/^[1-9]\d*$/, "Expected a positive decimal ID");
export const MondayCreationDefaults = z.object({
  groupId: z.string().trim().min(1).optional(),
  columnValues: z.record(z.string().min(1), z.json()).optional(),
}).strict();
export const GitHubCreationDefaults = z.object({
  labels: z.array(z.string().trim().min(1)).optional(),
  assignees: z.array(z.string().trim().min(1)).optional(),
  milestone: z.number().int().positive().optional(),
}).strict();
export const MondayRepositoryConfig = z.object({
  boardId: positiveId,
  apiVersion: z.string().regex(/^\d{4}-(01|04|07|10)$/).optional(),
  tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  scope: z.object({
    groupIds: z.array(z.string().min(1)).min(1).optional(),
    columnRules: z.array(z.object({ columnId: z.string().min(1), operator: z.string().min(1), compareValue: z.json() }).strict()).min(1).optional(),
  }).strict().optional(),
  doneBoardIds: z.array(positiveId).optional(),
  doneGroupIds: z.array(z.string().min(1)).optional(),
  defaultsByBoard: z.record(positiveId, MondayCreationDefaults).optional(),
  bodyUpdatePrefix: z.string().min(1).optional(),
  workflow: z.record(positiveId, z.object({
    statusColumnId: z.string().min(1).optional(), peopleColumnId: z.string().min(1).optional(),
    inProgressLabel: z.string().min(1).optional(), doneLabels: z.array(z.string().min(1)).optional(),
    labelsColumnId: z.string().min(1).optional(), closedLabel: z.string().min(1).optional(),
    migrationSourceColumnId: z.string().min(1).optional(),
  }).strict()).optional(),
}).strict();
const issueTrackerShape = {
  type: RepositoryIssueTrackerType.optional(),
  defaults: z.union([MondayCreationDefaults, GitHubCreationDefaults]).optional(),
  monday: MondayRepositoryConfig.optional(),
};
function validateTracker(value: {type?: string; defaults?: unknown; monday?: unknown}, ctx: z.RefinementCtx) {
  if (value.type === "monday") {
    if (!value.monday) ctx.addIssue({code: "custom", path: ["monday"], message: "Monday board configuration is required"});
    if (value.defaults && !MondayCreationDefaults.safeParse(value.defaults).success) ctx.addIssue({code: "custom", path: ["defaults"], message: "Expected Monday creation defaults"});
  } else {
    if (value.monday) ctx.addIssue({code: "custom", path: ["monday"], message: "Monday settings require issueTracker.type monday"});
    if (value.defaults && (value.type === "none" || !GitHubCreationDefaults.safeParse(value.defaults).success)) ctx.addIssue({code: "custom", path: ["defaults"], message: "Expected enabled GitHub creation defaults"});
  }
}
export const RepositoryIssueTrackerConfig = z.object(issueTrackerShape).strict().superRefine(validateTracker);
export type RepositoryIssueTrackerConfigType = z.infer<typeof RepositoryIssueTrackerConfig>;

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
    issueTracker: RepositoryIssueTrackerConfig.optional(),
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
    issueTracker: record.issueTracker,
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
    issueTracker: z.object({ ...issueTrackerShape, type: RepositoryIssueTrackerType }).strict().superRefine(validateTracker),
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
