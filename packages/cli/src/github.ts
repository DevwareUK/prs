import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import type {
  CreatePullRequestInput,
  CreatedIssueRecord,
  IssueDetails,
  IssuePlanComment,
  PullRequestDetails,
  PullRequestReviewComment,
  RepositoryForge,
} from "./forge";

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

function canRunCommand(command: string, args: string[] = ["--version"]): boolean {
  const result = spawnSync(command, args, {
    stdio: "ignore",
  });

  return !result.error && result.status === 0;
}

function hasGitHubApiToken(): boolean {
  return Boolean(process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim());
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

function isGhAuthenticated(): boolean {
  if (!canRunCommand("gh")) {
    return false;
  }

  const result = spawnSync("gh", ["auth", "status"], {
    stdio: "ignore",
  });

  return !result.error && result.status === 0;
}

function canUseGitHub(): boolean {
  return isGhAuthenticated() || hasGitHubApiToken();
}

function tryResolveGitHubApiToken(): string | undefined {
  const envToken = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  if (!isGhAuthenticated()) {
    return undefined;
  }

  try {
    return runCommand("gh", ["auth", "token"], "Failed to read the GitHub token from gh.");
  } catch {
    return undefined;
  }
}

function getGitHubApiToken(requiredMessage: string): string {
  const token = tryResolveGitHubApiToken();
  if (!token) {
    throw new Error(requiredMessage);
  }

  return token;
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
): void {
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
}

async function listIssueComments(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<IssuePlanComment[]> {
  const token = tryResolveGitHubApiToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "git-ai-cli",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
    { headers }
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
    updated_at?: string;
  }>;

  return payload
    .filter((comment) => comment.id && comment.body && comment.html_url && comment.updated_at)
    .map((comment) => ({
      id: comment.id as number,
      body: comment.body as string,
      url: comment.html_url as string,
      updatedAt: comment.updated_at as string,
    }));
}

function tryFetchPullRequestWithGh(
  owner: string,
  repo: string,
  prNumber: number
): PullRequestDetails | undefined {
  if (!canRunCommand("gh")) {
    return undefined;
  }

  try {
    const payload = runCommand(
      "gh",
      [
        "pr",
        "view",
        String(prNumber),
        "--repo",
        `${owner}/${repo}`,
        "--json",
        "number,title,body,url,baseRefName,headRefName",
      ],
      `Failed to fetch GitHub pull request #${prNumber} with gh.`
    );

    const parsed = JSON.parse(payload) as Partial<PullRequestDetails>;
    if (
      !parsed.number ||
      !parsed.title ||
      !parsed.url ||
      !parsed.baseRefName ||
      !parsed.headRefName
    ) {
      throw new Error("Pull request payload was incomplete.");
    }

    return {
      number: parsed.number,
      title: parsed.title,
      body: parsed.body ?? "",
      url: parsed.url,
      baseRefName: parsed.baseRefName,
      headRefName: parsed.headRefName,
    };
  } catch {
    return undefined;
  }
}

function tryFetchIssueWithGh(
  owner: string,
  repo: string,
  issueNumber: number
): IssueDetails | undefined {
  if (!canRunCommand("gh")) {
    return undefined;
  }

  try {
    const payload = runCommand(
      "gh",
      ["issue", "view", String(issueNumber), "--repo", `${owner}/${repo}`, "--json", "title,body,url"],
      `Failed to fetch GitHub issue #${issueNumber} with gh.`
    );

    const parsed = JSON.parse(payload) as Partial<IssueDetails>;
    if (!parsed.title || !parsed.url) {
      throw new Error("Issue payload was incomplete.");
    }

    return {
      title: parsed.title,
      body: parsed.body ?? "",
      url: parsed.url,
    };
  } catch {
    return undefined;
  }
}

async function fetchIssueWithApi(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<IssueDetails> {
  const token = tryResolveGitHubApiToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "git-ai-cli",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    { headers }
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
  prNumber: number
): Promise<PullRequestDetails> {
  const token = tryResolveGitHubApiToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "git-ai-cli",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`,
    { headers }
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
    head?: { ref?: string };
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
  };
}

async function listPullRequestReviewComments(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PullRequestReviewComment[]> {
  const token = tryResolveGitHubApiToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "git-ai-cli",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`,
    { headers }
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
    user?: { login?: string };
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
      createdAt: comment.created_at as string,
      updatedAt: comment.updated_at as string,
      inReplyToId: comment.in_reply_to_id ?? undefined,
    }));
}

