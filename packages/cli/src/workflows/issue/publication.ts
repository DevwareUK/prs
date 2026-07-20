import type { RepositoryAiWorkflowRole,ResolvedRepositoryConfigType } from "@prs/contracts";
import {
applyGitHubOutputFraming,
ISSUE_PLAN_COMMENT_MARKER,
ISSUE_SPEC_COMMENT_MARKER,
startsWithManagedMarker,
type GitHubOutputMode
} from "@prs/contracts";
import {
generateIssueResolutionPlan
} from "@prs/core";
import {
appendFileSync,
existsSync,
readFileSync
} from "node:fs";
import { resolve } from "node:path";
import { createProvider,getRepositoryConfig } from "../../cli-context";
import { formatMarkdownList } from "../../cli-format";
import {
type CreatedIssueRecord,
type IssueDetails,
type IssuePlanComment,
type OpenPullRequestChange,
type RepositoryComment,
type RepositoryForge,
} from "../../forge";
import {
publishAutomaticIssueEstimate
} from "../../issue-estimate-tool";
import {
getIssueTokenUsageArtifactFilePath,
toRepoRelativePath,
type IssueRefineWorkspace
} from "../../run-artifacts";
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


import {
ISSUE_REFINEMENT_COMPLETE_COMMENT_MARKER,
ISSUE_REFINEMENT_QUESTIONS_COMMENT_MARKER,
type GeneratedIssueResolutionPlan,
type IssueBranchBaseDecision,
type IssueOverlappingPullRequest,
} from "./types";

export type IssuePlanResolutionMode = "explicit-plan-command" | "execution-preflight";

export function stripIssuePlanCommentMarker(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => line.trim() !== ISSUE_PLAN_COMMENT_MARKER)
    .join("\n")
    .trim();
}

export function normalizeRepositoryPath(value: string): string | undefined {
  const trimmed = value.trim().replace(/^`|`$/g, "");
  if (!trimmed || trimmed.includes("\n") || /^[A-Z][\w\s]+$/.test(trimmed)) {
    return undefined;
  }

  return trimmed.replace(/^\.\//, "");
}

export function extractIssuePlanLikelyFiles(planBody: string | undefined): string[] {
  if (!planBody) {
    return [];
  }

  const lines = stripIssuePlanCommentMarker(planBody).split(/\r?\n/);
  const start = lines.findIndex((line) => /^###\s+Likely files\s*$/i.test(line.trim()));
  if (start === -1) {
    return [];
  }

  const files: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^###\s+/.test(line.trim())) {
      break;
    }

    const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }

    const normalized = normalizeRepositoryPath(match[1] ?? "");
    if (normalized) {
      files.push(normalized);
    }
  }

  return [...new Set(files)];
}

