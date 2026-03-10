import { z } from "zod";

export const PRDescriptionInput = z.object({
  diff: z.string(),
  issueTitle: z.string().optional(),
  issueBody: z.string().optional(),
});

export type PRDescriptionInputType = z.infer<typeof PRDescriptionInput>;

export const PRDescriptionOutput = z.object({
  title: z.string(),
  body: z.string(),
  testingNotes: z.string().optional(),
  riskNotes: z.string().optional(),
});

export type PRDescriptionOutputType = z.infer<typeof PRDescriptionOutput>;
