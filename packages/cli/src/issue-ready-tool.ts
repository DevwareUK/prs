import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { ALL_ISSUE_SPEC_COMMENT_MARKERS } from "@prs/contracts";
import type { IssueDetails, IssuePlanComment, RepositoryComment, RepositoryForge } from "./forge";

type IssuePlanStatus =
  | { status: "present"; url: string; updatedAt: string }
  | { status: "missing" };

type IssueSpecStatus =
  | { status: "present"; url: string; updatedAt: string }
  | { status: "missing" };

export type IssueReadyToolResult =
  | {
      status: "ready";
      issueNumber: number;
      issueTitle: string;
      issueUrl: string;
      spec: IssueSpecStatus;
      plan: IssuePlanStatus;
      comments: { count: number };
      suggestedBranchName: string;
      runDir: string;
      metadataFilePath: string;
      nextAction: "start-superpowers-worktree";
      message: string;
    }
  | {
      status: "blocked";
      reason: "not-github" | "missing-refinement-artifacts";
      issueNumber?: number;
      issueTitle?: string;
      issueUrl?: string;
      spec?: IssueSpecStatus;
      plan?: IssuePlanStatus;
      message: string;
      nextAction: string;
    };

type IssueReadyForge = Pick<
  RepositoryForge,
  "type" | "fetchIssueDetails" | "fetchIssueComments" | "fetchIssuePlanComment"
>;

type IssueReadyToolOptions = {
  all: boolean;
  issueNumber: number;
  repoRoot: string;
  forge: IssueReadyForge;
  now?: () => Date;
};

function formatRunTimestamp(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");

  return `${year}${month}${day}T${hours}${minutes}${seconds}${milliseconds}Z`;
}

function slugifyIssueTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");

  return slug || "issue";
}

function createIssueBranchName(issueNumber: number, issueTitle: string): string {
  return `codex/issue-${issueNumber}-${slugifyIssueTitle(issueTitle)}`;
}

function toRepoRelativePath(repoRoot: string, filePath: string): string {
  return relative(repoRoot, filePath) || ".";
}

function renderPlanStatus(
  planComment: IssuePlanComment | undefined
): IssuePlanStatus {
  if (!planComment) {
    return { status: "missing" };
  }

  return {
    status: "present",
    url: planComment.url,
    updatedAt: planComment.updatedAt,
  };
}

function findLatestIssueSpecComment(
  comments: RepositoryComment[]
): RepositoryComment | undefined {
  return comments
    .filter((comment) =>
      ALL_ISSUE_SPEC_COMMENT_MARKERS.some((marker) =>
        comment.body.trimStart().startsWith(marker)
      )
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

function renderSpecStatus(comments: RepositoryComment[]): IssueSpecStatus {
  const specComment = findLatestIssueSpecComment(comments);
  if (!specComment) {
    return { status: "missing" };
  }

  return {
    status: "present",
    url: specComment.url,
    updatedAt: specComment.updatedAt,
  };
}

function writeMetadata(input: {
  all: boolean;
  comments: RepositoryComment[];
  issue: IssueDetails;
  issueNumber: number;
  metadataFilePath: string;
  planComment?: IssuePlanComment;
  runDir: string;
  suggestedBranchName: string;
}): void {
  writeFileSync(
    input.metadataFilePath,
    `${JSON.stringify(
      {
        flow: "issue-ready",
        issueNumber: input.issueNumber,
        issueTitle: input.issue.title,
        issueUrl: input.issue.url,
        suggestedBranchName: input.suggestedBranchName,
        all: input.all,
        runDir: input.runDir,
        spec: renderSpecStatus(input.comments),
        plan: renderPlanStatus(input.planComment),
        comments: {
          count: input.comments.length,
        },
      },
      null,
      2
    )}\n`
  );
}

export async function readyIssueTool(
  options: IssueReadyToolOptions
): Promise<IssueReadyToolResult> {
  if (options.forge.type === "none") {
    return {
      status: "blocked",
      reason: "not-github",
      message: "Repository forge support is disabled by .prs/config.json.",
      nextAction: "Configure `forge.type` to `github` before using issue readiness tools.",
    };
  }

  const timestamp = formatRunTimestamp((options.now ?? (() => new Date()))());
  const runDir = resolve(
    options.repoRoot,
    ".prs",
    "runs",
    `${timestamp}-issue-${options.issueNumber}-ready`
  );
  mkdirSync(runDir, { recursive: true });

  const [issue, comments, planComment] = await Promise.all([
    options.forge.fetchIssueDetails(options.issueNumber),
    options.forge.fetchIssueComments(options.issueNumber),
    options.forge.fetchIssuePlanComment(options.issueNumber),
  ]);
  const suggestedBranchName = createIssueBranchName(options.issueNumber, issue.title);
  const metadataFilePath = resolve(runDir, "metadata.json");
  const relativeRunDir = toRepoRelativePath(options.repoRoot, runDir);
  const spec = renderSpecStatus(comments);
  const plan = renderPlanStatus(planComment);

  writeMetadata({
    all: options.all,
    comments,
    issue,
    issueNumber: options.issueNumber,
    metadataFilePath,
    planComment,
    runDir: relativeRunDir,
    suggestedBranchName,
  });

  if (spec.status === "missing" || plan.status === "missing") {
    const missing = [
      spec.status === "missing" ? "managed issue specification" : undefined,
      plan.status === "missing" ? "managed issue plan" : undefined,
    ].filter((value): value is string => value !== undefined);

    return {
      status: "blocked",
      reason: "missing-refinement-artifacts",
      issueNumber: options.issueNumber,
      issueTitle: issue.title,
      issueUrl: issue.url,
      spec,
      plan,
      message: `Issue #${options.issueNumber} is not ready for implementation. Missing ${missing.join(" and ")}. Run \`prs issue refine ${options.issueNumber}\` and continue refinement until the managed specification and plan comments are published.`,
      nextAction: `Run \`prs issue refine ${options.issueNumber}\` before starting development.`,
    };
  }

  return {
    status: "ready",
    issueNumber: options.issueNumber,
    issueTitle: issue.title,
    issueUrl: issue.url,
    spec,
    plan,
    comments: {
      count: comments.length,
    },
    suggestedBranchName,
    runDir: relativeRunDir,
    metadataFilePath: toRepoRelativePath(options.repoRoot, metadataFilePath),
    nextAction: "start-superpowers-worktree",
    message:
      "Issue context is ready. Use Superpowers to create a fresh worktree from the updated base branch before implementation.",
  };
}
