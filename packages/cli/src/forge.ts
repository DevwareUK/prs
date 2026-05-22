import type { ResolvedRepositoryConfigType } from "@prs/contracts";
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

export type AuditTarget = {
  type: "issue" | "pull-request";
  number: number;
};

export type PullRequestDetails = {
  number: number;
  title: string;
  body: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  headSha?: string;
  isDraft?: boolean;
  mergeable?: boolean | null;
  mergeableState?: string | null;
};

export type PullRequestCheckSignal = {
  name: string;
  status: "queued" | "in-progress" | "completed" | "pending" | "unknown";
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed-out" | "action-required" | "unknown";
  url?: string;
};

export type OpenPullRequestChange = {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  files: string[];
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
  authorIsBot?: boolean;
  createdAt: string;
  updatedAt: string;
  inReplyToId?: number;
  commitOid?: string;
};

export type PullRequestReviewThreadDetails = {
  threadId: number;
  nodeId: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: PullRequestReviewComment[];
};

export type PullRequestInlineReviewCommentInput = {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
};

export type CreatePullRequestReviewInput = {
  prNumber: number;
  commitSha?: string;
  body: string;
  comments: PullRequestInlineReviewCommentInput[];
};

export type CreatedPullRequestReviewRecord = {
  id?: number;
  url?: string;
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
  fetchIssueComments(issueNumber: number): Promise<RepositoryComment[]>;
  fetchIssuePlanComment(issueNumber: number): Promise<IssuePlanComment | undefined>;
  fetchAuditComment(target: AuditTarget): Promise<RepositoryComment | undefined>;
  fetchPullRequestDetails(prNumber: number): Promise<PullRequestDetails>;
  fetchPullRequestChecks(prNumber: number): Promise<PullRequestCheckSignal[]>;
  listOpenPullRequestChanges(): Promise<OpenPullRequestChange[]>;
  fetchPullRequestIssueComments(prNumber: number): Promise<RepositoryComment[]>;
  fetchPullRequestReviewComments(prNumber: number): Promise<PullRequestReviewComment[]>;
  fetchPullRequestReviewThreads?(
    prNumber: number
  ): Promise<PullRequestReviewThreadDetails[]>;
  replyToPullRequestReviewThread?(threadNodeId: string, body: string): Promise<void>;
  resolvePullRequestReviewThread?(threadNodeId: string): Promise<void>;
  createPullRequestReview?(
    input: CreatePullRequestReviewInput
  ): Promise<CreatedPullRequestReviewRecord>;
  createIssuePlanComment(issueNumber: number, body: string): Promise<IssuePlanComment>;
  createAuditComment(target: AuditTarget, body: string): Promise<RepositoryComment>;
  updateIssuePlanComment(commentId: number, body: string): Promise<IssuePlanComment>;
  updateIssueComment(commentId: number, body: string): Promise<RepositoryComment>;
  createDraftIssue(title: string, body: string): Promise<string>;
  updateIssue(issueNumber: number, title: string, body: string): Promise<CreatedIssueRecord>;
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
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async fetchIssuePlanComment(): Promise<IssuePlanComment | undefined> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async fetchAuditComment(): Promise<RepositoryComment | undefined> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable audit workflows."
    );
  }

  async fetchIssueComments(): Promise<RepositoryComment[]> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async fetchPullRequestDetails(): Promise<PullRequestDetails> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async fetchPullRequestChecks(): Promise<PullRequestCheckSignal[]> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async listOpenPullRequestChanges(): Promise<OpenPullRequestChange[]> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async fetchPullRequestIssueComments(): Promise<RepositoryComment[]> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async fetchPullRequestReviewComments(): Promise<PullRequestReviewComment[]> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async createIssuePlanComment(): Promise<IssuePlanComment> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async createAuditComment(): Promise<RepositoryComment> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable audit workflows."
    );
  }

  async updateIssuePlanComment(): Promise<IssuePlanComment> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async updateIssueComment(): Promise<RepositoryComment> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async createDraftIssue(): Promise<string> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue creation."
    );
  }

  async updateIssue(): Promise<CreatedIssueRecord> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue workflows."
    );
  }

  async createOrReuseIssue(): Promise<CreatedIssueRecord> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable issue creation."
    );
  }

  async createPullRequest(): Promise<CreatedPullRequestRecord> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request creation."
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
