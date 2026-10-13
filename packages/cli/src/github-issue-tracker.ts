import { startIssueWork as updateIssueAtStart } from "./issue-start-github";
import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import { loadResolvedRepositoryConfig } from "./config";
import { updateGitHubComment } from "./github-api";
import { createGitHubAuditComment } from "./github-api";
import { fetchGitHubAuditComment } from "./github-api";
import type {
  IssueDetails,
  IssuePlanComment,
  RepositoryComment,
  AuditTarget,
  CreatedIssueRecord,
  IssueIdentity,
} from "./integration-types";
import {
  parseGitHubRepoFromRemote,
  canUseGitHub,
  parseIssuePlanCommentPayload,
  parseCreatedIssueRecordPayload,
  listIssueComments,
  fetchIssueWithApi,
  listOpenIssues,
  createGitHubIssue,
} from "./github-api";
import { requestGitHub, createGitHubClient } from "./github-client";
import { ISSUE_PLAN_COMMENT_MARKER, startsWithManagedMarker } from "@prs/contracts";
import type { IssueTracker, IssueReference } from "./issue-tracker";
import { listGitHubIssues } from "./github-issue-list";

class GitHubIssueTracker implements IssueTracker {
  readonly type = "github" as const;
  private openIssuesByTitle?: Map<string, { number: number; title: string; url: string }>;
  constructor(private readonly repoRoot: string, private readonly config: ResolvedRepositoryConfigType) {}

  getRepositoryIdentity() {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return {
      owner,
      name: repo,
      url: `https://github.com/${owner}/${repo}`,
    };
  }

  isAuthenticated(): boolean {
    return canUseGitHub(this.repoRoot);
  }

