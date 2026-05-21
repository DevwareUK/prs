import type {
  PullRequestCheckSignal,
  PullRequestReviewComment,
  RepositoryComment,
} from "../../forge";
import type {
  PullRequestPrepareReviewBaseSyncState,
  PullRequestPrepareReviewCheckoutTarget,
  PullRequestPrepareReviewLinkedIssueState,
  PullRequestPrepareReviewWorkspace,
} from "../pr-prepare-review/types";

export type PullRequestLocalReviewWorkspace = PullRequestPrepareReviewWorkspace & {
  contextFilePath: string;
  reportFilePath: string;
};

export type PullRequestLocalReviewCaptured<T> =
  | {
      status: "available";
      items: T[];
    }
  | {
      status: "unavailable";
      warning: string;
    };

export type PullRequestLocalReviewContextInput = {
  flow: "pr-review";
  pullRequest: {
    number: number;
    title: string;
    body: string;
    url: string;
    baseRefName: string;
    headRefName: string;
  };
  linkedIssues: PullRequestPrepareReviewLinkedIssueState[];
  checkoutTarget: PullRequestPrepareReviewCheckoutTarget;
  baseSync: PullRequestPrepareReviewBaseSyncState;
  buildCommandDisplay: string;
  checks: PullRequestLocalReviewCaptured<PullRequestCheckSignal>;
  issueComments: PullRequestLocalReviewCaptured<RepositoryComment>;
  reviewComments: PullRequestLocalReviewCaptured<PullRequestReviewComment>;
  changedFiles: string[];
  diff: string;
  warnings: string[];
  reportFilePath: string;
};

export type PullRequestLocalReviewToolResult =
  | {
      status: "ready";
      prNumber: number;
      runDir: string;
      contextFilePath: string;
      promptFilePath: string;
      metadataFilePath: string;
      outputLogPath: string;
      reportFilePath: string;
      checkout: PullRequestPrepareReviewCheckoutTarget;
      baseSync: PullRequestPrepareReviewBaseSyncState;
      changedFiles: string[];
      nextAction: "write-codex-pr-review-report";
    }
  | {
      status: "blocked";
      reason: "merge-conflicts";
      prNumber: number;
      runDir: string;
      contextFilePath: string;
      conflictPromptFilePath: string;
      metadataFilePath: string;
      outputLogPath: string;
      reportFilePath: string;
      checkout: PullRequestPrepareReviewCheckoutTarget;
      baseSync: PullRequestPrepareReviewBaseSyncState;
      nextAction: "resolve-conflicts-in-current-codex-session";
    };
