import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import type { IssuePullRequestLinks } from "./issue-pr-links";
import { createIssuePullRequestLinks } from "./issue-pr-links";
import { loadResolvedRepositoryConfig } from "./config";
import { execFileSync } from "node:child_process";
import {
  filterActionableIssuesForUser,
  type ActionableIssue,
} from "./actionable-github";
import { createGitHubClient, type GitHubClient, type GitHubCommandRunner } from "./github-client";
import { normalizeGitHubAuthFailure } from "./github-auth-failure";
import { ISSUE_PLAN_COMMENT_MARKER, startsWithManagedMarker } from "@prs/contracts";

import type { IssueListToolResult } from "./issue-list-tool";

type GitHubRequest = (endpoint: string) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

export type ListIssuesToolOptions = {
  actionable: boolean;
  config?: ResolvedRepositoryConfigType;
  links?: IssuePullRequestLinks;
  env?: Record<string, string | undefined>;
  request?: GitHubRequest;
  runGitHubCommand?: GitHubCommandRunner;
  repoRoot: string;
  runCommand?: (command: string, args: string[]) => string;
  spawnSyncImpl?: (command: string, args: string[]) => { status?: number | null; error?: Error };
};

function runCommand(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseGitHubRepoFromRemote(remoteUrl: string): { owner: string; repo: string } | undefined {
  const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

async function requestJson<T>(request: GitHubRequest, endpoint: string, errorMessage: string): Promise<T> {
  const response = await request(endpoint);
  if (!response.ok) throw new Error(`${errorMessage} (${response.status ?? "unknown"} ${response.statusText ?? "error"}).`);
  return (await response.json()) as T;
}

function normalizeStringArray(values: Array<{ login?: string } | undefined> | undefined): string[] {
  return (values ?? [])
    .map((value) => value?.login?.trim())
    .filter((value): value is string => Boolean(value));
}

function normalizeLabels(values: Array<{ name?: string } | undefined> | undefined): string[] {
  return (values ?? [])
    .map((value) => value?.name?.trim())
    .filter((value): value is string => Boolean(value));
}

function isCanonicalGitHubIssueUrl(value: string | undefined): value is string {
  return Boolean(value?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/));
}

function issueHasPlanComment(comments: Array<{ body?: string }>): boolean {
  return comments.some((comment) =>
    startsWithManagedMarker(comment.body ?? "", [ISSUE_PLAN_COMMENT_MARKER])
  );
}

function normalizeIssue(
  payload: {
    number?: number;
    title?: string;
    html_url?: string;
    user?: { login?: string };
    assignees?: Array<{ login?: string }>;
    labels?: Array<{ name?: string }>;
    updated_at?: string;
    pull_request?: unknown;
  },
  hasLinkedOpenPullRequest: boolean,
  hasPrsPlan: boolean
): ActionableIssue | undefined {
  if (
    payload.pull_request ||
    !payload.number ||
    !payload.title ||
    !isCanonicalGitHubIssueUrl(payload.html_url) ||
    !payload.user?.login ||
    !payload.updated_at
  ) {
    return undefined;
  }

  return {
    number: payload.number,
    title: payload.title,
    url: payload.html_url,
    author: payload.user.login,
    assignees: normalizeStringArray(payload.assignees),
    labels: normalizeLabels(payload.labels),
    updatedAt: payload.updated_at,
    hasLinkedOpenPullRequest,
    hasPrsPlan,
  };
}

export async function listGitHubIssues(
  options: ListIssuesToolOptions
): Promise<IssueListToolResult> {
  const config = options.config ?? loadResolvedRepositoryConfig(options.repoRoot);
  if (options.actionable && config.forge.type === "none") return {
    status: "blocked", reason: "issue-pr-links-unavailable",
    message: "Cannot select actionable issues while the repository forge is disabled.",
    nextAction: "Configure forge.type to github before selecting actionable issues.",
  };
  const env = options.env ?? process.env;
  const commandRunner = options.runCommand ?? runCommand;
  let client: GitHubClient;
  const blocked = (error: unknown, fallbackMessage: string): IssueListToolResult => {
    const failure = normalizeGitHubAuthFailure(error, fallbackMessage);
    return {
      status: "blocked",
      reason: failure.reason,
      message: `GitHub authentication is required for \`prs tool issue list --actionable --json\`.\n${failure.message}`,
      nextAction: failure.nextAction,
    };
  };
  try {
    client = createGitHubClient({ env, repoRoot: options.repoRoot, runCommand: options.runGitHubCommand, spawnSync: options.spawnSyncImpl });
  } catch (error) {
    return blocked(error, "GitHub CLI unavailable.");
  }

  const remoteUrl = commandRunner("git", ["-C", options.repoRoot, "remote", "get-url", "origin"]);
  const repository = parseGitHubRepoFromRemote(remoteUrl);
  if (!repository) {
    return {
      status: "blocked",
      reason: "not-github",
      message: "The origin remote is not a GitHub repository.",
      nextAction: "Configure a GitHub origin remote or set issueTracker.type to none for this repository.",
    };
  }

  const request = options.request ?? client.request;
  let currentUser: { login?: string };
  try {
    currentUser = await requestJson<{ login?: string }>(request, "user", "Failed to fetch the authenticated GitHub user");
  } catch (error) {
    return blocked(error, "GitHub authentication failed.");
  }
  if (!currentUser.login) {
    throw new Error("GitHub user response did not include a login.");
  }

  const issuePayload = await requestJson<Array<Parameters<typeof normalizeIssue>[0]>>(
    request,
    `repos/${repository.owner}/${repository.repo}/issues?state=open&per_page=100`,
    "Failed to list open GitHub issues"
  );
  const issuePayloadOnly = issuePayload.filter((issue) => !issue.pull_request && issue.number);
  const commentsByIssue = await Promise.all(
    issuePayloadOnly.map(async (issue) => ({
      number: issue.number as number,
      comments: await requestJson<Array<{ body?: string }>>(
        request,
        `repos/${repository.owner}/${repository.repo}/issues/${issue.number}/comments?per_page=100`,
        `Failed to list comments for GitHub issue #${issue.number}`
      ),
    }))
  );
  const commentsByIssueNumber = new Map(
    commentsByIssue.map((entry) => [entry.number, entry.comments])
  );

  const links = options.links ?? createIssuePullRequestLinks(options.repoRoot, config);
  const linkResults = await Promise.all(issuePayloadOnly.map(issue => links.findLinkedPullRequests({
    provider: "github", scope: `${repository.owner}/${repository.repo}`, key: String(issue.number),
    url: `https://github.com/${repository.owner}/${repository.repo}/issues/${issue.number}`,
  })));
  const unavailable = linkResults.find(result => result.status === "unavailable")
    ?? (config.forge.type === "none" ? {status: "unavailable" as const, reason: "forge-disabled"} : undefined);
  if (options.actionable && unavailable) return {
    status: "blocked", reason: "issue-pr-links-unavailable",
    message: `Cannot select actionable issues without linked PR evidence: ${unavailable.reason}.`,
    nextAction: "Configure both forge.type and issueTracker.type to github before selecting actionable issues.",
  };
  const issues = issuePayloadOnly.map((issue, index) => {
    const result = linkResults[index];
    return normalizeIssue(issue, result.status === "available" && result.pullRequests.some(pr => pr.state === "open"
      && pr.url.toLowerCase().startsWith(`https://github.com/${repository.owner}/${repository.repo}/pull/`.toLowerCase())),
      issueHasPlanComment(commentsByIssueNumber.get(issue.number as number) ?? []));
  }).filter((issue): issue is ActionableIssue => issue !== undefined);

  return {
    status: "ready",
    actionable: options.actionable,
    currentUser: currentUser.login,
    issues: options.actionable
      ? filterActionableIssuesForUser(issues, currentUser.login)
      : issues,
    source: "github-api",
    linkedPullRequestsStatus: unavailable ?? {status: "available"},
  };
}
