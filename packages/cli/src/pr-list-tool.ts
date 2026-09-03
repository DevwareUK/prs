import { execFileSync } from "node:child_process";
import {
  filterActionablePullRequestsForUser,
  type ActionablePullRequest,
} from "./actionable-github";
import { createGitHubClient, type GitHubClient, type GitHubCommandRunner } from "./github-client";

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

type ListPullRequestsToolOptions = {
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

function isConflictState(value: unknown): boolean {
  return value === false || value === "dirty" || value === "blocked";
}

function isCanonicalGitHubPullRequestUrl(value: string | undefined): value is string {
  return Boolean(value?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/));
}

function normalizePullRequest(payload: {
  number?: number;
  title?: string;
  html_url?: string;
  user?: { login?: string };
  assignees?: Array<{ login?: string }>;
  requested_reviewers?: Array<{ login?: string }>;
  head?: { ref?: string };
  labels?: Array<{ name?: string }>;
  updated_at?: string;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
}): ActionablePullRequest | undefined {
  if (
    !payload.number ||
    !payload.title ||
    !isCanonicalGitHubPullRequestUrl(payload.html_url) ||
    !payload.user?.login ||
    !payload.head?.ref ||
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
    reviewRequestedFrom: normalizeStringArray(payload.requested_reviewers),
    headRefName: payload.head.ref,
    labels: normalizeLabels(payload.labels),
    updatedAt: payload.updated_at,
    hasConflicts: isConflictState(payload.mergeable) || isConflictState(payload.mergeable_state),
    hasFailedChecks: false,
    hasUnresolvedReviewComments: false,
    hasPrsTestSuggestions: false,
  };
}

export async function listPullRequestsTool(
  options: ListPullRequestsToolOptions
): Promise<PullRequestListToolResult> {
  const env = options.env ?? process.env;
  const commandRunner = options.runCommand ?? runCommand;
  let client: GitHubClient;
  const blocked = (detail: string): PullRequestListToolResult => ({
    status: "blocked", reason: "github-auth-required",
    message: `GitHub authentication is required for \`prs tool pr list --actionable --json\`.\n${detail}`,
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

  const pullPayload = await requestJson<Array<Parameters<typeof normalizePullRequest>[0]>>(
    request,
    `repos/${repository.owner}/${repository.repo}/pulls?state=open&per_page=100`,
    "Failed to list open GitHub pull requests"
  );
  const pullRequests = pullPayload
    .map(normalizePullRequest)
    .filter((pullRequest): pullRequest is ActionablePullRequest => pullRequest !== undefined);

  return {
    status: "ready",
    actionable: options.actionable,
    currentUser: currentUser.login,
    pullRequests: options.actionable
      ? filterActionablePullRequestsForUser(pullRequests, currentUser.login)
      : pullRequests,
    source: "github-api",
  };
}
