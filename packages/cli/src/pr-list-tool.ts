import { createRepositoryForge } from "./forge";
import { loadResolvedRepositoryConfig } from "./config";
import type { RepositoryForge } from "./forge";
import type { ActionablePullRequest } from "./actionable-github";

export type PullRequestListToolResult =
  | {
      status: "ready";
      actionable: boolean;
      currentUser: string;
      pullRequests: ActionablePullRequest[];
      source: "github-api";
    }
  | {
      status: "blocked";
      reason: "github-auth-required" | "github-credential-store-inaccessible" | "not-github" | "forge-disabled";
      message: string;
      nextAction: string;
    };

export async function listPullRequestsTool(options: { actionable: boolean; repoRoot: string; forge?: Pick<RepositoryForge, "listPullRequests"> }): Promise<PullRequestListToolResult> {
  return (options.forge ?? createRepositoryForge(options.repoRoot, loadResolvedRepositoryConfig(options.repoRoot))).listPullRequests({ actionable: options.actionable });
}
