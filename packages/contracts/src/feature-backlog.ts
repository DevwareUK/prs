import { z } from "zod";

export const FeatureBacklogPriority = z.enum(["high", "medium", "low"]);

export const FeatureBacklogCategory = z.enum([
  "platform",
  "feedback",
  "automation",
  "integration",
  "onboarding",
]);

export const FeatureBacklogInput = z.object({
  excludePaths: z.array(z.string().trim().min(1)).optional(),
  repoRoot: z.string().trim().min(1, "repoRoot must be non-empty"),
  maxSuggestions: z.number().int().min(1).max(20).optional(),
});

export type FeatureBacklogInputType = z.infer<typeof FeatureBacklogInput>;

export const RepositoryFeatureSignals = z.object({
  hasCli: z.boolean(),
  hasGitHubActions: z.boolean(),
  hasTests: z.boolean(),
  hasIssueTemplates: z.boolean(),
  hasReleaseAutomation: z.boolean(),
  hasExamples: z.boolean(),
  packageCount: z.number().int().min(0),
  workflowCount: z.number().int().min(0),
  providerCount: z.number().int().min(0),
  evidence: z.array(z.string().trim().min(1)),
  notes: z.array(z.string().trim().min(1)),
});

export type RepositoryFeatureSignalsType = z.infer<
  typeof RepositoryFeatureSignals
>;

export const FeatureBacklogSuggestion = z.object({
  id: z.string().trim().min(1, "id must be non-empty"),
  title: z.string().trim().min(1, "title must be non-empty"),
  category: FeatureBacklogCategory,
  priority: FeatureBacklogPriority,
  rationale: z.string().trim().min(1, "rationale must be non-empty"),
  evidence: z.array(z.string().trim().min(1)).min(1),
  relatedPaths: z.array(z.string().trim().min(1)).min(1),
  implementationHighlights: z.array(z.string().trim().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  issueTitle: z.string().trim().min(1, "issueTitle must be non-empty"),
  issueBody: z.string().trim().min(1, "issueBody must be non-empty"),
});

export type FeatureBacklogSuggestionType = z.infer<
  typeof FeatureBacklogSuggestion
>;

export const FeatureBacklogOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  repositorySignals: RepositoryFeatureSignals,
  notableOpportunities: z.array(z.string().trim().min(1)),
  suggestions: z.array(FeatureBacklogSuggestion).min(1),
});

export type FeatureBacklogOutputType = z.infer<typeof FeatureBacklogOutput>;
