import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import type {
  IssueDetails,
  RepositoryIdentity,
  IssuePlanComment,
  RepositoryComment,
  AuditTarget,
  CreatedIssueRecord,
  IssueIdentity,
} from "./integration-types";
import { createGitHubIssueTracker } from "./github-issue-tracker";
import type { IssueListToolResult } from "./issue-list-tool";
export type {
  IssueDetails,
  IssuePlanComment,
  CreatedIssueRecord,
  IssueIdentity,
  RepositoryComment,
  RepositoryIdentity,
  IssueLinkedPullRequest,
} from "./integration-types";

export type IssueReference = { provider: string; scope: string; key: string; url: string };

export interface IssueTracker {
  readonly type: "github" | "none";
  getRepositoryIdentity(): RepositoryIdentity;
  isAuthenticated(): boolean;
  fetchIssueDetails(issueNumber: number): Promise<IssueDetails>;
  fetchIssueIdentity(issueNumber: number): Promise<IssueIdentity>;
  fetchIssueParent(issueNumber: number): Promise<IssueIdentity | null>;
  fetchIssueChildren(issueNumber: number): Promise<IssueIdentity[]>;
  addIssueChild(parentNumber: number, childDatabaseId: number): Promise<void>;
  fetchIssueComments(issueNumber: number): Promise<RepositoryComment[]>;
  fetchIssuePlanComment(issueNumber: number): Promise<IssuePlanComment | undefined>;
  fetchAuditComment(target: AuditTarget): Promise<RepositoryComment | undefined>;
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
  getIssueReference(issueNumber: number): IssueReference;
  listIssues(options: { actionable: boolean }): Promise<IssueListToolResult>;
}

class NoopIssueTracker implements IssueTracker {
  readonly type = "none" as const;
  isAuthenticated(): boolean {
    return false;
  }

  getRepositoryIdentity(): RepositoryIdentity {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async fetchIssueDetails(): Promise<IssueDetails> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async fetchIssueIdentity(): Promise<IssueIdentity> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async fetchIssueParent(): Promise<IssueIdentity | null> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async fetchIssueChildren(): Promise<IssueIdentity[]> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async addIssueChild(): Promise<void> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async fetchIssuePlanComment(): Promise<IssuePlanComment | undefined> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async fetchAuditComment(): Promise<RepositoryComment | undefined> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable audit workflows."
    );
  }

  async fetchIssueComments(): Promise<RepositoryComment[]> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async createIssuePlanComment(): Promise<IssuePlanComment> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async createAuditComment(): Promise<RepositoryComment> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable audit workflows."
    );
  }

  async updateIssuePlanComment(): Promise<IssuePlanComment> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async updateIssueComment(): Promise<RepositoryComment> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async createDraftIssue(): Promise<string> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue creation."
    );
  }

  async updateIssue(): Promise<CreatedIssueRecord> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue workflows."
    );
  }

  async createOrReuseIssue(): Promise<CreatedIssueRecord> {
    throw new Error(
      "Issue tracker support is disabled by .prs/config.json. Configure `issueTracker.type` to enable issue creation."
    );
  }
  getIssueReference(): IssueReference { throw new Error("Configure `issueTracker.type` to enable issue tracking."); }
  async listIssues(): Promise<IssueListToolResult> { return { status: "blocked", reason: "issue-tracker-disabled", message: "Issue tracker support is disabled by .prs/config.json.", nextAction: "configure-issue-tracker" }; }
}

export function createIssueTracker(repoRoot: string, config: ResolvedRepositoryConfigType): IssueTracker {
  return config.issueTracker.type === "none" ? new NoopIssueTracker() : createGitHubIssueTracker(repoRoot, config);
}
