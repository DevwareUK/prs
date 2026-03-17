import { z } from "zod";

export const TestBacklogPriority = z.enum(["high", "medium", "low"]);

export const SuggestedTestType = z.enum([
  "unit",
  "integration",
  "smoke",
  "cli",
  "workflow",
]);

export const TestBacklogInput = z.object({
  repoRoot: z.string().trim().min(1, "repoRoot must be non-empty"),
  maxFindings: z.number().int().min(1).max(20).optional(),
});

export type TestBacklogInputType = z.infer<typeof TestBacklogInput>;

export const TestingSetupStatus = z.enum(["none", "partial", "established"]);

export const CiIntegrationStatus = z.enum(["missing", "partial", "established"]);

export const FrameworkRecommendation = z.object({
  recommended: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  alternatives: z.array(z.string().trim().min(1)),
});

export type FrameworkRecommendationType = z.infer<typeof FrameworkRecommendation>;

export const CiIntegrationAssessment = z.object({
  status: CiIntegrationStatus,
  hasGitHubActions: z.boolean(),
  workflows: z.array(z.string().trim().min(1)),
  evidence: z.array(z.string().trim().min(1)),
  notes: z.array(z.string().trim().min(1)),
});

export type CiIntegrationAssessmentType = z.infer<typeof CiIntegrationAssessment>;

export const CurrentTestingSetup = z.object({
  status: TestingSetupStatus,
  hasTests: z.boolean(),
  testFileCount: z.number().int().min(0),
  frameworks: z.array(z.string().trim().min(1)),
  evidence: z.array(z.string().trim().min(1)),
  testDirectories: z.array(z.string().trim().min(1)),
  notes: z.array(z.string().trim().min(1)),
  frameworkRecommendation: FrameworkRecommendation.optional(),
  ciIntegration: CiIntegrationAssessment,
});

export type CurrentTestingSetupType = z.infer<typeof CurrentTestingSetup>;

export const TestBacklogFinding = z.object({
  id: z.string().trim().min(1, "id must be non-empty"),
  title: z.string().trim().min(1, "title must be non-empty"),
  priority: TestBacklogPriority,
  rationale: z.string().trim().min(1, "rationale must be non-empty"),
  suggestedTestTypes: z.array(SuggestedTestType).min(1),
  relatedPaths: z.array(z.string().trim().min(1)).min(1),
  existingCoverage: z.string().trim().min(1).optional(),
  issueTitle: z.string().trim().min(1, "issueTitle must be non-empty"),
  issueBody: z.string().trim().min(1, "issueBody must be non-empty"),
});

export type TestBacklogFindingType = z.infer<typeof TestBacklogFinding>;

export const TestBacklogOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  currentTestingSetup: CurrentTestingSetup,
  notableCoverageGaps: z.array(z.string().trim().min(1)),
  findings: z.array(TestBacklogFinding).min(1),
});

export type TestBacklogOutputType = z.infer<typeof TestBacklogOutput>;
