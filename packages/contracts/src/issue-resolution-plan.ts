import { z } from "zod";

const OptionalStringList = z
  .array(z.string().trim().min(1, "list items must be non-empty"))
  .nullable()
  .optional();

const RequiredStringList = (fieldName: string) =>
  z
    .array(z.string().trim().min(1, `${fieldName} items must be non-empty`))
    .min(1, `${fieldName} must contain at least one item`);

export const IssueResolutionPlanInput = z.object({
  issueNumber: z.number().int().positive().optional(),
  issueTitle: z.string().trim().min(1, "issueTitle must be non-empty"),
  issueBody: z.string().trim().optional(),
  issueUrl: z.string().trim().url("issueUrl must be a valid URL").optional(),
});

export type IssueResolutionPlanInputType = z.infer<typeof IssueResolutionPlanInput>;

export const IssueResolutionPlanModelOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  acceptanceCriteria: RequiredStringList("acceptanceCriteria"),
  likelyFiles: RequiredStringList("likelyFiles"),
  implementationSteps: RequiredStringList("implementationSteps"),
  testPlan: RequiredStringList("testPlan"),
  risks: RequiredStringList("risks"),
  doneDefinition: RequiredStringList("doneDefinition"),
  openQuestions: OptionalStringList,
});

export type IssueResolutionPlanModelOutputType = z.infer<
  typeof IssueResolutionPlanModelOutput
>;

export const IssueResolutionPlanOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  acceptanceCriteria: RequiredStringList("acceptanceCriteria"),
  likelyFiles: RequiredStringList("likelyFiles"),
  implementationSteps: RequiredStringList("implementationSteps"),
  testPlan: RequiredStringList("testPlan"),
  risks: RequiredStringList("risks"),
  doneDefinition: RequiredStringList("doneDefinition"),
  openQuestions: z
    .array(z.string().trim().min(1, "openQuestions items must be non-empty"))
    .optional(),
});

export type IssueResolutionPlanOutputType = z.infer<typeof IssueResolutionPlanOutput>;
