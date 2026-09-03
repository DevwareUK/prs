import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import type {
  AuditTarget,
  CreatePullRequestInput,
  CreatePullRequestReviewInput,
  CreatedPullRequestRecord,
  CreatedIssueRecord,
  IssueDetails,
  IssueLinkedPullRequest,
  IssuePlanComment,
  OpenPullRequestChange,
  PullRequestCheckSignal,
  PullRequestDetails,
  RepositoryComment,
  PullRequestReviewComment,
  PullRequestReviewThreadDetails,
  RepositoryForge,
} from "./forge";
import { AUDIT_COMMENT_MARKER } from "./audit-artifacts";
import { createGitHubClient, requestGitHub } from "./github-client";
import { ISSUE_PLAN_COMMENT_MARKER, startsWithManagedMarker } from "@prs/contracts";

function runCommand(
  command: string,
  args: string[],
  errorMessage: string
): string {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error: unknown) {
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : undefined;
    const detail = stderr ? ` ${stderr}` : "";
    throw new Error(`${errorMessage}${detail}`);
  }
}

function parseGitHubRepoFromRemote(repoRoot: string): { owner: string; repo: string } {
  const remoteUrl = runCommand(
    "git",
    ["-C", repoRoot, "remote", "get-url", "origin"],
    "Failed to resolve the origin remote."
  );

  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error("Could not determine the GitHub repository from the origin remote.");
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function canUseGitHub(repoRoot: string): boolean {
  const { owner, repo } = parseGitHubRepoFromRemote(repoRoot);
  createGitHubClient({ repoRoot }).run(
    ["api", `repos/${owner}/${repo}`, "--hostname", "github.com", "--jq", ".id"],
    "GitHub authentication failed."
  );
  return true;
}

function parseIssuePlanCommentPayload(
  payload: {
    id?: number;
    body?: string | null;
    html_url?: string;
    updated_at?: string;
  },
  errorMessage: string
): IssuePlanComment {
  if (!payload.id || !payload.body || !payload.html_url || !payload.updated_at) {
    throw new Error(errorMessage);
  }

  return {
    id: payload.id,
    body: payload.body,
    url: payload.html_url,
    updatedAt: payload.updated_at,
  };
}

function parseRepositoryCommentPayload(
  payload: {
    id?: number;
    body?: string | null;
    html_url?: string;
    created_at?: string;
    updated_at?: string;
    user?: { login?: string; type?: string };
  },
  errorMessage: string
): RepositoryComment {
  if (!payload.id || !payload.body || !payload.html_url || !payload.updated_at) {
    throw new Error(errorMessage);
  }

  return {
    id: payload.id,
    body: payload.body,
    url: payload.html_url,
    createdAt: payload.created_at ?? payload.updated_at,
    updatedAt: payload.updated_at,
    author: payload.user?.login ?? "unknown",
    isBot: payload.user?.type === "Bot",
  };
}

function parseCreatedIssueRecordPayload(
  payload: {
    number?: number;
    title?: string;
    html_url?: string;
  },
  errorMessage: string,
  status: CreatedIssueRecord["status"]
): CreatedIssueRecord {
  if (!payload.number || !payload.title || !payload.html_url) {
    throw new Error(errorMessage);
  }

  return {
    number: payload.number,
    title: payload.title,
    url: payload.html_url,
    status,
  };
}

function appendRunLog(
  outputLogPath: string,
  command: string,
  args: string[],
  stdout: string,
  stderr: string
): void {
  const renderedCommand = [command, ...args]
    .map((value) => (value.includes(" ") ? JSON.stringify(value) : value))
    .join(" ");

  appendFileSync(outputLogPath, [`$ ${renderedCommand}`, stdout, stderr, ""].join("\n"), "utf8");
}

function runTrackedCommand(
  command: string,
  args: string[],
  errorMessage: string,
  outputLogPath: string,
  cwd?: string
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["inherit", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  appendRunLog(outputLogPath, command, args, stdout, stderr);

  if (stdout) {
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
  }

  if (result.error) {
    throw new Error(`${errorMessage} ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
  }

  return stdout;
}

async function listIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
  repoRoot?: string
): Promise<RepositoryComment[]> {

  const comments: RepositoryComment[] = [];
  let page = 1;

  while (true) {
    const pageParameter = page === 1 ? "" : `&page=${page}`;
    const response = await requestGitHub(repoRoot,
      `repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100${pageParameter}`
    );

    if (!response.ok) {
      throw new Error(
        `Failed to list comments for GitHub issue #${issueNumber} (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as Array<{
      id?: number;
      body?: string | null;
      html_url?: string;
      created_at?: string;
      updated_at?: string;
      user?: { login?: string; type?: string };
    }>;

    comments.push(
      ...payload
        .filter((comment) => comment.id && comment.body && comment.html_url && comment.updated_at)
        .map((comment) => ({
          id: comment.id as number,
          body: comment.body as string,
          url: comment.html_url as string,
          createdAt: (comment.created_at ?? comment.updated_at) as string,
          updatedAt: comment.updated_at as string,
          author: comment.user?.login ?? "unknown",
          isBot: comment.user?.type === "Bot",
        }))
    );

    if (payload.length < 100) {
      return comments;
    }

    page += 1;
  }
}

async function assertAuditTargetMatchesType(
  owner: string,
  repo: string,
  target: AuditTarget,
  repoRoot?: string
): Promise<void> {

  if (target.type === "pull-request") {
    const response = await requestGitHub(repoRoot,
      `repos/${owner}/${repo}/pulls/${target.number}`
    );
    if (!response.ok) {
      throw new Error(
        `GitHub pull request #${target.number} could not be validated for audit publication (${response.status} ${response.statusText}).`
      );
    }
    return;
  }

  const response = await requestGitHub(repoRoot,
    `repos/${owner}/${repo}/issues/${target.number}`
  );
  if (!response.ok) {
    throw new Error(
      `GitHub issue #${target.number} could not be validated for audit publication (${response.status} ${response.statusText}).`
    );
  }

  const payload = (await response.json()) as { pull_request?: unknown };
  if (payload.pull_request) {
    throw new Error(
      `GitHub issue #${target.number} is a pull request. Use --pr ${target.number} for audit publication.`
    );
  }
}

async function fetchIssueWithApi(
  owner: string,
  repo: string,
  issueNumber: number,
  repoRoot?: string
): Promise<IssueDetails> {

  const response = await requestGitHub(repoRoot,
    `repos/${owner}/${repo}/issues/${issueNumber}`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch GitHub issue #${issueNumber} via GitHub API (${response.status} ${response.statusText}).`
    );
  }

  const payload = (await response.json()) as {
    title?: string;
    body?: string | null;
    html_url?: string;
  };

  if (!payload.title || !payload.html_url) {
    throw new Error(`GitHub issue #${issueNumber} did not return the required fields.`);
  }

  return {
    title: payload.title,
    body: payload.body ?? "",
    url: payload.html_url,
  };
}

async function fetchPullRequestWithApi(
  owner: string,
  repo: string,
  prNumber: number,
  repoRoot?: string
): Promise<PullRequestDetails> {

  const response = await requestGitHub(repoRoot,
    `repos/${owner}/${repo}/pulls/${prNumber}`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch GitHub pull request #${prNumber} via GitHub API (${response.status} ${response.statusText}).`
    );
  }

  const payload = (await response.json()) as {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    base?: { ref?: string };
    head?: { ref?: string; sha?: string };
    draft?: boolean;
    mergeable?: boolean | null;
    mergeable_state?: string | null;
  };

  if (
    !payload.number ||
    !payload.title ||
    !payload.html_url ||
    !payload.base?.ref ||
    !payload.head?.ref
  ) {
    throw new Error(`GitHub pull request #${prNumber} did not return the required fields.`);
  }

  return {
    number: payload.number,
    title: payload.title,
    body: payload.body ?? "",
    url: payload.html_url,
    baseRefName: payload.base.ref,
    headRefName: payload.head.ref,
    headSha: payload.head.sha,
    isDraft: payload.draft,
    mergeable: payload.mergeable,
    mergeableState: payload.mergeable_state,
  };
}