async function listOpenIssues(
  owner: string,
  repo: string,
  token: string
): Promise<Array<{ number: number; title: string; url: string }>> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "git-ai-cli",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to list GitHub issues (${response.status} ${response.statusText}).`);
  }

  const payload = (await response.json()) as Array<{
    number?: number;
    title?: string;
    html_url?: string;
    pull_request?: unknown;
  }>;

  return payload
    .filter((item) => !item.pull_request && item.number && item.title && item.html_url)
    .map((item) => ({
      number: item.number as number,
      title: item.title as string,
      url: item.html_url as string,
    }));
}

async function createGitHubIssue(
  owner: string,
  repo: string,
  token: string,
  title: string,
  body: string,
  labels: string[]
): Promise<{ number: number; title: string; url: string }> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "git-ai-cli",
    },
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

  isAuthenticated(): boolean {
    return canUseGitHub();
  }

  async fetchIssueDetails(issueNumber: number): Promise<IssueDetails> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const ghIssue = tryFetchIssueWithGh(owner, repo, issueNumber);
    if (ghIssue) {
      return ghIssue;
    }

    return fetchIssueWithApi(owner, repo, issueNumber);
  }

  async fetchIssuePlanComment(issueNumber: number): Promise<IssuePlanComment | undefined> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const comments = await listIssueComments(owner, repo, issueNumber);

    return comments
      .filter((comment) => comment.body.includes("<!-- git-ai:issue-plan -->"))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  }

  async fetchPullRequestDetails(prNumber: number): Promise<PullRequestDetails> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const ghPullRequest = tryFetchPullRequestWithGh(owner, repo, prNumber);
    if (ghPullRequest) {
      return ghPullRequest;
    }

    return fetchPullRequestWithApi(owner, repo, prNumber);
  }

  async fetchPullRequestReviewComments(prNumber: number): Promise<PullRequestReviewComment[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listPullRequestReviewComments(owner, repo, prNumber);
  }

  async createIssuePlanComment(
    issueNumber: number,
    body: string
  ): Promise<IssuePlanComment> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const token = getGitHubApiToken(
      "Posting issue resolution plans requires GH_TOKEN or GITHUB_TOKEN to be set, or gh to be installed and authenticated."
    );
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "git-ai-cli",
        },
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

    if (!payload.id || !payload.body || !payload.html_url || !payload.updated_at) {
      throw new Error(
        `GitHub issue plan comment creation for #${issueNumber} returned an incomplete payload.`
      );
    }

    return {
      id: payload.id,
      body: payload.body,
      url: payload.html_url,
      updatedAt: payload.updated_at,
    };
  }

  async createDraftIssue(title: string, body: string): Promise<string> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    if (isGhAuthenticated()) {
      const output = runCommand(
        "gh",
        ["issue", "create", "--repo", `${owner}/${repo}`, "--title", title, "--body", body],
        `Failed to create GitHub issue "${title}" with gh.`
      );

      const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      return lines[lines.length - 1] ?? output;
    }

    const token = getGitHubApiToken(
      "Creating issues requires GH_TOKEN or GITHUB_TOKEN to be set, or gh to be installed and authenticated."
    );
    const createdIssue = await createGitHubIssue(owner, repo, token, title, body, []);
    return createdIssue.url;
  }

  async createOrReuseIssue(
    title: string,
    body: string,
    labels: string[]
  ): Promise<CreatedIssueRecord> {
    const token = getGitHubApiToken(
      "Creating GitHub issues requires GH_TOKEN or GITHUB_TOKEN to be set."
    );
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    if (!this.openIssuesByTitle) {
      const existingIssues = await listOpenIssues(owner, repo, token);
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

    const createdIssue = await createGitHubIssue(owner, repo, token, title, body, labels);
    this.openIssuesByTitle.set(createdIssue.title.trim().toLowerCase(), createdIssue);
    return {
      ...createdIssue,
      status: "created",
    };
  }

  createPullRequest(input: CreatePullRequestInput): void {
    runTrackedCommand(
      "git",
      ["push", "-u", "origin", input.branchName],
      `Failed to push branch "${input.branchName}".`,
      input.outputLogPath,
      this.repoRoot
    );
    runTrackedCommand(
      "gh",
      [
        "pr",
        "create",
        "--title",
        `Fix: ${input.issueTitle}`,
        "--body",
        `Closes #${input.issueNumber}`,
        "--base",
        input.baseBranch,
      ],
      "Failed to create a pull request.",
      input.outputLogPath,
      this.repoRoot
    );
  }
}

export function createGitHubRepositoryForge(repoRoot: string): RepositoryForge {
  return new GitHubRepositoryForge(repoRoot);
}
