import { z } from "zod";

export const SUPPORTED_AGENT_HOSTS = ["codex", "claude-code", "copilot"] as const;
export const AgentHost = z.enum(SUPPORTED_AGENT_HOSTS);
export type AgentHostType = z.infer<typeof AgentHost>;

export const ISSUE_LIFECYCLE_PHASES = [
  "create",
  "refine",
  "plan",
  "implement",
  "verify",
  "finalize",
  "open-pr",
  "validate",
] as const;
export const IssueLifecyclePhase = z.enum(ISSUE_LIFECYCLE_PHASES);
export type IssueLifecyclePhaseType = z.infer<typeof IssueLifecyclePhase>;

const AgentSkillManifestEntry = z
  .object({
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    source: z.string().regex(/^skills\/[a-z0-9-]+\/SKILL\.md$/),
    phases: z.array(IssueLifecyclePhase).min(1),
  })
  .strict()
  .superRefine((skill, context) => {
    if (skill.source !== `skills/${skill.name}/SKILL.md`) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "skill source must match its canonical skill name",
      });
    }
  });

export const AgentSkillManifest = z
  .object({
    version: z.literal(1),
    skills: z.array(AgentSkillManifestEntry).min(1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const names = new Set<string>();
    for (const [index, skill] of manifest.skills.entries()) {
      if (names.has(skill.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["skills", index, "name"],
          message: `duplicate skill name: ${skill.name}`,
        });
      }
      names.add(skill.name);
    }
  });

export type AgentSkillManifestType = z.infer<typeof AgentSkillManifest>;

export const AgentWorkflowCommand = z
  .object({
    name: z.enum([
      "issue-create",
      "issue-context",
      "issue-publish-artifacts",
      "issue-ready",
      "issue-finalize",
      "audit-publish",
      "token-usage-render",
    ]),
    invocation: z.string().trim().min(1),
    json: z.boolean(),
    mutatesRemote: z.boolean(),
    approval: z.enum(["none", "explicit"]),
  })
  .strict()
  .superRefine((command, context) => {
    if (command.mutatesRemote && command.approval !== "explicit") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approval"],
        message: "remote mutations require explicit approval",
      });
    }
  });

export const AgentWorkflowContract = z
  .object({
    version: z.literal(1),
    hosts: z.tuple([z.literal("codex"), z.literal("claude-code"), z.literal("copilot")]),
    phases: z.tuple([
      z.literal("create"),
      z.literal("refine"),
      z.literal("plan"),
      z.literal("implement"),
      z.literal("verify"),
      z.literal("finalize"),
      z.literal("open-pr"),
      z.literal("validate"),
    ]),
    commands: z.array(AgentWorkflowCommand).min(1),
    artifacts: z
      .object({
        runRoot: z.literal(".prs/runs"),
        specificationMarker: z.literal("<!-- prs:issue-spec -->"),
        planMarker: z.literal("<!-- prs:issue-plan -->"),
        auditMarker: z.literal("<!-- prs:audit -->"),
      })
      .strict(),
    safety: z
      .object({
        artifactLocality: z
          .object({
            root: z.literal(".prs/runs"),
            rawArtifacts: z.literal("local-only"),
            staging: z.literal("forbidden"),
          })
          .strict(),
        finalization: z
          .object({
            commitSource: z.literal("existing-index"),
            unstagedChanges: z.literal("preserve"),
            untrackedFiles: z.literal("preserve"),
          })
          .strict(),
      })
      .strict(),
    capabilityFallbacks: z
      .object({
        isolation: z.literal("continue-in-active-workspace"),
        delegation: z.literal("execute-sequentially"),
      })
      .strict(),
  })
  .strict();

export const AGENT_WORKFLOW_CONTRACT = AgentWorkflowContract.parse({
  version: 1,
  hosts: SUPPORTED_AGENT_HOSTS,
  phases: ISSUE_LIFECYCLE_PHASES,
  commands: [
    {
      name: "issue-create",
      invocation: "prs tool issue create (--draft-file <path>|--issue-set <path>) --json",
      json: true,
      mutatesRemote: true,
      approval: "explicit",
    },
    {
      name: "issue-context",
      invocation: "prs tool issue context <number> --json",
      json: true,
      mutatesRemote: false,
      approval: "none",
    },
    {
      name: "issue-publish-artifacts",
      invocation:
        "prs tool issue publish-artifacts <number> --spec-file <path> --plan-file <path> --json",
      json: true,
      mutatesRemote: true,
      approval: "explicit",
    },
    {
      name: "issue-ready",
      invocation: "prs tool issue ready <number> --json",
      json: true,
      mutatesRemote: false,
      approval: "none",
    },
    {
      name: "issue-finalize",
      invocation: "prs issue finalize <number>",
      json: false,
      mutatesRemote: false,
      approval: "explicit",
    },
    {
      name: "audit-publish",
      invocation: "prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name>",
      json: false,
      mutatesRemote: true,
      approval: "explicit",
    },
    {
      name: "token-usage-render",
      invocation: "prs tool token-usage render --file <path> --output <path> --json",
      json: true,
      mutatesRemote: false,
      approval: "none",
    },
  ],
  artifacts: {
    runRoot: ".prs/runs",
    specificationMarker: "<!-- prs:issue-spec -->",
    planMarker: "<!-- prs:issue-plan -->",
    auditMarker: "<!-- prs:audit -->",
  },
  safety: {
    artifactLocality: {
      root: ".prs/runs",
      rawArtifacts: "local-only",
      staging: "forbidden",
    },
    finalization: {
      commitSource: "existing-index",
      unstagedChanges: "preserve",
      untrackedFiles: "preserve",
    },
  },
  capabilityFallbacks: {
    isolation: "continue-in-active-workspace",
    delegation: "execute-sequentially",
  },
});

export type AgentWorkflowContractType = z.infer<typeof AgentWorkflowContract>;