async function listPullRequestChecks(
  owner: string,
  repo: string,
  prNumber: number,
  repoRoot?: string
): Promise<PullRequestCheckSignal[]> {
  const pullRequest = await fetchPullRequestWithApi(owner, repo, prNumber, repoRoot);
  if (!pullRequest.headSha) {
    return [];
  }

  const checkRunsPromise = requestGitHub(repoRoot,
    `repos/${owner}/${repo}/commits/${pullRequest.headSha}/check-runs?per_page=100`
  );
  const statusesPromise = requestGitHub(repoRoot,
    `repos/${owner}/${repo}/commits/${pullRequest.headSha}/status`
  );

  const [checkRunsResponse, statusesResponse] = await Promise.allSettled([
    checkRunsPromise,
    statusesPromise,
  ]);
  const signals: PullRequestCheckSignal[] = [];
  const failures: string[] = [];

  if (checkRunsResponse.status === "fulfilled" && checkRunsResponse.value.ok) {
    const payload = (await checkRunsResponse.value.json()) as {
      check_runs?: Array<{
        name?: string;
        status?: string;
        conclusion?: string | null;
        html_url?: string;
      }>;
    };
    signals.push(
      ...(payload.check_runs ?? [])
        .filter((checkRun) => checkRun.name)
        .map((checkRun) => ({
          name: checkRun.name as string,
          status: normalizeCheckStatus(checkRun.status),
          conclusion: normalizeCheckConclusion(checkRun.conclusion),
          url: checkRun.html_url,
        }))
    );
  } else {
    failures.push("check runs");
  }

  if (statusesResponse.status === "fulfilled" && statusesResponse.value.ok) {
    const payload = (await statusesResponse.value.json()) as {
      statuses?: Array<{
        context?: string;
        state?: string;
        target_url?: string | null;
      }>;
    };
    signals.push(
      ...(payload.statuses ?? [])
        .filter((status) => status.context)
        .map((status) => ({
          name: status.context as string,
          status: status.state === "pending" ? "pending" : "completed",
          conclusion: normalizeStatusConclusion(status.state),
          url: status.target_url ?? undefined,
        }))
    );
  } else {
    failures.push("commit statuses");
  }

  if (failures.length === 2) {
    throw new Error(
      `Failed to fetch GitHub checks for pull request #${prNumber}.`
    );
  }

  return signals;
}

