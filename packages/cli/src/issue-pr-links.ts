import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import type { IssueReference } from "./issue-tracker";
import type { IssueLinkedPullRequest } from "./integration-types";
import { createGitHubIssuePullRequestLinks } from "./github-issue-pr-links";

export type LinkedPullRequestsResult =
  | {status: "available"; pullRequests: IssueLinkedPullRequest[]}
  | {status: "unavailable"; reason: string};

export interface IssuePullRequestLinks {
  findLinkedPullRequests(issue: IssueReference): Promise<LinkedPullRequestsResult>;
  formatClosingReference(issue: IssueReference): string | undefined;
}

export function createIssuePullRequestLinks(repoRoot: string, config: ResolvedRepositoryConfigType): IssuePullRequestLinks {
  const reason = config.forge.type === "none" ? "forge-disabled"
    : config.issueTracker.type === "none" ? "issue-tracker-disabled" : undefined;
  if (reason) return {
    findLinkedPullRequests: async () => ({status: "unavailable", reason}),
    formatClosingReference: () => undefined,
  };
  return createGitHubIssuePullRequestLinks(repoRoot);
}
