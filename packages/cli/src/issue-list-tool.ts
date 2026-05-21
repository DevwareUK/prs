import { execFileSync } from "node:child_process";
import {
  filterActionableIssuesForUser,
  type ActionableIssue,
} from "./actionable-github";
import { formatGitHubAuthDiagnostics, resolveGitHubToken } from "./github-auth";

const ISSUE_PLAN_MARKERS = ["<!-- prs:issue-plan -->", "<!-- git-ai:issue-plan -->"];

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

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  json(): Promise<unknown>;
}>;

type ListIssuesToolOptions = {
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

function issueHasPlanComment(comments: Array<{ body?: string }>): boolean {
  return comments.some((comment) =>
    ISSUE_PLAN_MARKERS.some((marker) => comment.body?.includes(marker))
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
    !payload.html_url ||
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
        `GitHub authentication is required for \`prs tool issue list --actionable --json\`.\n${formatGitHubAuthDiagnostics(tokenResolution.diagnostics)}`,
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

  const issuePayload = await fetchJson<Array<Parameters<typeof normalizeIssue>[0]>>(
    fetchImpl,
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/issues?state=open&per_page=100`,
    headers,
    "Failed to list open GitHub issues"
  );
  const pullPayload = await fetchJson<Array<{ title?: string; body?: string | null }>>(
    fetchImpl,
    `https://api.github.com/repos/${repository.owner}/${repository.repo}/pulls?state=open&per_page=100`,
    headers,
    "Failed to list open GitHub pull requests"
  );

  const issuePayloadOnly = issuePayload.filter((issue) => !issue.pull_request && issue.number);
  const commentsByIssue = await Promise.all(
    issuePayloadOnly.map(async (issue) => ({
      number: issue.number as number,
      comments: await fetchJson<Array<{ body?: string }>>(
        fetchImpl,
        `https://api.github.com/repos/${repository.owner}/${repository.repo}/issues/${issue.number}/comments?per_page=100`,
        headers,
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