function normalizeCheckStatus(status: string | undefined): PullRequestCheckSignal["status"] {
  if (status === "queued" || status === "in_progress") {
    return status === "in_progress" ? "in-progress" : status;
  }

  if (status === "completed" || status === "pending") {
    return status;
  }

  return "unknown";
}

function normalizeCheckConclusion(
  conclusion: string | null | undefined
): PullRequestCheckSignal["conclusion"] | undefined {
  if (!conclusion) {
    return undefined;
  }

  if (
    conclusion === "success" ||
    conclusion === "failure" ||
    conclusion === "neutral" ||
    conclusion === "cancelled" ||
    conclusion === "skipped" ||
    conclusion === "timed_out" ||
    conclusion === "action_required"
  ) {
    return conclusion.replaceAll("_", "-") as PullRequestCheckSignal["conclusion"];
  }

  return "unknown";
}

function normalizeStatusConclusion(
  state: string | undefined
): PullRequestCheckSignal["conclusion"] | undefined {
  if (state === "success") {
    return "success";
  }

  if (state === "failure" || state === "error") {
    return "failure";
  }

  return undefined;
}

async function listOpenPullRequests(
  owner: string,
  repo: string,
  repoRoot?: string
): Promise<Array<Omit<OpenPullRequestChange, "files">>> {

  const response = await requestGitHub(repoRoot,
    `repos/${owner}/${repo}/pulls?state=open&per_page=100`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to list GitHub pull requests (${response.status} ${response.statusText}).`
    );
  }

  const payload = (await response.json()) as Array<{
    number?: number;
    title?: string;
    html_url?: string;
    base?: { ref?: string };
    head?: { ref?: string };
  }>;

  return payload
    .filter(
      (item) =>
        item.number &&
        item.title &&
        item.html_url &&
        item.base?.ref &&
        item.head?.ref
    )
    .map((item) => ({
      number: item.number as number,
      title: item.title as string,
      url: item.html_url as string,
      baseRefName: item.base?.ref as string,
      headRefName: item.head?.ref as string,
    }));
}

async function listPullRequestFiles(
  owner: string,
  repo: string,
  prNumber: number,
  repoRoot?: string
): Promise<string[]> {

  const response = await requestGitHub(repoRoot,
    `repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to list files for GitHub pull request #${prNumber} (${response.status} ${response.statusText}).`
    );
  }

  const payload = (await response.json()) as Array<{ filename?: string }>;
  return payload
    .map((file) => file.filename?.trim())
    .filter((filename): filename is string => Boolean(filename));
}

