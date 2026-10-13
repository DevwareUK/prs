import { createIssueTracker } from "./issue-tracker";
import { loadResolvedRepositoryConfig } from "./config";
import type { IssueTracker } from "./issue-tracker";
import type { ActionableIssue } from "./actionable-github";

export type IssueListToolResult =
  | { status: "ready"; actionable: boolean; currentUser: string; issues: ActionableIssue[]; source: "github-api"; linkedPullRequestsStatus: {status: "available"} | {status: "unavailable"; reason: string} }
  | { status: "blocked"; reason: "github-auth-required" | "github-credential-store-inaccessible" | "not-github" | "issue-tracker-disabled" | "issue-pr-links-unavailable"; message: string; nextAction: string };

export async function listIssuesTool(options: { actionable: boolean; repoRoot: string; tracker?: Pick<IssueTracker, "listIssues"> }): Promise<IssueListToolResult> {
  const tracker = options.tracker ?? createIssueTracker(options.repoRoot, loadResolvedRepositoryConfig(options.repoRoot));
  return tracker.listIssues({ actionable: options.actionable });
}
