import { execFileSync } from "node:child_process";
import {
  filterActionablePullRequestsForUser,
  type ActionablePullRequest,
} from "./actionable-github";
import { formatGitHubAuthDiagnostics, resolveGitHubToken } from "./github-auth";

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

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

type ListPullRequestsToolOptions = {
  actionable: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
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

function createGitHubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "prs-cli",
  };
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  errorMessage: string
): Promise<T> {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(
      `${errorMessage} (${response.status ?? "unknown"} ${response.statusText ?? "error"}).`
    );
  }

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
  const tokenResolution = resolveGitHubToken({
    env,
    repoRoot: options.repoRoot,
    runCommand: commandRunner,
    spawnSync: options.spawnSyncImpl,
  });
  const token = tokenResolution.token;
  if (!token) {
    return {
      status: "blocked",
      reason: "github-auth-required",
      message:
        `GitHub authentication is required for \`prs tool pr list --actionable --json\`.\n${formatGitHubAuthDiagnostics(tokenResolution.diagnostics)}`,
      nextAction:
        "Set GH_TOKEN or GITHUB_TOKEN in the repository environment, or authenticate gh in the shell that runs prs.",
    };
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

  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = createGitHubHeaders(token);
  const currentUser = await fetchJson<{ login?: string }>(
    fetchImpl,
    "https://api.github.com/user",
    headers,
    "Failed to fetch the authenticated GitHub user"
  );
  if (!currentUser.login) {
    throw new Error("GitHub user response did not include a login.");
  }

  const pullPayload = await fetchJson<Array<Parameters<typeof normalizePullRequest>[0]>>(
    fetchImpl,
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/pulls?state=open&per_page=100`,
    headers,
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