  async fetchIssueDetails(issueNumber: number): Promise<IssueDetails> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return fetchIssueWithApi(owner, repo, issueNumber, this.repoRoot);
  }

  async startIssueWork(issueNumber: number) {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return updateIssueAtStart({
      owner, repo, issueNumber,
      request: createGitHubClient({ repoRoot: this.repoRoot }).request,
    });
  }

  private parseIssueIdentity(payload: unknown, context: string): IssueIdentity {
    const issue = payload as { id?: number; number?: number; html_url?: string };
    if (!issue.id || !issue.number || !issue.html_url) {
      throw new Error(`${context} returned an incomplete issue identity.`);
    }
    return { id: issue.id, number: issue.number, url: issue.html_url };
  }

  async fetchIssueIdentity(issueNumber: number): Promise<IssueIdentity> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const response = await requestGitHub(
      this.repoRoot,
      `repos/${owner}/${repo}/issues/${issueNumber}`
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch GitHub issue identity for #${issueNumber} (${response.status} ${response.statusText}).`
      );
    }
    return this.parseIssueIdentity(
      await response.json(),
      `GitHub issue #${issueNumber}`
    );
  }

  async fetchIssueParent(issueNumber: number): Promise<IssueIdentity | null> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const response = await requestGitHub(
      this.repoRoot,
      `repos/${owner}/${repo}/issues/${issueNumber}/parent`
    );
    if (response.status === 404) {
      await this.fetchIssueIdentity(issueNumber);
      return null;
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch the parent of GitHub issue #${issueNumber} (${response.status} ${response.statusText}).`
      );
    }
    return this.parseIssueIdentity(
      await response.json(),
      `GitHub parent for issue #${issueNumber}`
    );
  }

  async fetchIssueChildren(issueNumber: number): Promise<IssueIdentity[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const children: IssueIdentity[] = [];
    for (let page = 1; ; page += 1) {
      const suffix = page === 1 ? "" : `&page=${page}`;
      const response = await requestGitHub(
        this.repoRoot,
        `repos/${owner}/${repo}/issues/${issueNumber}/sub_issues?per_page=100${suffix}`
      );
      if (!response.ok) {
        throw new Error(
          `Failed to list sub-issues for GitHub issue #${issueNumber} (${response.status} ${response.statusText}).`
        );
      }
      const payload = await response.json() as unknown[];
      const pageChildren = payload.map((issue) =>
        this.parseIssueIdentity(issue, `GitHub sub-issue of #${issueNumber}`)
      );
      children.push(...pageChildren);
      if (pageChildren.length < 100) return children;
    }
  }

  async addIssueChild(parentNumber: number, childDatabaseId: number): Promise<void> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const response = await requestGitHub(
      this.repoRoot,
      `repos/${owner}/${repo}/issues/${parentNumber}/sub_issues`,
      { method: "POST", body: JSON.stringify({ sub_issue_id: childDatabaseId }) }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to attach database issue ${childDatabaseId} to GitHub issue #${parentNumber} (${response.status} ${response.statusText}).`
      );
    }
  }

  async fetchIssuePlanComment(issueNumber: number): Promise<IssuePlanComment | undefined> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const comments = await listIssueComments(owner, repo, issueNumber, this.repoRoot);

    return comments
      .filter((comment) => startsWithManagedMarker(comment.body, [ISSUE_PLAN_COMMENT_MARKER]))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  }

  async fetchAuditComment(target: AuditTarget): Promise<RepositoryComment | undefined> {
    if (target.type !== "issue") throw new Error("Audit target belongs to the other integration.");
    return fetchGitHubAuditComment(this.repoRoot, target);
  }

  async fetchIssueComments(issueNumber: number): Promise<RepositoryComment[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listIssueComments(owner, repo, issueNumber, this.repoRoot);
  }

  async createIssuePlanComment(
    issueNumber: number,
    body: string
  ): Promise<IssuePlanComment> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        method: "POST",
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

    return parseIssuePlanCommentPayload(
      payload,
      `GitHub issue plan comment creation for #${issueNumber} returned an incomplete payload.`
    );
  }

  async createAuditComment(target: AuditTarget, body: string): Promise<RepositoryComment> {
    if (target.type !== "issue") throw new Error("Audit target belongs to the other integration.");
    return createGitHubAuditComment(this.repoRoot, target, body);
  }

  async updateIssuePlanComment(
    commentId: number,
    body: string
  ): Promise<IssuePlanComment> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/issues/comments/${commentId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to refresh the issue resolution plan comment ${commentId} (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as {
      id?: number;
      body?: string | null;
      html_url?: string;
      updated_at?: string;
    };

    return parseIssuePlanCommentPayload(
      payload,
      `GitHub issue plan comment refresh for comment ${commentId} returned an incomplete payload.`
    );
  }

  async updateIssueComment(commentId: number, body: string): Promise<RepositoryComment> {
    return updateGitHubComment(this.repoRoot, commentId, body);
  }

  async createDraftIssue(title: string, body: string): Promise<string> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const createdIssue = await createGitHubIssue(owner, repo, this.repoRoot, title, body, []);
    return createdIssue.url;
  }

  async updateIssue(
    issueNumber: number,
    title: string,
    body: string
  ): Promise<CreatedIssueRecord> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title, body }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to update GitHub issue #${issueNumber} (${response.status} ${response.statusText}).`
      );
    }

    return parseCreatedIssueRecordPayload(
      (await response.json()) as {
        number?: number;
        title?: string;
        html_url?: string;
      },
      `GitHub issue update for #${issueNumber} returned an incomplete payload.`,
      "existing"
    );
  }

  async createOrReuseIssue(
    title: string,
    body: string,
    labels: string[]
  ): Promise<CreatedIssueRecord> {

    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    if (!this.openIssuesByTitle) {
      const existingIssues = await listOpenIssues(owner, repo, this.repoRoot);
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

    const createdIssue = await createGitHubIssue(owner, repo, this.repoRoot, title, body, labels);
    this.openIssuesByTitle.set(createdIssue.title.trim().toLowerCase(), createdIssue);
    return {
      ...createdIssue,
      status: "created",
    };
  }

  getIssueReference(issueNumber: number): IssueReference {
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error("Expected a positive GitHub issue number.");
    const { owner, name, url } = this.getRepositoryIdentity();
    return { provider: "github", scope: `${owner}/${name}`, key: String(issueNumber), url: `${url}/issues/${issueNumber}` };
  }
  listIssues(options: {actionable: boolean}) { return listGitHubIssues({ ...options, repoRoot: this.repoRoot, config: this.config }); }
}
export function createGitHubIssueTracker(repoRoot: string, config = loadResolvedRepositoryConfig(repoRoot)): IssueTracker {
  return new GitHubIssueTracker(repoRoot, config);
}
