import type { IssueDetails, PullRequestReviewComment } from "../../integration-types";

export type PullRequestFixWorkspace = {
  runDir: string;
  snapshotFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
};

export type PullRequestReviewThread = {
  threadId: number;
  nodeId?: string;
  isResolved?: boolean;
  isOutdated?: boolean;
  path: string;
  startLine?: number;
  endLine?: number;
  anchorLine?: number;
  rootComment: PullRequestReviewComment;
  comments: PullRequestReviewComment[];
  actionableComments: PullRequestReviewComment[];
  summary: string;
};

export type PullRequestReviewTask = {
  taskId: string;
  kind: "group" | "thread";
  path: string;
  startLine?: number;
  endLine?: number;
  summary: string;
  comments: PullRequestReviewComment[];
  threads: PullRequestReviewThread[];
};

export type PullRequestLinkedIssueContext = IssueDetails & {
  number: number;
};
