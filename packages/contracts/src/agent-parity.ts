import { z } from "zod";
import { AgentHost } from "./agent-workflow";

const SmokePhaseEvidence = z
  .object({
    status: z.enum(["passed", "failed", "not-run"]),
    evidence: z.string().trim().min(1),
  })
  .strict();

const SmokeHostRow = z
  .object({
    host: AgentHost,
    runner: z.string().trim().min(1),
    issueUrl: z.string().url().optional(),
    pullRequestUrl: z.string().url().optional(),
    phases: z
      .object({
        create: SmokePhaseEvidence,
        refine: SmokePhaseEvidence,
        plan: SmokePhaseEvidence,
        implement: SmokePhaseEvidence,
        verify: SmokePhaseEvidence,
        "open-pr": SmokePhaseEvidence,
        validate: SmokePhaseEvidence,
      })
      .strict(),
  })
  .strict();

export const AgentLifecycleSmokeMatrix = z
  .object({
    version: z.literal(1),
    repository: z.string().url(),
    recordedAt: z.string().datetime(),
    hosts: z.array(SmokeHostRow).length(3),
  })
  .strict()
  .superRefine((matrix, context) => {
    const hosts = new Set(matrix.hosts.map((row) => row.host));
    for (const host of ["codex", "claude-code", "copilot"] as const) {
      if (!hosts.has(host)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["hosts"],
          message: `missing separately attributed smoke row for ${host}`,
        });
      }
    }
  });

export type AgentLifecycleSmokeMatrixType = z.infer<typeof AgentLifecycleSmokeMatrix>;
