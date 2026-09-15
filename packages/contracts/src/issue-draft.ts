import { z } from "zod";

export const IssueDraftSetIssue = z.object({
  id: z.string().trim().min(1),
  draftFile: z.string().trim().min(1),
  dependsOn: z.array(z.string().trim().min(1)).default([]),
  blocks: z.array(z.string().trim().min(1)).default([]),
  related: z.array(z.string().trim().min(1)).default([]),
});

export type IssueDraftSetIssueType = z.infer<typeof IssueDraftSetIssue>;

export const IssueDraftSetV1 = z
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

const LinkedIssueSetV2Issue = IssueDraftSetIssue.extend({
  issueNumber: z.number().int().positive().optional(),
  specFile: z.string().trim().min(1),
  planFile: z.string().trim().min(1),
  parentId: z.string().trim().min(1).optional(),
});

export const LinkedIssueSetV2 = z
  .object({
    version: z.literal(2),
    mode: z.literal("multiple"),
    sourceIssueNumber: z.number().int().positive().optional(),
    linkingStrategy: z.string().trim().min(1).optional(),
    orchestration: z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("parent"),
        orchestratorId: z.string().trim().min(1),
      }),
      z.object({
        mode: z.literal("flat"),
        reason: z.string().trim().min(1),
      }),
    ]),
    issues: z.array(LinkedIssueSetV2Issue).min(2),
  })
  .superRefine((value, context) => {
    const ids = new Set(value.issues.map((issue) => issue.id));
    if (ids.size !== value.issues.length) {
      context.addIssue({ code: "custom", path: ["issues"], message: "issue ids must be unique" });
    }

    const issueNumbers = value.issues
      .map((issue) => issue.issueNumber)
      .filter((number): number is number => number !== undefined);
    if (new Set(issueNumbers).size !== issueNumbers.length) {
      context.addIssue({ code: "custom", path: ["issues"], message: "issue numbers must be unique" });
    }

    for (const [index, issue] of value.issues.entries()) {
      for (const [relation, targets] of [
        ["dependsOn", issue.dependsOn],
        ["blocks", issue.blocks],
        ["related", issue.related],
      ] as const) {
        for (const target of targets) {
          if (!ids.has(target)) {
            context.addIssue({
              code: "custom",
              path: ["issues", index, relation],
              message: `issue "${issue.id}" references unknown issue "${target}"`,
            });
          } else if (target === issue.id) {
            context.addIssue({
              code: "custom",
              path: ["issues", index, relation],
              message: `issue "${issue.id}" cannot reference itself`,
            });
          }
        }
      }
    }

    if (value.orchestration.mode === "flat") {
      for (const [index, issue] of value.issues.entries()) {
        if (issue.parentId !== undefined) {
          context.addIssue({
            code: "custom",
            path: ["issues", index, "parentId"],
            message: "flat issue sets cannot declare parentId",
          });
        }
      }
    } else {
      const orchestratorId = value.orchestration.orchestratorId;
      if (!ids.has(orchestratorId)) {
        context.addIssue({
          code: "custom",
          path: ["orchestration", "orchestratorId"],
          message: `orchestratorId references unknown issue "${orchestratorId}"`,
        });
      }
      for (const [index, issue] of value.issues.entries()) {
        const expectedParent = issue.id === orchestratorId ? undefined : orchestratorId;
        if (issue.parentId !== expectedParent) {
          context.addIssue({
            code: "custom",
            path: ["issues", index, "parentId"],
            message: issue.id === orchestratorId
              ? "the orchestrator cannot have a parent"
              : `issue "${issue.id}" must declare parentId "${orchestratorId}"`,
          });
        }
      }
    }

    const dependencies = new Map(value.issues.map((issue) => [issue.id, new Set(issue.dependsOn)]));
    for (const issue of value.issues) {
      for (const blocked of issue.blocks) dependencies.get(blocked)?.add(issue.id);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const dependency of dependencies.get(id) ?? []) {
        if (hasCycle(dependency)) return true;
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (value.issues.some((issue) => hasCycle(issue.id))) {
      context.addIssue({ code: "custom", path: ["issues"], message: "issue dependency graph must be acyclic" });
    }
  });

export const IssueDraftSet = z.union([IssueDraftSetV1, LinkedIssueSetV2]);

export type IssueDraftSetType = z.infer<typeof IssueDraftSet>;
export type LinkedIssueSetV2Type = z.infer<typeof LinkedIssueSetV2>;