export function findOverlappingPullRequests(
  plannedFiles: string[],
  pullRequests: OpenPullRequestChange[]
): IssueOverlappingPullRequest[] {
  const planned = new Set(
    plannedFiles.map((file) => file.replace(/^\.\//, "")).filter(Boolean)
  );

  return pullRequests
    .map((pullRequest) => {
      const matchingFiles = pullRequest.files
        .map((file) => file.replace(/^\.\//, ""))
        .filter((file) => planned.has(file));

      return {
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.url,
        baseRefName: pullRequest.baseRefName,
        headRefName: pullRequest.headRefName,
        matchingFiles,
      };
    })
    .filter((pullRequest) => pullRequest.matchingFiles.length > 0);
}

export function recommendIssueBranchBase(input: {
  configuredBaseBranch: string;
  overlappingPullRequests: IssueOverlappingPullRequest[];
  plannedFiles: string[];
}): IssueBranchBaseDecision {
  const { configuredBaseBranch, overlappingPullRequests, plannedFiles } = input;
  const eligible = overlappingPullRequests.filter(
    (pullRequest) => pullRequest.baseRefName === configuredBaseBranch
  );

  if (eligible.length === 1) {
    const pullRequest = eligible[0] as IssueOverlappingPullRequest;
    return {
      branchName: pullRequest.headRefName,
      pullRequestBaseBranch: pullRequest.headRefName,
      source: "pull-request-head",
      reason: `PR #${pullRequest.number} is the only open PR changing planned files: ${pullRequest.matchingFiles.join(", ")}.`,
      overlappingPullRequests,
    };
  }

  const covering = eligible.filter(
    (pullRequest) => pullRequest.matchingFiles.length === plannedFiles.length
  );
  if (covering.length === 1) {
    const pullRequest = covering[0] as IssueOverlappingPullRequest;
    return {
      branchName: pullRequest.headRefName,
      pullRequestBaseBranch: pullRequest.headRefName,
      source: "pull-request-head",
      reason: `PR #${pullRequest.number} covers all planned files, so a stacked branch avoids starting from stale file content.`,
      overlappingPullRequests,
    };
  }

  return {
    branchName: configuredBaseBranch,
    pullRequestBaseBranch: configuredBaseBranch,
    source: "configured-base",
    reason:
      "Multiple or ambiguous open PR overlaps were found, so the configured base branch is safer than guessing a stacked dependency.",
    overlappingPullRequests,
  };
}

export function formatSuperpowersPlanArtifactComment(planMarkdown: string): string {
  const trimmed = planMarkdown.trim();
  if (trimmed.startsWith(ISSUE_PLAN_COMMENT_MARKER)) {
    return `${trimmed}\n`;
  }

  return `${ISSUE_PLAN_COMMENT_MARKER}\n${trimmed}\n`;
}

export function formatSuperpowersSpecArtifactComment(specMarkdown: string): string {
  const trimmed = specMarkdown.trim();
  if (trimmed.startsWith(ISSUE_SPEC_COMMENT_MARKER)) {
    return `${trimmed}\n`;
  }

  return `${ISSUE_SPEC_COMMENT_MARKER}\n${trimmed}\n`;
}

export function logSuperpowersPlanPublicationMessage(
  outputLogPath: string,
  message: string
): void {
  console.log(message);
  appendFileSync(outputLogPath, `${message}\n`, "utf8");
}

export function findLatestIssueSpecComment(
  comments: RepositoryComment[]
): RepositoryComment | undefined {
  return comments
    .filter((comment) => startsWithManagedMarker(comment.body, [ISSUE_SPEC_COMMENT_MARKER]))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

export function findLatestIssuePlanComment(
  comments: RepositoryComment[]
): IssuePlanComment | undefined {
  const comment = comments
    .filter((candidate) =>
      startsWithManagedMarker(candidate.body, [ISSUE_PLAN_COMMENT_MARKER])
    )
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];

  if (!comment) {
    return undefined;
  }

  return {
    id: comment.id,
    body: comment.body,
    url: comment.url,
    updatedAt: comment.updatedAt,
  };
}

export async function publishSuperpowersSpecArtifact(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  specFilePath: string;
  outputLogPath: string;
  existingSpecComment?: RepositoryComment | null;
  outputMode?: GitHubOutputMode;
}): Promise<RepositoryComment | IssuePlanComment | undefined> {
  const specFile = toRepoRelativePath(options.repoRoot, options.specFilePath);

  if (!existsSync(options.specFilePath)) {
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Superpowers spec publication skipped because ${specFile} does not exist.`
    );
    return undefined;
  }

  const specMarkdown = readFileSync(options.specFilePath, "utf8").trim();
  if (!specMarkdown) {
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Superpowers spec publication skipped because ${specFile} is empty.`
    );
    return undefined;
  }

  const renderedSpec = applyGitHubOutputFraming(
    formatSuperpowersSpecArtifactComment(specMarkdown),
    options.outputMode
  );
  const existingSpecComment =
    options.existingSpecComment === undefined
      ? findLatestIssueSpecComment(
          await options.forge.fetchIssueComments(options.issueNumber)
        )
      : options.existingSpecComment ?? undefined;

  if (existingSpecComment) {
    const comment = await options.forge.updateIssueComment(
      existingSpecComment.id,
      renderedSpec
    );
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Updated issue specification comment from Superpowers spec: ${comment.url}`
    );
    return comment;
  }

  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    renderedSpec
  );
  logSuperpowersPlanPublicationMessage(
    options.outputLogPath,
    `Created issue specification comment from Superpowers spec: ${comment.url}`
  );
  return comment;
}

export function formatIssueSpecCommentFromIssue(input: {
  issueNumber: number;
  issue: IssueDetails;
  outputMode?: GitHubOutputMode;
}): string {
  const issueBody = input.issue.body.trim() || "(No issue body provided.)";

  return applyGitHubOutputFraming([
    ISSUE_SPEC_COMMENT_MARKER,
    `# Issue Specification: ${input.issue.title}`,
    "",
    "## Source",
    "",
    `- Issue: #${input.issueNumber}`,
    `- URL: ${input.issue.url}`,
    "",
    "## Summary",
    "",
    issueBody,
    "",
    "## Notes",
    "",
    "This specification was generated from the issue context when implementation preparation started. Refine the issue for a richer settled specification when needed.",
    "",
  ].join("\n"), input.outputMode);
}

export async function ensureIssueSpecComment(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  issue: IssueDetails;
  specFilePath?: string;
  outputLogPath?: string;
  comments?: RepositoryComment[];
  outputMode?: GitHubOutputMode;
}): Promise<RepositoryComment | IssuePlanComment> {
  const existingSpecComment = findLatestIssueSpecComment(
    options.comments ?? (await options.forge.fetchIssueComments(options.issueNumber))
  );
  if (existingSpecComment) {
    return existingSpecComment;
  }

  if (options.specFilePath && existsSync(options.specFilePath)) {
    const specComment = await publishSuperpowersSpecArtifact({
      repoRoot: options.repoRoot,
      forge: options.forge,
      issueNumber: options.issueNumber,
      specFilePath: options.specFilePath,
      outputLogPath:
        options.outputLogPath ?? resolve(options.repoRoot, ".prs", "issue-spec.log"),
      existingSpecComment: null,
      outputMode: options.outputMode,
    });

    if (specComment) {
      return specComment;
    }
  }

  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    formatIssueSpecCommentFromIssue({
      issueNumber: options.issueNumber,
      issue: options.issue,
      outputMode: options.outputMode,
    })
  );
  console.log(`Created issue specification comment from issue context: ${comment.url}`);
  return comment;
}

