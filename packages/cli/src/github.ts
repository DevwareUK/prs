import { listGitHubPullRequests } from "./github-pr-list";
import { updateGitHubComment } from "./github-api";
import { createGitHubAuditComment } from "./github-api";
import { fetchGitHubAuditComment } from "./github-api";
import type {
  RepositoryComment,
  AuditTarget,
  PullRequestDetails,
  PullRequestCheckSignal,
  OpenPullRequestChange,
  PullRequestReviewComment,
  PullRequestReviewThreadDetails,
  CreatePullRequestReviewInput,
  CreatePullRequestInput,
  CreatedPullRequestRecord,
} from "./integration-types";
import {
  parseGitHubRepoFromRemote,
  canUseGitHub,
  appendRunLog,
  runTrackedCommand,
  listIssueComments,
  fetchPullRequestWithApi,
  listPullRequestChecks,
  listOpenPullRequests,
  listPullRequestFiles,
  listPullRequestReviewComments,
  postGitHubGraphQL,
  listPullRequestReviewThreads,
} from "./github-api";
import { requestGitHub, createGitHubClient } from "./github-client";
import type { RepositoryForge } from "./forge";
export { listIssueLinkedPullRequestsForRepoRoot, listOpenGitHubIssuesForRepoRoot } from "./github-api";

class GitHubRepositoryForge implements RepositoryForge {
  readonly type = "github" as const;
  constructor(private readonly repoRoot: string) {}
  listPullRequests(options: {actionable: boolean}) { return listGitHubPullRequests({...options, repoRoot: this.repoRoot}); }

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

  async fetchAuditComment(target: AuditTarget): Promise<RepositoryComment | undefined> {
    if (target.type !== "pull-request") throw new Error("Audit target belongs to the other integration.");
    return fetchGitHubAuditComment(this.repoRoot, target);
  }

  async fetchPullRequestDetails(prNumber: number): Promise<PullRequestDetails> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return fetchPullRequestWithApi(owner, repo, prNumber, this.repoRoot);
  }

  async fetchPullRequestChecks(prNumber: number): Promise<PullRequestCheckSignal[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listPullRequestChecks(owner, repo, prNumber, this.repoRoot);
  }

  async listOpenPullRequestChanges(): Promise<OpenPullRequestChange[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const pullRequests = await listOpenPullRequests(owner, repo, this.repoRoot);

    return Promise.all(
      pullRequests.map(async (pullRequest) => ({
        ...pullRequest,
        files: await listPullRequestFiles(owner, repo, pullRequest.number, this.repoRoot),
      }))
    );
  }

  async fetchPullRequestIssueComments(prNumber: number): Promise<RepositoryComment[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listIssueComments(owner, repo, prNumber, this.repoRoot);
  }

  async fetchPullRequestReviewComments(prNumber: number): Promise<PullRequestReviewComment[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listPullRequestReviewComments(owner, repo, prNumber, this.repoRoot);
  }

  async fetchPullRequestReviewThreads(
    prNumber: number
  ): Promise<PullRequestReviewThreadDetails[]> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    return listPullRequestReviewThreads(owner, repo, prNumber, this.repoRoot);
  }

  async replyToPullRequestReviewThread(threadNodeId: string, body: string): Promise<void> {
    await postGitHubGraphQL(
      this.repoRoot,
      `
        mutation($threadId: ID!, $body: String!) {
          addPullRequestReviewThreadReply(input: {
            pullRequestReviewThreadId: $threadId,
            body: $body
          }) {
            comment {
              id
            }
          }
        }
      `,
      {
        threadId: threadNodeId,
        body,
      },
      "Failed to reply to the addressed GitHub pull request review thread."
    );
  }

  async resolvePullRequestReviewThread(threadNodeId: string): Promise<void> {
    await postGitHubGraphQL(
      this.repoRoot,
      `
        mutation($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread {
              id
              isResolved
            }
          }
        }
      `,
      {
        threadId: threadNodeId,
      },
      "Failed to resolve the addressed GitHub pull request review thread."
    );
  }

  async createPullRequestReview(
    input: CreatePullRequestReviewInput
  ): Promise<{ id?: number; url?: string }> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/pulls/${input.prNumber}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({
          commit_id: input.commitSha,
          event: input.event,
          body: input.body,
          comments: input.comments,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to create GitHub pull request review for #${input.prNumber} (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as {
      id?: number;
      html_url?: string;
    };

    return {
      id: payload.id,
      url: payload.html_url,
    };
  }

  async markPullRequestReadyForReview(prNumber: number): Promise<void> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);

    const response = await requestGitHub(this.repoRoot,
      `repos/${owner}/${repo}/pulls/${prNumber}`
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch GitHub pull request #${prNumber} before marking it ready for review (${response.status} ${response.statusText}).`
      );
    }

    const payload = (await response.json()) as {
      draft?: boolean;
      node_id?: string;
    };
    if (payload.draft === false) {
      return;
    }
    if (!payload.node_id) {
      throw new Error(
        `GitHub pull request #${prNumber} did not return a node id required for draft promotion.`
      );
    }

    await postGitHubGraphQL(
      this.repoRoot,
      `
        mutation($pullRequestId: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
            pullRequest {
              id
              isDraft
            }
          }
        }
      `,
      {
        pullRequestId: payload.node_id,
      },
      `Failed to mark GitHub pull request #${prNumber} ready for review.`
    );
  }

  async createAuditComment(target: AuditTarget, body: string): Promise<RepositoryComment> {
    if (target.type !== "pull-request") throw new Error("Audit target belongs to the other integration.");
    return createGitHubAuditComment(this.repoRoot, target, body);
  }

  async updateComment(commentId: number, body: string): Promise<RepositoryComment> {
    return updateGitHubComment(this.repoRoot, commentId, body);
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<CreatedPullRequestRecord> {
    const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot);
    const client = createGitHubClient({ repoRoot: this.repoRoot });
    runTrackedCommand(
      "git",
      ["push", "-u", "origin", input.branchName],
      `Failed to push branch "${input.branchName}".`,
      input.outputLogPath,
      this.repoRoot
    );
    const prArgs = [
      "pr",
      "create",
      "--repo",
      `${owner}/${repo}`,
      "--title",
      input.title,
      ...(input.bodyFilePath
        ? ["--body-file", input.bodyFilePath]
        : ["--body", input.body]),
      "--base",
      input.baseBranch,
    ];
    const stdout = client.run(
      prArgs, "Failed to create a pull request."
    );
    appendRunLog(input.outputLogPath, "gh", prArgs, stdout, "");
    if (stdout) process.stdout.write(`${stdout}\n`);

    return {
      url: stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^https:\/\/github\.com\/.+\/pull\/\d+$/i.test(line)),
    };
  }
}
export function createGitHubRepositoryForge(repoRoot: string): RepositoryForge { return new GitHubRepositoryForge(repoRoot); }
