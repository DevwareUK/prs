import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IssueTracker } from "./issue-tracker";
import {
  findLatestIssueSpecComment,
  formatSuperpowersPlanArtifactComment,
  formatSuperpowersSpecArtifactComment,
  type ManagedCommentPublication,
} from "./workflows/issue/artifacts";

type IssueArtifactTracker = Pick<
  IssueTracker,
  | "fetchIssueDetails"
  | "fetchIssueComments"
  | "fetchIssuePlanComment"
  | "createIssuePlanComment"
  | "updateIssueComment"
  | "updateIssuePlanComment"
>;

function readApprovedMarkdown(filePath: string, label: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`${label} artifact does not exist: ${filePath}`);
  }
  const markdown = readFileSync(filePath, "utf8").trim();
  if (!markdown) {
    throw new Error(`${label} artifact must contain non-empty Markdown.`);
  }
  return markdown;
}

export async function publishIssueArtifactsTool(input: {
  issueNumber: number;
  repoRoot: string;
  specFilePath: string;
  planFilePath: string;
  tracker: IssueArtifactTracker;
}): Promise<{
  status: "ok";
  issueNumber: number;
  managedComments: ManagedCommentPublication[];
}> {
  const specFilePath = resolve(input.repoRoot, input.specFilePath);
  const planFilePath = resolve(input.repoRoot, input.planFilePath);
  const specMarkdown = readApprovedMarkdown(specFilePath, "Specification");
  const planMarkdown = readApprovedMarkdown(planFilePath, "Plan");

  await input.tracker.fetchIssueDetails(input.issueNumber);
  const [comments, planComment] = await Promise.all([
    input.tracker.fetchIssueComments(input.issueNumber),
    input.tracker.fetchIssuePlanComment(input.issueNumber),
  ]);
  const specComment = findLatestIssueSpecComment(comments);
  const publishedSpec = specComment
    ? await input.tracker.updateIssueComment(
        specComment.id,
        formatSuperpowersSpecArtifactComment(specMarkdown)
      )
    : await input.tracker.createIssuePlanComment(
        input.issueNumber,
        formatSuperpowersSpecArtifactComment(specMarkdown)
      );
  const publishedPlan = planComment
    ? await input.tracker.updateIssuePlanComment(
        planComment.id,
        formatSuperpowersPlanArtifactComment(planMarkdown)
      )
    : await input.tracker.createIssuePlanComment(
        input.issueNumber,
        formatSuperpowersPlanArtifactComment(planMarkdown)
      );

  return {
    status: "ok",
    issueNumber: input.issueNumber,
    managedComments: [
      {
        issueNumber: input.issueNumber,
        marker: "<!-- prs:issue-spec -->",
        status: "published",
        file: specFilePath,
        id: publishedSpec.id,
        url: publishedSpec.url,
      },
      {
        issueNumber: input.issueNumber,
        marker: "<!-- prs:issue-plan -->",
        status: "published",
        file: planFilePath,
        id: publishedPlan.id,
        url: publishedPlan.url,
      },
    ],
  };
}