export async function publishSuperpowersPlanArtifact(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  planFilePath: string;
  outputLogPath: string;
  existingPlanComment?: IssuePlanComment | null;
  outputMode?: GitHubOutputMode;
}): Promise<IssuePlanComment | undefined> {
  const planFile = toRepoRelativePath(options.repoRoot, options.planFilePath);

  if (!existsSync(options.planFilePath)) {
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Superpowers plan publication skipped because ${planFile} does not exist.`
    );
    return undefined;
  }

  const planMarkdown = readFileSync(options.planFilePath, "utf8").trim();
  if (!planMarkdown) {
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Superpowers plan publication skipped because ${planFile} is empty.`
    );
    return undefined;
  }

  const renderedPlan = applyGitHubOutputFraming(
    formatSuperpowersPlanArtifactComment(planMarkdown),
    options.outputMode
  );
  const existingPlanComment =
    options.existingPlanComment === undefined
      ? await options.forge.fetchIssuePlanComment(options.issueNumber)
      : options.existingPlanComment ?? undefined;

  if (existingPlanComment) {
    const comment = await options.forge.updateIssuePlanComment(
      existingPlanComment.id,
      renderedPlan
    );
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Updated issue resolution plan comment from Superpowers plan: ${comment.url}`
    );
    return comment;
  }

  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    renderedPlan
  );
  logSuperpowersPlanPublicationMessage(
    options.outputLogPath,
    `Created issue resolution plan comment from Superpowers plan: ${comment.url}`
  );
  return comment;
}

export async function publishIssueRefinementCompleteComment(options: {
  forge: RepositoryForge;
  issueNumber: number;
  comments: RepositoryComment[];
  outputLogPath: string;
  outputMode?: GitHubOutputMode;
}): Promise<void> {
  if (
    options.comments.some((comment) =>
      comment.body.includes(ISSUE_REFINEMENT_COMPLETE_COMMENT_MARKER)
    )
  ) {
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      "Issue refinement completion comment already exists."
    );
    return;
  }

  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    applyGitHubOutputFraming(
      [
        ISSUE_REFINEMENT_COMPLETE_COMMENT_MARKER,
        "Refinement is complete. The settled specification and implementation plan have been attached to this issue in managed comments, so development can start from those artifacts.",
        "",
      ].join("\n"),
      options.outputMode
    )
  );
  logSuperpowersPlanPublicationMessage(
    options.outputLogPath,
    `Created issue refinement completion comment: ${comment.url}`
  );
}

export function formatIssueRefinementQuestionsComment(
  questionsMarkdown: string,
  outputMode?: GitHubOutputMode
): string {
  const trimmed = questionsMarkdown.trim();
  if (trimmed.startsWith(ISSUE_REFINEMENT_QUESTIONS_COMMENT_MARKER)) {
    return applyGitHubOutputFraming(`${trimmed}\n`, outputMode);
  }

  return applyGitHubOutputFraming(
    `${ISSUE_REFINEMENT_QUESTIONS_COMMENT_MARKER}\n${trimmed}\n`,
    outputMode
  );
}

export async function publishIssueRefinementQuestionsComment(options: {
  forge: RepositoryForge;
  issueNumber: number;
  questionsMarkdown: string;
  outputLogPath: string;
  outputMode?: GitHubOutputMode;
}): Promise<RepositoryComment | IssuePlanComment> {
  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    formatIssueRefinementQuestionsComment(options.questionsMarkdown, options.outputMode)
  );
  logSuperpowersPlanPublicationMessage(
    options.outputLogPath,
    `Created issue refinement questions comment: ${comment.url}`
  );
  return comment;
}

export async function publishRefinedIssueSpecComment(options: {
  forge: RepositoryForge;
  issueNumber: number;
  refinedMarkdown: string;
  comments: RepositoryComment[];
  outputLogPath: string;
  outputMode?: GitHubOutputMode;
}): Promise<RepositoryComment | IssuePlanComment> {
  const renderedSpec = applyGitHubOutputFraming(
    formatSuperpowersSpecArtifactComment(options.refinedMarkdown),
    options.outputMode
  );
  const existingSpecComment = findLatestIssueSpecComment(options.comments);

  if (existingSpecComment) {
    const comment = await options.forge.updateIssueComment(
      existingSpecComment.id,
      renderedSpec
    );
    logSuperpowersPlanPublicationMessage(
      options.outputLogPath,
      `Updated issue specification comment from refined issue draft: ${comment.url}`
    );
    return comment;
  }

  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    renderedSpec
  );
  logSuperpowersPlanPublicationMessage(
    options.outputLogPath,
    `Created issue specification comment from refined issue draft: ${comment.url}`
  );
  return comment;
}

export async function publishIssueRefinementArtifacts(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueUrl: string;
  refinedMarkdown: string;
  comments: RepositoryComment[];
  workspace: IssueRefineWorkspace;
  useCodexSuperpowers: boolean;
  outputMode?: GitHubOutputMode;
}): Promise<void> {
  let specComment: RepositoryComment | IssuePlanComment | undefined;
  const existingSpecComment = findLatestIssueSpecComment(options.comments) ?? null;
  const existingPlanComment = findLatestIssuePlanComment(options.comments) ?? null;

  if (options.useCodexSuperpowers) {
    specComment = await publishSuperpowersSpecArtifact({
      repoRoot: options.repoRoot,
      forge: options.forge,
      issueNumber: options.issueNumber,
      specFilePath: options.workspace.superpowersSpecFilePath,
      outputLogPath: options.workspace.outputLogPath,
      existingSpecComment,
      outputMode: options.outputMode,
    });
  }

  if (!specComment) {
    specComment = await publishRefinedIssueSpecComment({
      forge: options.forge,
      issueNumber: options.issueNumber,
      refinedMarkdown: options.refinedMarkdown,
      comments: options.comments,
      outputLogPath: options.workspace.outputLogPath,
      outputMode: options.outputMode,
    });
  }

  let planComment: IssuePlanComment | undefined;
  if (options.useCodexSuperpowers) {
    planComment = await publishSuperpowersPlanArtifact({
      repoRoot: options.repoRoot,
      forge: options.forge,
      issueNumber: options.issueNumber,
      planFilePath: options.workspace.superpowersPlanFilePath,
      outputLogPath: options.workspace.outputLogPath,
      existingPlanComment,
      outputMode: options.outputMode,
    });
  }

  if (!planComment) {
    planComment = await createStructuredIssuePlanComment({
      repoRoot: options.repoRoot,
      forge: options.forge,
      issueNumber: options.issueNumber,
      issue: {
        title: options.issueTitle,
        body: options.issueBody,
        url: options.issueUrl,
      },
      existingPlanComment: existingPlanComment ?? undefined,
      mode: "explicit-plan-command",
      comments: options.comments,
      specAlreadyEnsured: Boolean(specComment),
      outputMode: options.outputMode,
    });
  }

  if (planComment) {
    const publication = await publishAutomaticIssueEstimate({
      issueNumber: options.issueNumber,
      repoRoot: options.repoRoot,
      forge: options.forge,
      repositoryConfig: getRepositoryConfig(options.repoRoot),
    });
    logSuperpowersPlanPublicationMessage(
      options.workspace.outputLogPath,
      publication.status === "skipped"
        ? `Automatic estimate skipped: ${publication.reason}`
        : `Automatic estimate ${publication.status}: ${publication.url}`
    );
  }

  await publishIssueRefinementCompleteComment({
    forge: options.forge,
    issueNumber: options.issueNumber,
    comments: options.comments,
    outputLogPath: options.workspace.outputLogPath,
    outputMode: options.outputMode,
  });
}

export function formatNumberedMarkdownList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

export function renderIssueResolutionPlanComment(
  issueNumber: number,
  plan: GeneratedIssueResolutionPlan,
  outputMode?: GitHubOutputMode
): string {
  const lines = [
    ISSUE_PLAN_COMMENT_MARKER,
    "## Issue Resolution Plan",
    "",
    `Generated by \`prs issue plan ${issueNumber}\`. Edit this comment directly on GitHub to refine the plan. Later \`prs issue\` runs will use the latest version of this comment.`,
    "",
    "### Summary",
    plan.summary,
    "",
    "### Acceptance criteria",
    formatMarkdownList(plan.acceptanceCriteria),
    "",
    "### Likely files",
    formatMarkdownList(plan.likelyFiles),
    "",
    "### Implementation steps",
    formatNumberedMarkdownList(plan.implementationSteps),
    "",
    "### Test plan",
    formatMarkdownList(plan.testPlan),
  ];

  lines.push("", "### Risks", formatMarkdownList(plan.risks));
  lines.push("", "### Done definition", formatMarkdownList(plan.doneDefinition));

  if (plan.openQuestions && plan.openQuestions.length > 0) {
    lines.push("", "### Open questions", formatMarkdownList(plan.openQuestions));
  }

  lines.push("");
  return applyGitHubOutputFraming(lines.join("\n"), outputMode);
}

