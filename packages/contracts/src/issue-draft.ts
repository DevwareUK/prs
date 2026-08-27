import { z } from "zod";

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
  .superRefine((value, context) => {
    if (value.mode === "multiple" && value.issues.length < 2) {
      context.addIssue({ code: "custom", message: "multiple issue sets require at least two issues" });
    }
    const ids = new Set(value.issues.map((issue) => issue.id));
    if (ids.size !== value.issues.length) {
      context.addIssue({ code: "custom", path: ["issues"], message: "issue ids must be unique" });
    }
    for (const issue of value.issues) {
      for (const target of [...issue.dependsOn, ...issue.blocks, ...issue.related]) {
        if (!ids.has(target)) {
          context.addIssue({
            code: "custom",
            path: ["issues"],
            message: `issue "${issue.id}" references unknown issue "${target}"`,
          });
        }
      }
    }
  });

export type IssueDraftSetType = z.infer<typeof IssueDraftSet>;
