import { execFileSync } from "node:child_process";
import {
  filterActionableIssuesForUser,
  type ActionableIssue,
} from "./actionable-github";
import { createGitHubClient, type GitHubClient, type GitHubCommandRunner } from "./github-client";
import { ISSUE_PLAN_COMMENT_MARKER, startsWithManagedMarker } from "@prs/contracts";

export type IssueListToolResult =
  | {
      status: "ready";
      actionable: boolean;
      currentUser: string;
      issues: ActionableIssue[];
      source: "github-api";
    }
  | {
      status: "blocked";
      reason: "github-auth-required" | "not-github";
      message: string;
      nextAction: string;
    };

type GitHubRequest = (endpoint: string) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

type ListIssuesToolOptions = {
  actionable: boolean;
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

function pullRequestLinksIssue(
  pullRequest: { title?: string; body?: string | null },
  issueNumber: number
): boolean {
  const text = `${pullRequest.title ?? ""}\n${pullRequest.body ?? ""}`;
  const escapedNumber = String(issueNumber);
  const directReference = new RegExp(`(?:^|\\s|\\()#${escapedNumber}(?:\\b|\\))`, "i");
  const closingReference = new RegExp(
    `(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+(?:[\\w.-]+/[\\w.-]+)?#${escapedNumber}\\b`,
    "i"
  );

  return directReference.test(text) || closingReference.test(text);
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

export async function listIssuesTool(
  options: ListIssuesToolOptions
): Promise<IssueListToolResult> {
  const env = options.env ?? process.env;
  const commandRunner = options.runCommand ?? runCommand;
  let client: GitHubClient;
  const blocked = (detail: string): IssueListToolResult => ({
    status: "blocked", reason: "github-auth-required",
    message: `GitHub authentication is required for \`prs tool issue list --actionable --json\`.\n${detail}`,
    nextAction: "Install gh and authenticate with gh auth login --hostname github.com for the selected account.",
  });
  try {
    client = createGitHubClient({ env, repoRoot: options.repoRoot, runCommand: options.runGitHubCommand, spawnSync: options.spawnSyncImpl });
  } catch (error) {
    return blocked(error instanceof Error ? error.message : "GitHub CLI unavailable.");
  }

  const remoteUrl = commandRunner("git", ["-C", options.repoRoot, "remote", "get-url", "origin"]);
  const repository = parseGitHubRepoFromRemote(remoteUrl);
  if (!repository) {
    return {
      status: "blocked",
      reason: "not-github",
      message: "The origin remote is not a GitHub repository.",
      nextAction: "Configure a GitHub origin remote or set forge.type to none for this repository.",
    };
  }

  const request = options.request ?? client.request;
  let currentUser: { login?: string };
  try {
    currentUser = await requestJson<{ login?: string }>(request, "user", "Failed to fetch the authenticated GitHub user");
  } catch (error) {
    return blocked(error instanceof Error ? error.message : "GitHub authentication failed.");
  }
  if (!currentUser.login) {
    throw new Error("GitHub user response did not include a login.");
  }

  const issuePayload = await requestJson<Array<Parameters<typeof normalizeIssue>[0]>>(
    request,
    `repos/${repository.owner}/${repository.repo}/issues?state=open&per_page=100`,
    "Failed to list open GitHub issues"
  );
  const pullPayload = await requestJson<Array<{ title?: string; body?: string | null }>>(
    request,
    `repos/${repository.owner}/${repository.repo}/pulls?state=open&per_page=100`,
    "Failed to list open GitHub pull requests"
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

  const issues = issuePayloadOnly
    .map((issue) =>
      normalizeIssue(
        issue,
        pullPayload.some((pullRequest) =>
          pullRequestLinksIssue(pullRequest, issue.number as number)
        ),
        issueHasPlanComment(commentsByIssueNumber.get(issue.number as number) ?? [])
      )
    )
    .filter((issue): issue is ActionableIssue => issue !== undefined);

  return {
    status: "ready",
    actionable: options.actionable,
    currentUser: currentUser.login,
    issues: options.actionable
      ? filterActionableIssuesForUser(issues, currentUser.login)
      : issues,
    source: "github-api",
  };
}