async function listPullRequestReviewComments(
  owner: string,
  repo: string,
  prNumber: number,
  repoRoot?: string
): Promise<PullRequestReviewComment[]> {

  const response = await requestGitHub(repoRoot,
    `repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to list review comments for GitHub pull request #${prNumber} (${response.status} ${response.statusText}).`
    );
  }

  const payload = (await response.json()) as Array<{
    id?: number;
    body?: string | null;
    path?: string;
    line?: number | null;
    original_line?: number | null;
    start_line?: number | null;
    original_start_line?: number | null;
    side?: string | null;
    start_side?: string | null;
    diff_hunk?: string | null;
    html_url?: string;
    user?: { login?: string; type?: string };
    created_at?: string;
    updated_at?: string;
    in_reply_to_id?: number | null;
  }>;

  return payload
    .filter(
      (comment) =>
        comment.id &&
        comment.body &&
        comment.path &&
        comment.html_url &&
        comment.user?.login &&
        comment.created_at &&
        comment.updated_at
    )
    .map((comment) => ({
      id: comment.id as number,
      body: comment.body as string,
      path: comment.path as string,
      line: comment.line ?? undefined,
      originalLine: comment.original_line ?? undefined,
      startLine: comment.start_line ?? undefined,
      originalStartLine: comment.original_start_line ?? undefined,
      side: comment.side ?? undefined,
      startSide: comment.start_side ?? undefined,
      diffHunk: comment.diff_hunk ?? undefined,
      url: comment.html_url as string,
      author: comment.user?.login as string,
      authorIsBot: comment.user?.type === "Bot",
      createdAt: comment.created_at as string,
      updatedAt: comment.updated_at as string,
      inReplyToId: comment.in_reply_to_id ?? undefined,
    }));
}

