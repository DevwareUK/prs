import type { IssuePullRequestLinks, LinkedPullRequestsResult } from "./issue-pr-links";
import { ISSUE_SPEC_COMMENT_MARKER, startsWithManagedMarker } from "@prs/contracts";
import type {
  IssueDetails,
  IssueLinkedPullRequest,
  IssuePlanComment,
  IssueIdentity,
  RepositoryComment,
  IssueTracker,
  RepositoryIdentity,
} from "./issue-tracker";

type IssueContextTracker = Pick<
  IssueTracker,
  | "type"
  | "getRepositoryIdentity"
  | "fetchIssueDetails"
  | "fetchIssueComments"
  | "fetchIssuePlanComment"
  | "getIssueReference"
  | "fetchIssueParent"
  | "fetchIssueChildren"
>;

export type IssueContextToolResult =
  | {
      status: "ready";
      repository: RepositoryIdentity;
      issue: IssueDetails & { number: number };
      comments: RepositoryComment[];
      managed: { spec: "missing" | "present"; plan: "missing" | "present" };
      linkedPullRequests: IssueLinkedPullRequest[];
      linkedPullRequestsStatus: {status: "available"} | {status: "unavailable"; reason: string};
      hierarchy: { parent: IssueIdentity | null; children: IssueIdentity[] };
    }
  | { status: "blocked"; message: string; nextAction: string };

export async function contextIssueTool(input: {
  issueNumber: number;
  tracker: IssueContextTracker;
  links: IssuePullRequestLinks;
}): Promise<IssueContextToolResult> {
  if (input.tracker.type === "none") {
    return {
      status: "blocked",
      message: "Issue tracker support is disabled by .prs/config.json.",
      nextAction: "configure-issue-tracker",
    };
  }

  const [issue, comments, planComment, linkedPullRequests, parent, children] = await Promise.all([
    input.tracker.fetchIssueDetails(input.issueNumber),
    input.tracker.fetchIssueComments(input.issueNumber),
    input.tracker.fetchIssuePlanComment(input.issueNumber),
    input.links.findLinkedPullRequests(input.tracker.getIssueReference(input.issueNumber)),
    input.tracker.fetchIssueParent(input.issueNumber),
    input.tracker.fetchIssueChildren(input.issueNumber),
  ] satisfies [
    Promise<IssueDetails>,
    Promise<RepositoryComment[]>,
    Promise<IssuePlanComment | undefined>,
    Promise<LinkedPullRequestsResult>,
    Promise<IssueIdentity | null>,
    Promise<IssueIdentity[]>,
  ]);

  return {
    status: "ready",
    repository: input.tracker.getRepositoryIdentity(),
    issue: { number: input.issueNumber, ...issue },
    comments,
    managed: {
      spec: comments.some((comment) =>
        startsWithManagedMarker(comment.body, [ISSUE_SPEC_COMMENT_MARKER])
      )
        ? "present"
        : "missing",
      plan: planComment ? "present" : "missing",
    },
    linkedPullRequests: linkedPullRequests.status === "available" ? linkedPullRequests.pullRequests : [],
    linkedPullRequestsStatus: linkedPullRequests.status === "available" ? {status: "available"} : linkedPullRequests,
    hierarchy: { parent, children },
  };
}
