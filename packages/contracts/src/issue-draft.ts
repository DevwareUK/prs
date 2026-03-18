import { z } from "zod";

export const IssueDraftInput = z.object({
  featureIdea: z.string().trim().min(1, "featureIdea must be non-empty"),
  additionalContext: z
    .string()
    .trim()
    .min(1, "additionalContext must be non-empty")
    .optional(),
});

export type IssueDraftInputType = z.infer<typeof IssueDraftInput>;

export const IssueDraftModelOutput = z.object({
  title: z.string().trim().min(1, "title must be non-empty"),
  summary: z.string().trim().min(1, "summary must be non-empty"),
  motivation: z.string().trim().min(1, "motivation must be non-empty"),
  goal: z.string().trim().min(1, "goal must be non-empty"),
  proposedBehavior: z
    .array(z.string().trim().min(1, "proposedBehavior items must be non-empty"))
    .min(1, "proposedBehavior must contain at least one item"),
  requirements: z
    .array(z.string().trim().min(1, "requirements items must be non-empty"))
    .min(1, "requirements must contain at least one item"),
  constraints: z
    .array(z.string().trim().min(1, "constraints items must be non-empty"))
    .nullable(),
  acceptanceCriteria: z
    .array(z.string().trim().min(1, "acceptanceCriteria items must be non-empty"))
    .min(1, "acceptanceCriteria must contain at least one item"),
});

export type IssueDraftModelOutputType = z.infer<typeof IssueDraftModelOutput>;

export const IssueDraftOutput = z.object({
  title: z.string().trim().min(1, "title must be non-empty"),
  summary: z.string().trim().min(1, "summary must be non-empty"),
  motivation: z.string().trim().min(1, "motivation must be non-empty"),
  goal: z.string().trim().min(1, "goal must be non-empty"),
  proposedBehavior: z
    .array(z.string().trim().min(1, "proposedBehavior items must be non-empty"))
    .min(1, "proposedBehavior must contain at least one item"),
  requirements: z
    .array(z.string().trim().min(1, "requirements items must be non-empty"))
    .min(1, "requirements must contain at least one item"),
  constraints: z
    .array(z.string().trim().min(1, "constraints items must be non-empty"))
    .optional(),
  acceptanceCriteria: z
    .array(z.string().trim().min(1, "acceptanceCriteria items must be non-empty"))
    .min(1, "acceptanceCriteria must contain at least one item"),
});

export type IssueDraftOutputType = z.infer<typeof IssueDraftOutput>;