async function postGitHubGraphQL<T>(
  repoRoot: string | undefined,
  query: string,
  variables: Record<string, unknown>,
  errorMessage: string
): Promise<T> {

  const response = await requestGitHub(repoRoot, "graphql", {
    method: "POST",
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    throw new Error(`${errorMessage} (${response.status} ${response.statusText}).`);
  }

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) {
    const details = payload.errors
      .map((error) => error.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(details ? `${errorMessage} ${details}` : errorMessage);
  }

  if (!payload.data) {
    throw new Error(`${errorMessage} GitHub returned no data.`);
  }

  return payload.data;
}

function parseReviewThreadCommentPayload(comment: {
  databaseId?: number | null;
  body?: string | null;
  path?: string | null;
  line?: number | null;
  originalLine?: number | null;
  startLine?: number | null;
  originalStartLine?: number | null;
  diffHunk?: string | null;
  url?: string | null;
  author?: { login?: string | null } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  replyTo?: { databaseId?: number | null } | null;
  commit?: { oid?: string | null } | null;
}): PullRequestReviewComment | undefined {
  if (
    !comment.databaseId ||
    !comment.body ||
    !comment.path ||
    !comment.url ||
    !comment.author?.login ||
    !comment.createdAt ||
    !comment.updatedAt
  ) {
    return undefined;
  }

  return {
    id: comment.databaseId,
    body: comment.body,
    path: comment.path,
    line: comment.line ?? undefined,
    originalLine: comment.originalLine ?? undefined,
    startLine: comment.startLine ?? undefined,
    originalStartLine: comment.originalStartLine ?? undefined,
    diffHunk: comment.diffHunk ?? undefined,
    url: comment.url,
    author: comment.author.login,
    authorIsBot: comment.author.login.endsWith("[bot]"),
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    inReplyToId: comment.replyTo?.databaseId ?? undefined,
    commitOid: comment.commit?.oid ?? undefined,
  };
}

async function listPullRequestReviewThreads(
  owner: string,
  repo: string,
  prNumber: number,
  repoRoot?: string
): Promise<PullRequestReviewThreadDetails[]> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              isResolved
              isOutdated
              comments(first: 100) {
                nodes {
                  databaseId
                  body
                  path
                  line
                  originalLine
                  startLine
                  originalStartLine
                  diffHunk
                  url
                  author {
                    login
                  }
                  createdAt
                  updatedAt
                  replyTo {
                    databaseId
                  }
                  commit {
                    oid
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  type ReviewThreadsResponse = {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          pageInfo?: {
            hasNextPage?: boolean;
            endCursor?: string | null;
          };
          nodes?: Array<{
            id?: string | null;
            isResolved?: boolean | null;
            isOutdated?: boolean | null;
            comments?: {
              nodes?: Array<Parameters<typeof parseReviewThreadCommentPayload>[0]>;
            } | null;
          } | null>;
        } | null;
      } | null;
    } | null;
  };
  const threads: PullRequestReviewThreadDetails[] = [];
  let after: string | undefined;

  while (true) {
    const data = await postGitHubGraphQL<ReviewThreadsResponse>(
      repoRoot,
      query,
      {
        owner,
        repo,
        number: prNumber,
        after,
      },
      `Failed to fetch review threads for GitHub pull request #${prNumber}.`
    );
    const reviewThreads = data.repository?.pullRequest?.reviewThreads;
    for (const thread of reviewThreads?.nodes ?? []) {
      if (!thread?.id) {
        continue;
      }

      const comments = (thread.comments?.nodes ?? [])
        .map(parseReviewThreadCommentPayload)
        .filter((comment): comment is PullRequestReviewComment => comment !== undefined);
      const rootComment = comments[0];
      if (!rootComment) {
        continue;
      }

      threads.push({
        threadId: rootComment.id,
        nodeId: thread.id,
        isResolved: thread.isResolved === true,
        isOutdated: thread.isOutdated === true,
        comments,
      });
    }

    if (!reviewThreads?.pageInfo?.hasNextPage || !reviewThreads.pageInfo.endCursor) {
      return threads;
    }

    after = reviewThreads.pageInfo.endCursor;
  }
}

