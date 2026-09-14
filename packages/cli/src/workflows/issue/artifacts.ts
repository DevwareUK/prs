import {
  ISSUE_PLAN_COMMENT_MARKER,
  ISSUE_SPEC_COMMENT_MARKER,
  startsWithManagedMarker,
} from "@prs/contracts";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CreatedIssueRecord,
  RepositoryComment,
  RepositoryForge,
} from "../../forge";
import type { ParsedIssueDraftSet } from "./draft-set";

export const PRS_MANAGED_ISSUE_MARKER = "<!-- prs:managed-issue -->";

export function ensurePrsManagedIssueBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.startsWith(PRS_MANAGED_ISSUE_MARKER)
    ? trimmed
    : `${PRS_MANAGED_ISSUE_MARKER}\n\n${trimmed}`;
}

export function formatSuperpowersPlanArtifactComment(planMarkdown: string): string {
  const trimmed = planMarkdown.trim();
  return trimmed.startsWith(ISSUE_PLAN_COMMENT_MARKER)
    ? `${trimmed}\n`
    : `${ISSUE_PLAN_COMMENT_MARKER}\n${trimmed}\n`;
}

export function formatSuperpowersSpecArtifactComment(specMarkdown: string): string {
  const trimmed = specMarkdown.trim();
  return trimmed.startsWith(ISSUE_SPEC_COMMENT_MARKER)
    ? `${trimmed}\n`
    : `${ISSUE_SPEC_COMMENT_MARKER}\n${trimmed}\n`;
}

