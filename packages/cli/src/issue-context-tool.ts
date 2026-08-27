import { ISSUE_SPEC_COMMENT_MARKER, startsWithManagedMarker } from "@prs/contracts";
import type {
  IssueDetails,
  IssueLinkedPullRequest,
  IssuePlanComment,
  RepositoryComment,
  RepositoryForge,
  RepositoryIdentity,
} from "./forge";

type IssueContextForge = Pick<
  RepositoryForge,
  | "type"
  | "getRepositoryIdentity"
  | "fetchIssueDetails"
  | "fetchIssueComments"
  | "fetchIssuePlanComment"
  | "fetchIssueLinkedPullRequests"
>;

export type IssueContextToolResult =
  | {
      status: "ready";
      repository: RepositoryIdentity;
      issue: IssueDetails & { number: number };
      comments: RepositoryComment[];
      managed: { spec: "missing" | "present"; plan: "missing" | "present" };
      linkedPullRequests: IssueLinkedPullRequest[];
    }
  | { status: "blocked"; message: string; nextAction: string };

export async function contextIssueTool(input: {
  issueNumber: number;
  forge: IssueContextForge;
}): Promise<IssueContextToolResult> {
  if (input.forge.type === "none") {
    return {
      status: "blocked",
      message: "Repository forge support is disabled by .prs/config.json.",
      nextAction: "configure-forge",
    };
  }

  const [issue, comments, planComment, linkedPullRequests] = await Promise.all([
    input.forge.fetchIssueDetails(input.issueNumber),
    input.forge.fetchIssueComments(input.issueNumber),
    input.forge.fetchIssuePlanComment(input.issueNumber),
    input.forge.fetchIssueLinkedPullRequests(input.issueNumber),
  ] satisfies [
    Promise<IssueDetails>,
    Promise<RepositoryComment[]>,
    Promise<IssuePlanComment | undefined>,
    Promise<IssueLinkedPullRequest[]>,
  ]);

  return {
    status: "ready",
    repository: input.forge.getRepositoryIdentity(),
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
    linkedPullRequests,
  };
}