async function listIssueLinkedPullRequests(
  owner: string,
  repo: string,
  issueNumber: number,
  repoRoot?: string
): Promise<IssueLinkedPullRequest[]> {
  type TimelineEvent = {
    event?: string;
    source?: {
      issue?: {
        number?: number;
        title?: string;
        html_url?: string;
        state?: "open" | "closed";
        pull_request?: { merged_at?: string | null };
      };
    };
  };
  const linked = new Map<number, IssueLinkedPullRequest>();
  let page = 1;

  while (true) {
    const pageParameter = page === 1 ? "" : `&page=${page}`;
    const response = await requestGitHub(repoRoot,
      `repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100${pageParameter}`
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch pull requests linked to GitHub issue #${issueNumber} (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as TimelineEvent[];
    for (const event of payload) {
      const pullRequest = event.event === "cross-referenced" ? event.source?.issue : undefined;
      if (
        !pullRequest?.pull_request ||
        !pullRequest.number ||
        !pullRequest.title ||
        !pullRequest.html_url
      ) {
        continue;
      }
      linked.set(pullRequest.number, {
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.html_url,
        state: pullRequest.pull_request.merged_at
          ? "merged"
          : pullRequest.state === "open"
            ? "open"
            : "closed",
      });
    }

    if (payload.length < 100) {
      break;
    }
    page += 1;
  }
  return [...linked.values()].sort((left, right) => left.number - right.number);
}

export async function listIssueLinkedPullRequestsForRepoRoot(
  repoRoot: string,
  issueNumber: number
): Promise<IssueLinkedPullRequest[]> {
  const { owner, repo } = parseGitHubRepoFromRemote(repoRoot);
  return listIssueLinkedPullRequests(owner, repo, issueNumber, repoRoot);
}

async function listOpenIssues(
  owner: string,
  repo: string,
  repoRoot?: string
): Promise<Array<{ number: number; title: string; url: string; body?: string }>> {
  const response = await requestGitHub(repoRoot,
    `repos/${owner}/${repo}/issues?state=open&per_page=100`
  );

  if (!response.ok) {
    throw new Error(`Failed to list GitHub issues (${response.status} ${response.statusText}).`);
  }

  const payload = (await response.json()) as Array<{
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    pull_request?: unknown;
  }>;

  return payload
    .filter((item) => !item.pull_request && item.number && item.title && item.html_url)
    .map((item) => ({
      number: item.number as number,
      title: item.title as string,
      body: item.body ?? undefined,
      url: item.html_url as string,
    }));
}

export async function listOpenGitHubIssuesForRepoRoot(
  repoRoot: string
): Promise<Array<{ number: number; title: string; url: string; body?: string }>> {

  const { owner, repo } = parseGitHubRepoFromRemote(repoRoot);
  return listOpenIssues(owner, repo, repoRoot);
}

async function createGitHubIssue(
  owner: string,
  repo: string,
  repoRoot: string | undefined,
  title: string,
  body: string,
  labels: string[]
): Promise<{ number: number; title: string; url: string }> {
  const response = await requestGitHub(repoRoot, `repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      labels,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create GitHub issue "${title}" (${response.status} ${response.statusText}).`
    );
  }

  const payload = (await response.json()) as {
    number?: number;
    title?: string;
    html_url?: string;
  };

  if (!payload.number || !payload.title || !payload.html_url) {
    throw new Error(`GitHub issue creation for "${title}" returned an incomplete payload.`);
  }

  return {
    number: payload.number,
    title: payload.title,
    url: payload.html_url,
  };
}

class GitHubRepositoryForge implements RepositoryForge {
  readonly type = "github" as const;
  private openIssuesByTitle?: Map<string, { number: number; title: string; url: string }>;

  constructor(private readonly repoRoot: string) {}

  getRepositoryIdentity() {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return {
      owner,
      name: repo,
      url: `https://github.com/${owner}/${repo}`,
    };
  }

  isAuthenticated(): boolean {
    return canUseGitHub(this.repoRoot);
  }

