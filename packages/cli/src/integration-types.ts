export type IssueDetails = {
  title: string;
  body: string;
  url: string;
};

export type RepositoryIdentity = {
  owner: string;
  name: string;
  url: string;
};

export type IssueLinkedPullRequest = {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
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

export type PullRequestReviewEvent = "APPROVE" | "COMMENT" | "REQUEST_CHANGES";

export type CreatePullRequestReviewInput = {
  prNumber: number;
  commitSha?: string;
  event: PullRequestReviewEvent;
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

export type IssueIdentity = {
  number: number;
  id: number;
  url: string;
};

export interface CreatePullRequestInput {
  branchName: string;
  baseBranch: string;
  title: string;
  body: string;
  bodyFilePath?: string;
  outputLogPath: string;
}

export type CreatedPullRequestRecord = {
  url?: string;
};

