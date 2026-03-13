import { z } from "zod";

const TestSuggestionItem = z.object({
  area: z.string().trim().min(1, "area must be non-empty"),
  priority: z.enum(["high", "medium", "low"]),
  value: z.string().trim().min(1, "value must be non-empty"),
  likelyLocations: z.array(z.string().trim().min(1)).optional(),
});

export const TestSuggestionsInput = z.object({
  diff: z.string().trim().min(1),
  prTitle: z.string().trim().min(1).optional(),
  prBody: z.string().trim().min(1).optional(),
});

export type TestSuggestionsInputType = z.infer<typeof TestSuggestionsInput>;

export const TestSuggestionsOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  suggestedTests: z
    .array(TestSuggestionItem)
    .min(1, "suggestedTests must contain at least one item"),
  edgeCases: z.array(z.string().trim().min(1)).optional(),
});

export type TestSuggestionsOutputType = z.infer<typeof TestSuggestionsOutput>;