export function findLatestIssueSpecComment(
  comments: RepositoryComment[]
): RepositoryComment | undefined {
  return comments
    .filter((comment) =>
      startsWithManagedMarker(comment.body, [ISSUE_SPEC_COMMENT_MARKER])
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

export type ManagedCommentHint = {
  issueNumber: number;
  marker: typeof ISSUE_SPEC_COMMENT_MARKER | typeof ISSUE_PLAN_COMMENT_MARKER;
  status: "missing";
  nextAction: string;
};

export type ManagedCommentPublication = {
  issueNumber: number;
  marker: typeof ISSUE_SPEC_COMMENT_MARKER | typeof ISSUE_PLAN_COMMENT_MARKER;
  status: "published";
  file: string;
  id: number;
  url: string;
};

export type ManagedCommentFailure = {
  issueNumber: number;
  marker: typeof ISSUE_SPEC_COMMENT_MARKER | typeof ISSUE_PLAN_COMMENT_MARKER;
  status: "incomplete";
  file: string;
  message: string;
  nextAction: string;
};

function resolveApprovedArtifact(
  repoRoot: string,
  filePath: string | undefined
): { filePath: string; markdown: string } | undefined {
  if (!filePath) {
    return undefined;
  }
  const resolvedPath = resolve(repoRoot, filePath);
  if (!existsSync(resolvedPath)) {
    return undefined;
  }
  const markdown = readFileSync(resolvedPath, "utf8").trim();
  return markdown ? { filePath: resolvedPath, markdown } : undefined;
}

export async function publishManagedCommentsFromArtifacts(input: {
  repoRoot: string;
  forge: RepositoryForge;
  issues: CreatedIssueRecord[];
  specFilePath?: string;
  planFilePath?: string;
}): Promise<{
  managedComments: ManagedCommentPublication[];
  managedCommentHints: ManagedCommentHint[];
}> {
  const spec = resolveApprovedArtifact(input.repoRoot, input.specFilePath);
  const plan = resolveApprovedArtifact(input.repoRoot, input.planFilePath);
  const managedComments: ManagedCommentPublication[] = [];
  const managedCommentHints: ManagedCommentHint[] = [];

  for (const issue of input.issues) {
    if (spec) {
      const existing = findLatestIssueSpecComment(
        await input.forge.fetchIssueComments(issue.number)
      );
      const comment = existing
        ? await input.forge.updateIssueComment(
            existing.id,
            formatSuperpowersSpecArtifactComment(spec.markdown)
          )
        : await input.forge.createIssuePlanComment(
            issue.number,
            formatSuperpowersSpecArtifactComment(spec.markdown)
          );
      managedComments.push({
        issueNumber: issue.number,
        marker: ISSUE_SPEC_COMMENT_MARKER,
        status: "published",
        file: spec.filePath,
        id: comment.id,
        url: comment.url,
      });
    } else {
      managedCommentHints.push({
        issueNumber: issue.number,
        marker: ISSUE_SPEC_COMMENT_MARKER,
        status: "missing",
        nextAction: "Publish an approved specification with prs tool issue publish-artifacts.",
      });
    }

    if (plan) {
      const existing = await input.forge.fetchIssuePlanComment(issue.number);
      const comment = existing
        ? await input.forge.updateIssuePlanComment(
            existing.id,
            formatSuperpowersPlanArtifactComment(plan.markdown)
          )
        : await input.forge.createIssuePlanComment(
            issue.number,
            formatSuperpowersPlanArtifactComment(plan.markdown)
          );
      managedComments.push({
        issueNumber: issue.number,
        marker: ISSUE_PLAN_COMMENT_MARKER,
        status: "published",
        file: plan.filePath,
        id: comment.id,
        url: comment.url,
      });
    } else {
      managedCommentHints.push({
        issueNumber: issue.number,
        marker: ISSUE_PLAN_COMMENT_MARKER,
        status: "missing",
        nextAction: "Publish an approved plan with prs tool issue publish-artifacts.",
      });
    }
  }

  return { managedComments, managedCommentHints };
}

export async function publishLinkedIssueArtifacts(input: {
  forge: RepositoryForge;
  issueSet: ParsedIssueDraftSet;
  issues: Array<CreatedIssueRecord & { id?: string }>;
}): Promise<{
  managedComments: ManagedCommentPublication[];
  managedCommentHints: ManagedCommentHint[];
  managedCommentFailures: ManagedCommentFailure[];
}> {
  const issuesById = new Map(
    input.issues
      .filter((issue): issue is CreatedIssueRecord & { id: string } => Boolean(issue.id))
      .map((issue) => [issue.id, issue])
  );
  const managedComments: ManagedCommentPublication[] = [];
  const managedCommentFailures: ManagedCommentFailure[] = [];

  for (const artifact of input.issueSet.issues) {
    const issue = issuesById.get(artifact.id);
    if (!issue) {
      throw new Error(`Created issue record for linked issue "${artifact.id}" is missing.`);
    }

    try {
      const existingSpec = findLatestIssueSpecComment(
        await input.forge.fetchIssueComments(issue.number)
      );
      const spec = existingSpec
        ? await input.forge.updateIssueComment(
            existingSpec.id,
            formatSuperpowersSpecArtifactComment(artifact.specMarkdown)
          )
        : await input.forge.createIssuePlanComment(
            issue.number,
            formatSuperpowersSpecArtifactComment(artifact.specMarkdown)
          );
      managedComments.push({
        issueNumber: issue.number,
        marker: ISSUE_SPEC_COMMENT_MARKER,
        status: "published",
        file: artifact.specFilePath,
        id: spec.id,
        url: spec.url,
      });
    } catch (error) {
      managedCommentFailures.push({
        issueNumber: issue.number,
        marker: ISSUE_SPEC_COMMENT_MARKER,
        status: "incomplete",
        file: artifact.specFilePath,
        message: error instanceof Error ? error.message : String(error),
        nextAction: "Retry the same approved issue-set creation command to update this managed comment in place.",
      });
    }

    try {
      const existingPlan = await input.forge.fetchIssuePlanComment(issue.number);
      const plan = existingPlan
        ? await input.forge.updateIssuePlanComment(
            existingPlan.id,
            formatSuperpowersPlanArtifactComment(artifact.planMarkdown)
          )
        : await input.forge.createIssuePlanComment(
            issue.number,
            formatSuperpowersPlanArtifactComment(artifact.planMarkdown)
          );
      managedComments.push({
        issueNumber: issue.number,
        marker: ISSUE_PLAN_COMMENT_MARKER,
        status: "published",
        file: artifact.planFilePath,
        id: plan.id,
        url: plan.url,
      });
    } catch (error) {
      managedCommentFailures.push({
        issueNumber: issue.number,
        marker: ISSUE_PLAN_COMMENT_MARKER,
        status: "incomplete",
        file: artifact.planFilePath,
        message: error instanceof Error ? error.message : String(error),
        nextAction: "Retry the same approved issue-set creation command to update this managed comment in place.",
      });
    }
  }

  return { managedComments, managedCommentHints: [], managedCommentFailures };
}
