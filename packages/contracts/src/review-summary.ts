import { z } from "zod";

const ReviewSummaryItem = z.string().trim().min(1);

export const ReviewSummaryInput = z.object({
  diff: z.string().trim().min(1),
  prTitle: z.string().trim().min(1).optional(),
  prBody: z.string().trim().min(1).optional(),
});

export type ReviewSummaryInputType = z.infer<typeof ReviewSummaryInput>;

export const ReviewSummaryOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  riskAreas: z.array(ReviewSummaryItem),
  reviewerFocus: z.array(ReviewSummaryItem),
  missingTests: z.array(ReviewSummaryItem).optional(),
});

export type ReviewSummaryOutputType = z.infer<typeof ReviewSummaryOutput>;
