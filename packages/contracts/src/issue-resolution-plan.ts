import { z } from "zod";

const OptionalStringList = z
  .array(z.string().trim().min(1, "list items must be non-empty"))
  .nullable()
  .optional();

export const IssueResolutionPlanInput = z.object({
  issueNumber: z.number().int().positive().optional(),
  issueTitle: z.string().trim().min(1, "issueTitle must be non-empty"),
  issueBody: z.string().trim().optional(),
  issueUrl: z.string().trim().url("issueUrl must be a valid URL").optional(),
});

export type IssueResolutionPlanInputType = z.infer<typeof IssueResolutionPlanInput>;

export const IssueResolutionPlanModelOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  implementationSteps: z
    .array(z.string().trim().min(1, "implementationSteps items must be non-empty"))
    .min(1, "implementationSteps must contain at least one item"),
  validationSteps: z
    .array(z.string().trim().min(1, "validationSteps items must be non-empty"))
    .min(1, "validationSteps must contain at least one item"),
  risks: OptionalStringList,
  openQuestions: OptionalStringList,
});

export type IssueResolutionPlanModelOutputType = z.infer<
  typeof IssueResolutionPlanModelOutput
>;

export const IssueResolutionPlanOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  implementationSteps: z
    .array(z.string().trim().min(1, "implementationSteps items must be non-empty"))
    .min(1, "implementationSteps must contain at least one item"),
  validationSteps: z
    .array(z.string().trim().min(1, "validationSteps items must be non-empty"))
    .min(1, "validationSteps must contain at least one item"),
  risks: z
    .array(z.string().trim().min(1, "risks items must be non-empty"))
    .optional(),
  openQuestions: z
    .array(z.string().trim().min(1, "openQuestions items must be non-empty"))
    .optional(),
});

export type IssueResolutionPlanOutputType = z.infer<typeof IssueResolutionPlanOutput>;
