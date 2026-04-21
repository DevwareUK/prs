import { z } from "zod";

export const PRDescriptionInput = z.object({
  diff: z.string().trim().min(1),
  issueTitle: z.string().trim().min(1).optional(),
  issueBody: z.string().trim().min(1).optional(),
});

export type PRDescriptionInputType = z.infer<typeof PRDescriptionInput>;

export const PRDescriptionOutput = z.object({
  title: z.string().trim().min(1, "title must be non-empty"),
  body: z.string().trim().min(1, "body must be non-empty"),
});

export type PRDescriptionOutputType = z.infer<typeof PRDescriptionOutput>;
