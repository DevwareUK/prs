import { z } from "zod";

const text = z.string().trim().min(1);
const timestamp = z.iso.datetime({ offset: true });
const revision = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const count = z.number().int().nonnegative();
const lockfileScope = z.object({
  ecosystem: text,
  path: text.refine(
    value => !value.includes("\\") && value.split("/").every(part => part && part !== "." && part !== ".."),
    "Expected a repository-relative lockfile path",
  ),
});
const gap = z.object({
  scope: text,
  reason: text,
  detail: text,
});
const job = z.object({
  status: z.enum(["active", "paused", "unknown"]),
  evidence: text,
});
const finding = z.object({
  package: text,
  lockedVersion: text,
  targetVersion: text,
  status: z.enum(["compatible", "held", "scheduled"]),
  evidence: text,
  schedule: z.object({ preparation: job.optional(), deployment: job.optional() }).optional(),
});
const observation = lockfileScope.extend({
  repository: text,
  revision,
  observedAt: timestamp,
  sources: z.array(z.url({ protocol: /^https?$/ })),
  resultRef: text,
  checkedCount: count,
  gaps: z.array(gap),
});

export const ReleaseCoverageEvidence = z.object({
  version: z.literal(1),
  baseline: z.object({ repository: text, ref: text, revision }),
  startedAt: timestamp,
  inventoryGaps: z.array(gap).default([]),
  lockfiles: z.array(lockfileScope.extend({ packageCount: count.nullable() })),
  observations: z.array(z.discriminatedUnion("kind", [
    observation.extend({ kind: z.literal("release"), findings: z.array(finding) }),
    observation.extend({ kind: z.literal("advisory") }),
  ])),
});
