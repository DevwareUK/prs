import { z } from "zod";

export const PRReviewSeverity = z.enum(["high", "medium", "low"]);

export const PRReviewConfidence = z.enum(["high", "medium", "low"]);

export const PRReviewCategory = z.enum([
  "bug",
  "correctness",
  "security",
  "performance",
  "maintainability",
  "testing",
  "documentation",
  "usability",
]);

const PRReviewConcernBase = {
  severity: PRReviewSeverity,
  confidence: PRReviewConfidence,
  category: PRReviewCategory,
  affectedFile: z.string().trim().min(1, "affectedFile must be non-empty"),
  body: z.string().trim().min(1, "body must be non-empty"),
  whyThisMatters: z
    .string()
    .trim()
    .min(1, "whyThisMatters must be non-empty"),
  suggestedFix: z.string().trim().min(1).optional(),
} as const;

export const PRReviewComment = z.object({
  path: z.string().trim().min(1, "path must be non-empty"),
  line: z.number().int().positive("line must be a positive integer"),
  ...PRReviewConcernBase,
});

export type PRReviewCommentType = z.infer<typeof PRReviewComment>;

export const PRReviewFinding = z.object({
  title: z.string().trim().min(1, "title must be non-empty"),
  ...PRReviewConcernBase,
});

export type PRReviewFindingType = z.infer<typeof PRReviewFinding>;

export const PRReviewInput = z.object({
  diff: z.string().trim().min(1),
  prTitle: z.string().trim().min(1).optional(),
  prBody: z.string().trim().min(1).optional(),
  issueNumber: z.number().int().positive().optional(),
  issueTitle: z.string().trim().min(1).optional(),
  issueBody: z.string().trim().min(1).optional(),
  issueUrl: z.string().trim().url().optional(),
});

export type PRReviewInputType = z.infer<typeof PRReviewInput>;

export const PRReviewOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  comments: z.array(PRReviewComment),
  findings: z.array(PRReviewFinding).max(3).default([]),
});

export type PRReviewOutputType = z.infer<typeof PRReviewOutput>;
