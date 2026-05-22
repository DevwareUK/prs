import { z } from "zod";

const PRImpactProfileItem = z.string().trim().min(1);

export const PRImpactRiskLevel = z.enum(["none", "low", "medium", "high"]);

export const PRImpactProfileFlags = z.object({
  security: z.boolean().default(false),
  performance: z.boolean().default(false),
});

export const PRImpactProfile = z.object({
  riskLevel: PRImpactRiskLevel.default("none"),
  riskReasons: z.array(PRImpactProfileItem).default([]),
  affectedAreas: z.array(PRImpactProfileItem).default([]),
  rolloutImpact: z.array(PRImpactProfileItem).default([]),
  migrationImpact: z.array(PRImpactProfileItem).default([]),
  configurationImpact: z.array(PRImpactProfileItem).default([]),
  flags: PRImpactProfileFlags.default(PRImpactProfileFlags.parse({})),
  manualVerification: z.array(PRImpactProfileItem).default([]),
});

export type PRImpactProfileType = z.infer<typeof PRImpactProfile>;

export const DEFAULT_PR_IMPACT_PROFILE = PRImpactProfile.parse({});
