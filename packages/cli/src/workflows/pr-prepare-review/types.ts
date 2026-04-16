import type { InteractiveRuntimeType } from "../../runtime";
import type { PullRequestDetails } from "../../forge";
import type { PullRequestLinkedIssueContext } from "../pr-fix-comments/types";

export type PullRequestPrepareReviewWorkspace = {
  runDir: string;
  snapshotFilePath: string;
  promptFilePath: string;
  interactivePromptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
  reviewBriefFilePath: string;
  assistantLastMessageFilePath: string;
};

export type PullRequestPrepareReviewIssueSessionState = {
  issueNumber: number;
  runtimeType: InteractiveRuntimeType;
  branchName: string;
  issueDir: string;
  runDir: string;
  promptFile: string;
  outputLog: string;
  sessionId?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  executionMode?: "interactive" | "unattended";
  createdAt: string;
  updatedAt: string;
};

export type PullRequestPrepareReviewLinkedIssueState = {
  issue: PullRequestLinkedIssueContext;
  sessionState?: PullRequestPrepareReviewIssueSessionState;
};

export type PullRequestPrepareReviewCheckoutTarget =
  | {
      source: "issue-branch";
      branchName: string;
      linkedIssueNumber: number;
    }
  | {
      source: "local-head";
      branchName: string;
    }
  | {
      source: "fetched-review";
      branchName: string;
      headRefName: string;
    };

export type PullRequestPrepareReviewRuntimePlan = {
  invocation: "new" | "resume";
  sessionId?: string;
  linkedIssueNumber?: number;
  warnings: string[];
};

export type PullRequestPrepareReviewSnapshotInput = {
  pullRequest: PullRequestDetails;
  linkedIssues: PullRequestPrepareReviewLinkedIssueState[];
  checkoutTarget: PullRequestPrepareReviewCheckoutTarget;
  runtimePlan: PullRequestPrepareReviewRuntimePlan;
  buildCommandDisplay: string;
};
