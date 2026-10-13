import type { IssueReference } from "./issue-tracker";
import type { IssuePullRequestLinks } from "./issue-pr-links";
import { listIssueLinkedPullRequestsForRepoRoot, parseGitHubRepoFromRemote } from "./github-api";

export function createGitHubIssuePullRequestLinks(repoRoot: string): IssuePullRequestLinks {
  function supported(issue: IssueReference): boolean {
    if (issue.provider !== "github" || !/^[1-9]\d*$/.test(issue.key) || !Number.isSafeInteger(Number(issue.key))) return false;
    const {owner, repo} = parseGitHubRepoFromRemote(repoRoot);
    const scope = `${owner}/${repo}`;
    return issue.scope.toLowerCase() === scope.toLowerCase()
      && issue.url.toLowerCase() === `https://github.com/${scope}/issues/${issue.key}`.toLowerCase();
  }
  return {
    async findLinkedPullRequests(issue) {
      if (!supported(issue)) return {status: "unavailable", reason: "unsupported-issue-reference"};
      return {status: "available", pullRequests: await listIssueLinkedPullRequestsForRepoRoot(repoRoot, Number(issue.key))};
    },
    formatClosingReference(issue) { return supported(issue) ? `#${issue.key}` : undefined; },
  };
}
