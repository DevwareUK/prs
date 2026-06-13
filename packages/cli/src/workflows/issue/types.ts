import {
generateIssueResolutionPlan
} from "@prs/core";
import {
type IssueDetails,
type IssuePlanComment
} from "../../forge";
import {
type ReviewedGeneratedText
} from "../../generated-text-review";
import {
type InteractiveRuntimeType
} from "../../runtime";
import {
parseSetupCommandArgs
} from "../../setup";

export { parseAuditCommandArgs } from "../../commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "../../commands/backlog";
export { parseIssueCommandArgs } from "../../commands/issue";
export { parseReviewCommandArgs } from "../../commands/review";
export { parseSetupCommandArgs };

export type IssueWorkspace = {
  issueDir: string;
  issueFilePath: string;
  runDir: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
};

export type IssueWorkspaceMode = "local" | "github-action" | "unattended";
export type IssueDraftWorkspace = {
  runDir: string;
  draftFilePath: string;
  issueSetFilePath: string;
  mediaEvidenceFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
  superpowersSpecFilePath: string;
  superpowersPlanFilePath: string;
};

export type GeneratedIssueResolutionPlan = Awaited<
  ReturnType<typeof generateIssueResolutionPlan>
>;

export type IssueRunContext = {
  issueNumber: number;
  issue: IssueDetails;
  planComment?: IssuePlanComment;
  branchName: string;
  baseBranch: string;
  configuredBaseBranch: string;
  overlapDecision?: IssueBranchBaseDecision;
  workspace: IssueWorkspace;
  mode: IssueWorkspaceMode;
  runtime: {
    type: InteractiveRuntimeType;
    invocation: "new" | "resume";
    sessionId?: string;
    sessionStateFilePath: string;
  };
};

export type IssueBranchBaseDecision = {
  branchName: string;
  pullRequestBaseBranch: string;
  source: "configured-base" | "pull-request-head";
  reason: string;
  overlappingPullRequests: IssueOverlappingPullRequest[];
};

export type IssueOverlappingPullRequest = {
  number: number;
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  matchingFiles: string[];
};

export type IssueSessionState = {
  issueNumber: number;
  runtimeType: InteractiveRuntimeType;
  branchName: string;
  baseBranch?: string;
  configuredBaseBranch?: string;
  overlapDecision?: IssueBranchBaseDecision;
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

export type FinalizeIssueRunResult =
  | {
      committed: false;
    }
  | {
      committed: true;
      diff: string;
      commitMessage: ReviewedGeneratedText;
    };

export type GeneratedIssuePullRequest = {
  title: string;
  body: string;
  titleFilePath?: string;
  bodyFilePath?: string;
};

export type IssuePullRequestOutcome =
  | {
      status: "created";
      title: string;
      url?: string;
    }
  | {
      status: "manual";
      titleFilePath: string;
      bodyFilePath: string;
    }
  | {
      status: "skipped";
      reason: "commit-declined" | "no-changes" | "forge-disabled";
    };

export type IssueRunOutcomeSummary = {
  issueNumber: number;
  branchName: string;
  baseBranch: string;
  runDir: string;
  committed: boolean;
  pullRequest: IssuePullRequestOutcome;
};

export const PRS_MANAGED_ISSUE_MARKER = "<!-- prs:managed-issue -->";
export const ISSUE_REFINEMENT_QUESTIONS_COMMENT_MARKER =
  "<!-- prs:issue-refinement-questions -->";
export const ISSUE_REFINEMENT_COMPLETE_COMMENT_MARKER =
  "<!-- prs:issue-refinement-complete -->";
export const ISSUE_RUN_NO_CHANGES_MESSAGE =
  "The interactive runtime completed without producing any file changes to commit.";

export type IssueBatchStatus = "pending" | "running" | "completed" | "failed";

export type IssueBatchAttempt = {
  startedAt: string;
  updatedAt: string;
  status: IssueBatchStatus;
  worktreePath?: string;
  runDir?: string;
  branchName?: string;
  prUrl?: string;
  pullRequest?: IssuePullRequestOutcome;
  error?: string;
};

export type IssueBatchIssueState = {
  issueNumber: number;
  status: IssueBatchStatus;
  worktreePath?: string;
  runDir?: string;
  branchName?: string;
  prUrl?: string;
  pullRequest?: IssuePullRequestOutcome;
  error?: string;
  attempts: IssueBatchAttempt[];
};

export type IssueBatchState = {
  key: string;
  issueNumbers: number[];
  createdAt: string;
  updatedAt: string;
  latestRunDir: string;
  stoppedIssueNumber?: number;
  issues: IssueBatchIssueState[];
};

export type IssueBatchWorkspace = {
  runDir: string;
  summaryFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
};

export type UnattendedIssueRunResult = {
  branchName: string;
  runDir: string;
  committed: boolean;
  pullRequest: IssuePullRequestOutcome;
};
