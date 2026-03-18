import { z } from "zod";

const PRAssistantItem = z.string().trim().min(1);

export const PRAssistantInput = z.object({
  diff: z.string().trim().min(1),
  commitMessages: z.string().trim().min(1).optional(),
  prTitle: z.string().trim().min(1).optional(),
  prBody: z.string().trim().min(1).optional(),
});

export type PRAssistantInputType = z.infer<typeof PRAssistantInput>;

export const PRAssistantOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  keyChanges: z.array(PRAssistantItem).min(1, "keyChanges must be non-empty"),
  riskAreas: z.array(PRAssistantItem),
  reviewerFocus: z.array(PRAssistantItem).min(1, "reviewerFocus must be non-empty"),
});

export type PRAssistantOutputType = z.infer<typeof PRAssistantOutput>;