  async fetchIssueDetails(issueNumber: number): Promise<IssueDetails> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return fetchIssueWithApi(owner, repo, issueNumber, this.repoRoot);
  }

  async fetchIssuePlanComment(issueNumber: number): Promise<IssuePlanComment | undefined> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const comments = await listIssueComments(owner, repo, issueNumber, this.repoRoot);

    return comments
      .filter((comment) => startsWithManagedMarker(comment.body, [ISSUE_PLAN_COMMENT_MARKER]))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  }

  async fetchIssueLinkedPullRequests(
    issueNumber: number
  ): Promise<IssueLinkedPullRequest[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listIssueLinkedPullRequests(owner, repo, issueNumber, this.repoRoot);
  }

  async fetchAuditComment(target: AuditTarget): Promise<RepositoryComment | undefined> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    await assertAuditTargetMatchesType(owner, repo, target, this.repoRoot);
    const comments = await listIssueComments(owner, repo, target.number, this.repoRoot);

    return comments
      .filter((comment) => startsWithManagedMarker(comment.body, [AUDIT_COMMENT_MARKER]))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  }

  async fetchIssueComments(issueNumber: number): Promise<RepositoryComment[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listIssueComments(owner, repo, issueNumber, this.repoRoot);
  }

  async fetchPullRequestDetails(prNumber: number): Promise<PullRequestDetails> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return fetchPullRequestWithApi(owner, repo, prNumber, this.repoRoot);
  }

  async fetchPullRequestChecks(prNumber: number): Promise<PullRequestCheckSignal[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listPullRequestChecks(owner, repo, prNumber, this.repoRoot);
  }

  async listOpenPullRequestChanges(): Promise<OpenPullRequestChange[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const pullRequests = await listOpenPullRequests(owner, repo, this.repoRoot);

    return Promise.all(
      pullRequests.map(async (pullRequest) => ({
        ...pullRequest,
        files: await listPullRequestFiles(owner, repo, pullRequest.number, this.repoRoot),
      }))
    );
  }

  async fetchPullRequestIssueComments(prNumber: number): Promise<RepositoryComment[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listIssueComments(owner, repo, prNumber, this.repoRoot);
  }

  async fetchPullRequestReviewComments(prNumber: number): Promise<PullRequestReviewComment[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listPullRequestReviewComments(owner, repo, prNumber, this.repoRoot);
  }

  async fetchPullRequestReviewThreads(
    prNumber: number
  ): Promise<PullRequestReviewThreadDetails[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listPullRequestReviewThreads(owner, repo, prNumber, this.repoRoot);
  }

  async replyToPullRequestReviewThread(threadNodeId: string, body: string): Promise<void> {
    await postGitHubGraphQL(
      this.repoRoot,
      `
        mutation($threadId: ID!, $body: String!) {
          addPullRequestReviewThreadReply(input: {
            pullRequestReviewThreadId: $threadId,
            body: $body
          }) {
            comment {
              id
            }
          }
        }
      `,
      {
        threadId: threadNodeId,
        body,
      },
      "Failed to reply to the addressed GitHub pull request review thread."
    );
  }

  async resolvePullRequestReviewThread(threadNodeId: string): Promise<void> {
    await postGitHubGraphQL(
      this.repoRoot,
      `
        mutation($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread {
              id
              isResolved
            }
          }
        }
      `,
      {
        threadId: threadNodeId,
      },
      "Failed to resolve the addressed GitHub pull request review thread."
    );
  }

  async createPullRequestReview(
    input: CreatePullRequestReviewInput
  ): Promise<{ id?: number; url?: string }> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/pulls/${input.prNumber}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({
          commit_id: input.commitSha,
          event: input.event,
          body: input.body,
          comments: input.comments,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to create GitHub pull request review for #${input.prNumber} (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as {
      id?: number;
      html_url?: string;
    };

    return {
      id: payload.id,
      url: payload.html_url,
    };
  }

  async markPullRequestReadyForReview(prNumber: number): Promise<void> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/pulls/${prNumber}`
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch GitHub pull request #${prNumber} before marking it ready for review (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as {
      draft?: boolean;
      node_id?: string;
    };
    if (payload.draft === false) {
      return;
    }
    if (!payload.node_id) {
      throw new Error(
        `GitHub pull request #${prNumber} did not return a node id required for draft promotion.`
      );
    }

    await postGitHubGraphQL(
      this.repoRoot,
      `
        mutation($pullRequestId: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
            pullRequest {
              id
              isDraft
            }
          }
        }
      `,
      {
        pullRequestId: payload.node_id,
      },
      `Failed to mark GitHub pull request #${prNumber} ready for review.`
    );
  }

  async createIssuePlanComment(
    issueNumber: number,
    body: string
  ): Promise<IssuePlanComment> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to create the issue resolution plan comment for #${issueNumber} (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as {
      id?: number;
      body?: string | null;
      html_url?: string;
      updated_at?: string;
    };

    return parseIssuePlanCommentPayload(
      payload,
      `GitHub issue plan comment creation for #${issueNumber} returned an incomplete payload.`
    );
  }

  async createAuditComment(
    target: AuditTarget,
    body: string
  ): Promise<RepositoryComment> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    await assertAuditTargetMatchesType(owner, repo, target, this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/issues/${target.number}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to publish the audit comment for ${target.type} #${target.number} (${response.status} ${response.statusText}).`
      );
    }

    return parseRepositoryCommentPayload(
      (await response.json()) as {
        id?: number;
        body?: string | null;
        html_url?: string;
        created_at?: string;
        updated_at?: string;
        user?: { login?: string; type?: string };
      },
      `GitHub audit comment publication for ${target.type} #${target.number} returned an incomplete payload.`
    );
  }

  async updateIssuePlanComment(
    commentId: number,
    body: string
  ): Promise<IssuePlanComment> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to refresh the issue resolution plan comment ${commentId} (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as {
      id?: number;
      body?: string | null;
      html_url?: string;
      updated_at?: string;
    };

    return parseIssuePlanCommentPayload(
      payload,
      `GitHub issue plan comment refresh for comment ${commentId} returned an incomplete payload.`
    );
  }

  async updateIssueComment(commentId: number, body: string): Promise<RepositoryComment> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to update issue comment ${commentId} (${response.status} ${response.statusText}).`
      );
    }

    return parseRepositoryCommentPayload(
      (await response.json()) as {
        id?: number;
        body?: string | null;
        html_url?: string;
        created_at?: string;
        updated_at?: string;
        user?: { login?: string; type?: string };
      },
      `GitHub issue comment update for comment ${commentId} returned an incomplete payload.`
    );
  }

  async createDraftIssue(title: string, body: string): Promise<string> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const createdIssue = await createGitHubIssue(owner, repo, this.repoRoot, title, body, []);
    return createdIssue.url;
  }

  async updateIssue(
    issueNumber: number,
    title: string,
    body: string
  ): Promise<CreatedIssueRecord> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title, body }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to update GitHub issue #${issueNumber} (${response.status} ${response.statusText}).`
      );
    }

    return parseCreatedIssueRecordPayload(
      (await response.json()) as {
        number?: number;
        title?: string;
        html_url?: string;
      },
      `GitHub issue update for #${issueNumber} returned an incomplete payload.`,
      "existing"
    );
  }

  async createOrReuseIssue(
    title: string,
    body: string,
    labels: string[]
  ): Promise<CreatedIssueRecord> {

    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    if (!this.openIssuesByTitle) {
      const existingIssues = await listOpenIssues(owner, repo, this.repoRoot);
      this.openIssuesByTitle = new Map(
        existingIssues.map((issue) => [issue.title.trim().toLowerCase(), issue])
      );
    }

    const normalizedTitle = title.trim().toLowerCase();
    const existingIssue = this.openIssuesByTitle.get(normalizedTitle);

    if (existingIssue) {
      return {
        ...existingIssue,
        status: "existing",
      };
    }

    const createdIssue = await createGitHubIssue(owner, repo, this.repoRoot, title, body, labels);
    this.openIssuesByTitle.set(createdIssue.title.trim().toLowerCase(), createdIssue);
    return {
      ...createdIssue,
      status: "created",
    };
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<CreatedPullRequestRecord> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const client = createGitHubClient({ repoRoot: this.repoRoot });
    runTrackedCommand(
      "git",
      ["push", "-u", "origin", input.branchName],
      `Failed to push branch "${input.branchName}".`,
      input.outputLogPath,
      this.repoRoot
    );
    const prArgs = [
      "pr",
      "create",
      "--repo",
      `${owner}/${repo}`,
      "--title",
      input.title,
      ...(input.bodyFilePath
        ? ["--body-file", input.bodyFilePath]
        : ["--body", input.body]),
      "--base",
      input.baseBranch,
    ];
    const stdout = client.run(
      prArgs, "Failed to create a pull request."
    );
    appendRunLog(input.outputLogPath, "gh", prArgs, stdout, "");
    if (stdout) process.stdout.write(`${stdout}\n`);

    return {
      url: stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^https:\/\/github\.com\/.+\/pull\/\d+$/i.test(line)),
    };
  }
}

export function createGitHubRepositoryForge(repoRoot: string): RepositoryForge {
  return new GitHubRepositoryForge(repoRoot);
}
