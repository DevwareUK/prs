import type { PullRequestListToolResult } from "./pr-list-tool";
import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import type {
  RepositoryIdentity,
  RepositoryComment,
  AuditTarget,
  PullRequestDetails,
  PullRequestCheckSignal,
  OpenPullRequestChange,
  PullRequestReviewComment,
  PullRequestReviewThreadDetails,
  CreatePullRequestReviewInput,
  CreatedPullRequestReviewRecord,
  CreatePullRequestInput,
  CreatedPullRequestRecord,
} from "./integration-types";
import { createGitHubRepositoryForge } from "./github";
export type {
  RepositoryIdentity,
  IssueLinkedPullRequest,
  RepositoryComment,
  AuditTarget,
  PullRequestDetails,
  PullRequestCheckSignal,
  OpenPullRequestChange,
  PullRequestReviewComment,
  PullRequestReviewThreadDetails,
  PullRequestInlineReviewCommentInput,
  PullRequestReviewEvent,
  CreatePullRequestReviewInput,
  CreatedPullRequestReviewRecord,
  CreatePullRequestInput,
  CreatedPullRequestRecord,
} from "./integration-types";

export interface RepositoryForge {
  readonly type: "github" | "none";
  listPullRequests(options: {actionable: boolean}): Promise<PullRequestListToolResult>;
  getRepositoryIdentity(): RepositoryIdentity;
  isAuthenticated(): boolean;
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
  markPullRequestReadyForReview?(prNumber: number): Promise<void>;
  createAuditComment(target: AuditTarget, body: string): Promise<RepositoryComment>;
  updateComment(commentId: number, body: string): Promise<RepositoryComment>;
  createPullRequest(input: CreatePullRequestInput): Promise<CreatedPullRequestRecord>;
}

class NoopRepositoryForge implements RepositoryForge {
  readonly type = "none" as const;
  async listPullRequests(): Promise<PullRequestListToolResult> {
    return {status: "blocked", reason: "forge-disabled", message: "Repository forge support is disabled by .prs/config.json.", nextAction: "configure-forge"};
  }

  isAuthenticated(): boolean {
    return false;
  }

  getRepositoryIdentity(): RepositoryIdentity {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async fetchAuditComment(): Promise<RepositoryComment | undefined> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable audit workflows."
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

  async createAuditComment(): Promise<RepositoryComment> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable audit workflows."
    );
  }

  async updateComment(): Promise<RepositoryComment> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request workflows."
    );
  }

  async createPullRequest(): Promise<CreatedPullRequestRecord> {
    throw new Error(
      "Repository forge support is disabled by .prs/config.json. Configure `forge.type` to enable pull request creation."
    );
  }
}

export function createRepositoryForge(repoRoot: string, config: ResolvedRepositoryConfigType): RepositoryForge {
  return config.forge.type === "none" ? new NoopRepositoryForge() : createGitHubRepositoryForge(repoRoot);
}
