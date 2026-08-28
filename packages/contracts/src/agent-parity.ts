import { z } from "zod";
import { AgentHost } from "./agent-workflow";

const safeRepositoryPath = z
  .string()
  .min(1)
  .refine(
    (path) => {
      const segments = path.split("/");
      return (
        path === path.trim() &&
        !path.startsWith("/") &&
        !path.includes("\\") &&
        !/^[a-zA-Z]:/.test(path) &&
        !segments.some((segment) => segment === "" || segment === "." || segment === "..")
      );
    },
    "must be a canonical repository-relative path"
  );

type GitHubRepositoryIdentity = {
  owner: string;
  repository: string;
  key: string;
};

type GitHubResourceIdentity = GitHubRepositoryIdentity & {
  resource: "issues" | "pull";
  id: string;
  key: string;
};

const GITHUB_REPOSITORY_URL = /^https:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)$/;
const GITHUB_RESOURCE_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/(\d+)$/;

function parseGitHubRepository(value: string): GitHubRepositoryIdentity | undefined {
  const match = GITHUB_REPOSITORY_URL.exec(value);
  if (!match || match[0] !== value) return undefined;

  const owner = match[1].toLowerCase();
  const repository = match[2].toLowerCase();
  return { owner, repository, key: `${owner}/${repository}` };
}

function parseGitHubResource(
  value: string,
  expectedResource: "issues" | "pull"
): GitHubResourceIdentity | undefined {
  const match = GITHUB_RESOURCE_URL.exec(value);
  if (!match || match[0] !== value || match[3] !== expectedResource) return undefined;

  const owner = match[1].toLowerCase();
  const repository = match[2].toLowerCase();
  const numericId = BigInt(match[4]);
  if (numericId === 0n) return undefined;
  const id = numericId.toString();
  return {
    owner,
    repository,
    resource: expectedResource,
    id,
    key: `${owner}/${repository}/${expectedResource}/${id}`,
  };
}

const SmokeCheckEvidence = z
  .object({
    name: z.string().trim().min(1),
    status: z.enum(["passed", "failed", "not-configured"]),
    evidence: z.string().trim().min(1),
  })
  .strict();

const SmokeSentinelEvidence = z
  .object({
    path: safeRepositoryPath,
    state: z.enum(["untracked", "committed", "not-run"]),
    evidence: z.string().trim().min(1),
  })
  .strict();

const SmokeSafetyEvidence = z
  .object({
    artifactRoot: z.literal(".prs/runs"),
    artifactPaths: z.array(safeRepositoryPath),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/).optional(),
    committedPaths: z.array(safeRepositoryPath),
    sentinel: SmokeSentinelEvidence,
    checks: z.array(SmokeCheckEvidence),
    capabilityFallbacks: z.array(z.string().trim().min(1)),
    deviations: z.array(z.string().trim().min(1)),
  })
  .strict();

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
    issueUrl: z.string().min(1).optional(),
    pullRequestUrl: z.string().min(1).optional(),
    phases: z
      .object({
        create: SmokePhaseEvidence,
        refine: SmokePhaseEvidence,
        plan: SmokePhaseEvidence,
        implement: SmokePhaseEvidence,
        verify: SmokePhaseEvidence,
        finalize: SmokePhaseEvidence,
        "open-pr": SmokePhaseEvidence,
        validate: SmokePhaseEvidence,
      })
      .strict(),
    safety: SmokeSafetyEvidence,
  })
  .strict();

export const AgentLifecycleSmokeMatrix = z
  .object({
    version: z.literal(2),
    repository: z.string().min(1),
    recordedAt: z.string().datetime(),
    hosts: z.array(SmokeHostRow).length(3),
  })
  .strict()
  .superRefine((matrix, context) => {
    const hosts = new Set<string>();
    const runners = new Set<string>();
    const issueIdentities = new Set<string>();
    const pullRequestIdentities = new Set<string>();
    const repositoryIdentity = parseGitHubRepository(matrix.repository);

    if (!repositoryIdentity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repository"],
        message: "matrix repository must be a canonical GitHub repository URL",
      });
    }

    for (const [index, row] of matrix.hosts.entries()) {
      const hostPath = ["hosts", index] as const;
      if (hosts.has(row.host)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...hostPath, "host"],
          message: `duplicate smoke row attribution for ${row.host}`,
        });
      }
      hosts.add(row.host);

      if (runners.has(row.runner)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...hostPath, "runner"],
          message: "duplicate runner attribution",
        });
      }
      runners.add(row.runner);

      for (const [field, value, resource, seen] of [
        ["issueUrl", row.issueUrl, "issues", issueIdentities],
        ["pullRequestUrl", row.pullRequestUrl, "pull", pullRequestIdentities],
      ] as const) {
        if (!value) continue;
        const identity = parseGitHubResource(value, resource);
        if (!identity || !repositoryIdentity || identity.owner !== repositoryIdentity.owner || identity.repository !== repositoryIdentity.repository) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...hostPath, field],
            message: `${field} must be a canonical GitHub ${resource} URL for the matrix repository`,
          });
          continue;
        }
        if (seen.has(identity.key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...hostPath, field],
            message: `duplicate ${field} attribution`,
          });
        }
        seen.add(identity.key);
      }

      const { artifactRoot, artifactPaths, committedPaths, sentinel } = row.safety;
      const isBelowArtifactRoot = (path: string) => path.startsWith(`${artifactRoot}/`);
      for (const [artifactIndex, artifactPath] of artifactPaths.entries()) {
        if (!isBelowArtifactRoot(artifactPath)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...hostPath, "safety", "artifactPaths", artifactIndex],
            message: `artifact path must be below ${artifactRoot}`,
          });
        }
      }
      for (const [committedIndex, committedPath] of committedPaths.entries()) {
        if (committedPath === artifactRoot || isBelowArtifactRoot(committedPath)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...hostPath, "safety", "committedPaths", committedIndex],
            message: "committed paths must not contain workflow artifacts",
          });
        }
        if (committedPath === sentinel.path) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...hostPath, "safety", "committedPaths", committedIndex],
            message: "committed paths must not contain the sentinel",
          });
        }
      }

      const isCompleted = Object.values(row.phases).every((phase) => phase.status === "passed");
      if (!isCompleted) continue;

      const requiredEvidence: Array<[boolean, string, string]> = [
        [Boolean(row.issueUrl), "issueUrl", "completed smoke rows require an issue URL"],
        [Boolean(row.pullRequestUrl), "pullRequestUrl", "completed smoke rows require a pull request URL"],
        [Boolean(row.safety.commitSha), "safety.commitSha", "completed smoke rows require a commit SHA"],
        [artifactPaths.length > 0, "safety.artifactPaths", "completed smoke rows require workflow artifacts"],
        [committedPaths.length > 0, "safety.committedPaths", "completed smoke rows require committed paths"],
        [sentinel.state === "untracked", "safety.sentinel.state", "completed smoke rows require an untracked sentinel"],
        [!row.safety.checks.some((check) => check.status === "failed"), "safety.checks", "completed smoke rows cannot include failed checks"],
      ];
      for (const [condition, path, message] of requiredEvidence) {
        if (!condition) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...hostPath, ...path.split(".")],
            message,
          });
        }
      }
    }

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
