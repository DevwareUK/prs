import { z } from "zod";

export const CommitMessageInput = z.object({
  diff: z.string().trim().min(1),
});

export type CommitMessageInputType = z.infer<typeof CommitMessageInput>;

export const CommitMessageModelOutput = z.object({
  title: z.string().trim().min(1, "title must be non-empty"),
  body: z.string().trim().min(1, "body must be non-empty").nullable(),
});

export type CommitMessageModelOutputType = z.infer<
  typeof CommitMessageModelOutput
>;

export const CommitMessageOutput = z.object({
  title: z.string().trim().min(1, "title must be non-empty"),
  body: z.string().trim().min(1, "body must be non-empty").optional(),
});

export type CommitMessageOutputType = z.infer<typeof CommitMessageOutput>;
