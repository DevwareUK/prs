import type { ResolvedRepositoryConfigType } from "@git-ai/contracts";
import { createGitHubRepositoryForge } from "./github";

export type IssueDetails = {
  title: string;
  body: string;
  url: string;
};

export type IssuePlanComment = {
  id: number;
  body: string;
  url: string;
  updatedAt: string;
};

export type RepositoryComment = {
  id: number;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  isBot: boolean;
};

export type PullRequestDetails = {
  number: number;
  title: string;
  body: string;
  url: string;
  baseRefName: string;
  headRefName: string;
};

export type PullRequestReviewComment = {
  id: number;
  body: string;
  path: string;
  line?: number;
  originalLine?: number;
  startLine?: number;
  originalStartLine?: number;
  side?: string;
  startSide?: string;
  diffHunk?: string;
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  inReplyToId?: number;
};

export type CreatedIssueRecord = {
  number: number;
  title: string;
  url: string;
  status: "created" | "existing";
};

export interface CreatePullRequestInput {
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  outputLogPath: string;
}

export type CreatedPullRequestRecord = {
  url?: string;
};

export interface RepositoryForge {
  readonly type: "github" | "none";
  isAuthenticated(): boolean;
  fetchIssueDetails(issueNumber: number): Promise<IssueDetails>;
  fetchIssuePlanComment(issueNumber: number): Promise<IssuePlanComment | undefined>;
  fetchPullRequestDetails(prNumber: number): Promise<PullRequestDetails>;
  fetchPullRequestIssueComments(prNumber: number): Promise<RepositoryComment[]>;
  fetchPullRequestReviewComments(prNumber: number): Promise<PullRequestReviewComment[]>;
  createIssuePlanComment(issueNumber: number, body: string): Promise<IssuePlanComment>;
  updateIssuePlanComment(commentId: number, body: string): Promise<IssuePlanComment>;
  createDraftIssue(title: string, body: string): Promise<string>;
  createOrReuseIssue(
    title: string,
    body: string,
    labels: string[]
  ): Promise<CreatedIssueRecord>;
  createPullRequest(input: CreatePullRequestInput): Promise<CreatedPullRequestRecord>;
}

class NoopRepositoryForge implements RepositoryForge {
  readonly type = "none" as const;

  isAuthenticated(): boolean {
    return false;
  }

  async fetchIssueDetails(): Promise<IssueDetails> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async fetchIssuePlanComment(): Promise<IssuePlanComment | undefined> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async fetchPullRequestDetails(): Promise<PullRequestDetails> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async fetchPullRequestIssueComments(): Promise<RepositoryComment[]> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async fetchPullRequestReviewComments(): Promise<PullRequestReviewComment[]> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async createIssuePlanComment(): Promise<IssuePlanComment> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async updateIssuePlanComment(): Promise<IssuePlanComment> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async createDraftIssue(): Promise<string> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable issue creation."
    );
  }

  async createOrReuseIssue(): Promise<CreatedIssueRecord> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable issue creation."
    );
  }

  async createPullRequest(): Promise<CreatedPullRequestRecord> {
    throw new Error(
      "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable pull request creation."
    );
  }
}

export function createRepositoryForge(
  repoRoot: string,
  config: ResolvedRepositoryConfigType
): RepositoryForge {
  if (config.forge.type === "none") {
    return new NoopRepositoryForge();
  }

  return createGitHubRepositoryForge(repoRoot);
}