export function createAuditPublicationHints(input: {
  issues: CreatedIssueRecord[];
  runDir?: string;
}): Array<{ issueNumber: number; file: string; section: string; mode: string }> {
  if (!input.runDir) {
    return [];
  }

  const tokenUsageArtifactFilePath = getIssueTokenUsageArtifactFilePath(input.runDir);
  if (!existsSync(tokenUsageArtifactFilePath)) {
    return [];
  }

  return input.issues.map((issue) => ({
    issueNumber: issue.number,
    file: tokenUsageArtifactFilePath,
    section: "token-usage",
    mode: "issue-token-usage-ledger",
  }));
}

export type ManagedCommentHint = {
  issueNumber: number;
  marker: typeof ISSUE_SPEC_COMMENT_MARKER | typeof ISSUE_PLAN_COMMENT_MARKER;
  requiredFor: "issue-source-of-truth" | string;
  status: "artifact-provided" | "missing";
  file?: string;
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

export type EstimatePublicationHint = {
  issueNumber: number;
  status: "created" | "updated" | "skipped";
  url?: string;
  reason?: string;
};

export function createManagedSpecCommentHint(
  issueNumber: number,
  specFilePath?: string
): ManagedCommentHint {
  return {
    issueNumber,
    marker: ISSUE_SPEC_COMMENT_MARKER,
    requiredFor: "issue-source-of-truth",
    status: specFilePath ? "artifact-provided" : "missing",
    ...(specFilePath ? { file: specFilePath } : {}),
    nextAction: specFilePath
      ? `Publish a managed issue spec comment containing \`${ISSUE_SPEC_COMMENT_MARKER}\` after creating the issue.`
      : `Create or publish a managed issue spec comment containing \`${ISSUE_SPEC_COMMENT_MARKER}\`.`,
  };
}

export function createManagedPlanCommentHint(
  issueNumber: number,
  planFilePath?: string
): ManagedCommentHint {
  return {
    issueNumber,
    marker: ISSUE_PLAN_COMMENT_MARKER,
    requiredFor: `prs issue estimate ${issueNumber}`,
    status: planFilePath ? "artifact-provided" : "missing",
    ...(planFilePath ? { file: planFilePath } : {}),
    nextAction: planFilePath
      ? `Publish a managed issue plan comment containing \`${ISSUE_PLAN_COMMENT_MARKER}\` or run \`prs issue plan ${issueNumber}\` before estimating.`
      : `Create or publish a managed issue plan comment containing \`${ISSUE_PLAN_COMMENT_MARKER}\`, or run \`prs issue plan ${issueNumber}\`, before estimating.`,
  };
}

export function resolveOptionalRepoPath(
  repoRoot: string,
  filePath: string | undefined
): string | undefined {
  return filePath ? resolve(repoRoot, filePath) : undefined;
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
  const specFilePath = resolveOptionalRepoPath(input.repoRoot, input.specFilePath);
  const planFilePath = resolveOptionalRepoPath(input.repoRoot, input.planFilePath);
  const managedComments: ManagedCommentPublication[] = [];
  const managedCommentHints: ManagedCommentHint[] = [];

  for (const issue of input.issues) {
    if (specFilePath && existsSync(specFilePath)) {
      const specMarkdown = readFileSync(specFilePath, "utf8").trim();
      if (specMarkdown) {
        const renderedSpec = formatSuperpowersSpecArtifactComment(specMarkdown);
        const existingSpecComment = findLatestIssueSpecComment(
          await input.forge.fetchIssueComments(issue.number)
        );
        const comment = existingSpecComment
          ? await input.forge.updateIssueComment(existingSpecComment.id, renderedSpec)
          : await input.forge.createIssuePlanComment(issue.number, renderedSpec);
        managedComments.push({
          issueNumber: issue.number,
          marker: ISSUE_SPEC_COMMENT_MARKER,
          status: "published",
          file: specFilePath,
          id: comment.id,
          url: comment.url,
        });
      } else {
        managedCommentHints.push(createManagedSpecCommentHint(issue.number, specFilePath));
      }
    } else {
      managedCommentHints.push(createManagedSpecCommentHint(issue.number, specFilePath));
    }

    if (planFilePath && existsSync(planFilePath)) {
      const planMarkdown = readFileSync(planFilePath, "utf8").trim();
      if (planMarkdown) {
        const renderedPlan = formatSuperpowersPlanArtifactComment(planMarkdown);
        const existingPlanComment = await input.forge.fetchIssuePlanComment(issue.number);
        const comment = existingPlanComment
          ? await input.forge.updateIssuePlanComment(existingPlanComment.id, renderedPlan)
          : await input.forge.createIssuePlanComment(issue.number, renderedPlan);
        managedComments.push({
          issueNumber: issue.number,
          marker: ISSUE_PLAN_COMMENT_MARKER,
          status: "published",
          file: planFilePath,
          id: comment.id,
          url: comment.url,
        });
      } else {
        managedCommentHints.push(createManagedPlanCommentHint(issue.number, planFilePath));
      }
    } else {
      managedCommentHints.push(createManagedPlanCommentHint(issue.number, planFilePath));
    }
  }

  return {
    managedComments,
    managedCommentHints,
  };
}

export async function publishAutomaticEstimateHints(input: {
  repoRoot: string;
  forge: RepositoryForge;
  repositoryConfig: ResolvedRepositoryConfigType;
  issues: CreatedIssueRecord[];
  managedComments: ManagedCommentPublication[];
}): Promise<EstimatePublicationHint[]> {
  const planIssueNumbers = new Set(
    input.managedComments
      .filter((comment) => comment.marker === ISSUE_PLAN_COMMENT_MARKER)
      .map((comment) => comment.issueNumber)
  );
  const hints: EstimatePublicationHint[] = [];

  for (const issue of input.issues) {
    if (!planIssueNumbers.has(issue.number)) {
      continue;
    }

    const publication = await publishAutomaticIssueEstimate({
      issueNumber: issue.number,
      repoRoot: input.repoRoot,
      forge: input.forge,
      repositoryConfig: input.repositoryConfig,
    });

    hints.push({
      issueNumber: issue.number,
      status: publication.status,
      ...(publication.status === "skipped"
        ? { reason: publication.reason }
        : { url: publication.url }),
    });
  }

  return hints;
}

export async function createStructuredIssuePlanComment(options: {
  repoRoot: string;
  forge: RepositoryForge;
  issueNumber: number;
  issue: IssueDetails;
  existingPlanComment?: IssuePlanComment;
  mode: IssuePlanResolutionMode;
  workflowRole?: RepositoryAiWorkflowRole;
  comments?: RepositoryComment[];
  specAlreadyEnsured?: boolean;
  outputMode?: GitHubOutputMode;
}): Promise<IssuePlanComment> {
  const workflowRole =
    options.workflowRole ??
    (options.mode === "execution-preflight" ? "implementer" : "planner");

  if (
    options.mode === "execution-preflight" &&
    !options.existingPlanComment &&
    !options.specAlreadyEnsured
  ) {
    await ensureIssueSpecComment({
      repoRoot: options.repoRoot,
      forge: options.forge,
      issueNumber: options.issueNumber,
      issue: options.issue,
      comments: options.comments,
      outputMode: options.outputMode,
    });
  }

  const { provider } = await createProvider(options.repoRoot);
  const plan = await generateIssueResolutionPlan(provider, {
    issueNumber: options.issueNumber,
    issueTitle: options.issue.title,
    issueBody: options.issue.body,
    issueUrl: options.issue.url,
  });
  const renderedPlan = renderIssueResolutionPlanComment(
    options.issueNumber,
    plan,
    options.outputMode
  );

  if (options.existingPlanComment) {
    const comment = await options.forge.updateIssuePlanComment(
      options.existingPlanComment.id,
      renderedPlan
    );
    if (options.mode === "explicit-plan-command") {
      console.log(`Refreshed issue resolution plan comment: ${comment.url}`);
    }
    return comment;
  }

  const comment = await options.forge.createIssuePlanComment(
    options.issueNumber,
    renderedPlan
  );
  console.log(
    options.mode === "execution-preflight"
      ? `Created issue resolution plan comment before issue execution: ${comment.url}`
      : `Created issue resolution plan comment: ${comment.url}`
  );
  return comment;
}
