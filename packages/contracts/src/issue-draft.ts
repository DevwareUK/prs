import { z } from "zod";

export const IssueDraftInput = z.object({
  featureIdea: z.string().trim().min(1, "featureIdea must be non-empty"),
  additionalContext: z
    .string()
    .trim()
    .min(1, "additionalContext must be non-empty")
    .optional(),
  repositoryContext: z
    .string()
    .trim()
    .min(1, "repositoryContext must be non-empty")
    .optional(),
  clarificationTranscript: z
    .string()
    .trim()
    .min(1, "clarificationTranscript must be non-empty")
    .optional(),
});

export type IssueDraftInputType = z.infer<typeof IssueDraftInput>;

export const IssueDraftClarificationAnswer = z.object({
  question: z.string().trim().min(1, "question must be non-empty"),
  answer: z.string().trim().min(1, "answer must be non-empty"),
});

export type IssueDraftClarificationAnswerType = z.infer<
  typeof IssueDraftClarificationAnswer
>;

export const IssueDraftGuidanceInput = z.object({
  featureIdea: z.string().trim().min(1, "featureIdea must be non-empty"),
  additionalContext: z
    .string()
    .trim()
    .min(1, "additionalContext must be non-empty")
    .optional(),
  repositoryContext: z
    .string()
    .trim()
    .min(1, "repositoryContext must be non-empty"),
  answers: z.array(IssueDraftClarificationAnswer).optional(),
});

export type IssueDraftGuidanceInputType = z.infer<typeof IssueDraftGuidanceInput>;

export const IssueDraftGuidanceClarify = z.object({
  status: z.literal("clarify"),
  assistantSummary: z
    .string()
    .trim()
    .min(1, "assistantSummary must be non-empty"),
  missingInformation: z
    .array(z.string().trim().min(1, "missingInformation items must be non-empty"))
    .default([]),
  questions: z
    .array(z.string().trim().min(1, "questions items must be non-empty"))
    .min(1, "questions must contain at least one item"),
});

export const IssueDraftGuidanceReady = z.object({
  status: z.literal("ready"),
  assistantSummary: z
    .string()
    .trim()
    .min(1, "assistantSummary must be non-empty"),
});

export const IssueDraftGuidanceOutput = z.discriminatedUnion("status", [
  IssueDraftGuidanceClarify,
  IssueDraftGuidanceReady,
]);

export type IssueDraftGuidanceOutputType = z.infer<
  typeof IssueDraftGuidanceOutput
>;

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
    .nullable()
    .optional(),
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

export const IssueDraftSetIssue = z.object({
  id: z.string().trim().min(1),
  draftFile: z.string().trim().min(1),
  dependsOn: z.array(z.string().trim().min(1)).default([]),
  blocks: z.array(z.string().trim().min(1)).default([]),
  related: z.array(z.string().trim().min(1)).default([]),
});

export type IssueDraftSetIssueType = z.infer<typeof IssueDraftSetIssue>;

export const IssueDraftSet = z
  .object({
    version: z.literal(1),
    mode: z.enum(["single", "multiple"]),
    sourceIssueNumber: z.number().int().positive().optional(),
    linkingStrategy: z.string().trim().min(1).optional(),
    issues: z.array(IssueDraftSetIssue).min(1),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "multiple" && value.issues.length < 2) {
      ctx.addIssue({
        code: "custom",
        message: "multiple issue sets require at least two issues",
      });
    }

    const ids = new Set<string>();
    for (const issue of value.issues) {
      if (ids.has(issue.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["issues"],
          message: `duplicate issue id "${issue.id}"`,
        });
      }
      ids.add(issue.id);
    }

    for (const issue of value.issues) {
      for (const target of [...issue.dependsOn, ...issue.blocks, ...issue.related]) {
        if (!ids.has(target)) {
          ctx.addIssue({
            code: "custom",
            path: ["issues"],
            message: `issue "${issue.id}" references unknown issue "${target}"`,
          });
        }
      }
    }
  });

export type IssueDraftSetType = z.infer<typeof IssueDraftSet>;
