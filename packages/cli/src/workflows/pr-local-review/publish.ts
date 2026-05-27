import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  applyGitHubOutputFraming,
  PRReviewComment,
  type GitHubOutputMode,
} from "@prs/contracts";
import { publishAuditArtifact } from "../../audit-artifacts";
import type {
  PullRequestInlineReviewCommentInput,
  RepositoryForge,
} from "../../forge";

const PRS_INLINE_REVIEW_METADATA_PATTERN =
  /<!--\s*prs:pr-review-inline\s+({[\s\S]*?})\s*-->/;

type PublishPullRequestLocalReviewOptions = {
  repoRoot: string;
  prNumber: number;
  reportFilePath: string;
  commentsFilePath: string;
  forge: RepositoryForge;
  outputMode?: GitHubOutputMode;
};

type PrsInlineMetadata = {
  source: "prs:pr-review";
  headSha?: string;
  findingKey: string;
  path?: string;
  line?: number;
  category?: string;
};

type PublishPullRequestLocalReviewResult = {
  status: "published";
  prNumber: number;
  auditCommentUrl: string;
  inlineReviewUrl?: string;
  inlineCommentsPublished: number;
  skipped: {
    invalid: number;
    nonHighConfidence: number;
    unchangedLine: number;
    duplicate: number;
    existing: number;
  };
};

function normalizeFindingValue(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildFindingKey(comment: {
  path: string;
  line: number;
  category: string;
  body: string;
  whyThisMatters: string;
}): string {
  return [
    normalizeFindingValue(comment.path),
    String(comment.line),
    normalizeFindingValue(comment.category),
    normalizeFindingValue(comment.body),
    normalizeFindingValue(comment.whyThisMatters),
  ]
    .filter(Boolean)
    .join(":");
}

function parsePrsInlineMetadata(body: string): PrsInlineMetadata | undefined {
  const match = body.match(PRS_INLINE_REVIEW_METADATA_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1]) as Partial<PrsInlineMetadata>;
    return parsed.source === "prs:pr-review" && typeof parsed.findingKey === "string"
      ? (parsed as PrsInlineMetadata)
      : undefined;
  } catch {
    return undefined;
  }
}

function collectChangedLines(diff: string): Map<string, Set<number>> {
  const changedLinesByPath = new Map<string, Set<number>>();
  let currentPath: string | undefined;
  let newLine = 0;

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("+++ b/")) {
      currentPath = rawLine.slice(6);
      if (!changedLinesByPath.has(currentPath)) {
        changedLinesByPath.set(currentPath, new Set());
      }
      continue;
    }

    const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = Number.parseInt(hunkMatch[1], 10);
      continue;
    }

    if (!currentPath) {
      continue;
    }

    if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
      changedLinesByPath.get(currentPath)?.add(newLine);
      newLine += 1;
      continue;
    }

    if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
      continue;
    }

    if (rawLine.startsWith(" ")) {
      newLine += 1;
    }
  }

  return changedLinesByPath;
}

function extractDiffFromContext(context: string): string {
  const match = context.match(/```diff\n([\s\S]*?)\n```/);
  return match?.[1] ?? "";
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatInlineCommentBody(
  comment: ReturnType<typeof PRReviewComment.parse>,
  headSha?: string,
  outputMode?: GitHubOutputMode
): string {
  const findingKey = buildFindingKey(comment);
  const metadata = JSON.stringify({
    source: "prs:pr-review",
    headSha,
    findingKey,
    path: comment.path,
    line: comment.line,
    category: comment.category,
  });
  const lines = [
    `**${toTitleCase(comment.severity)} severity, ${toTitleCase(
      comment.confidence
    )} confidence ${toTitleCase(comment.category)}**`,
    "",
    comment.body,
    "",
    `Why this matters: ${comment.whyThisMatters}`,
  ];

  if (comment.suggestedFix) {
    lines.push("", `Suggested fix: ${comment.suggestedFix}`);
  }

  lines.push("", `<!-- prs:pr-review-inline ${metadata} -->`);
  return applyGitHubOutputFraming(lines.join("\n"), outputMode);
}

async function collectExistingFindingKeys(
  forge: RepositoryForge,
  prNumber: number,
  currentHeadSha?: string
): Promise<Set<string>> {
  const existingFindingKeys = new Set<string>();
  if (!forge.fetchPullRequestReviewThreads) {
    return existingFindingKeys;
  }

  const threads = await forge.fetchPullRequestReviewThreads(prNumber);
  for (const thread of threads) {
    const threadComments = thread.comments;
    const metadataIndex = threadComments.findIndex((comment) =>
      Boolean(parsePrsInlineMetadata(comment.body))
    );
    const metadata =
      metadataIndex >= 0
        ? parsePrsInlineMetadata(threadComments[metadataIndex].body)
        : undefined;
    if (!metadata?.findingKey || thread.isResolved) {
      continue;
    }

    const hasLaterHumanReply = threadComments
      .slice(metadataIndex + 1)
      .some((comment) => !comment.authorIsBot);

    if (metadata.headSha && currentHeadSha && metadata.headSha !== currentHeadSha) {
      if (hasLaterHumanReply) {
        existingFindingKeys.add(metadata.findingKey);
        continue;
      }

      if (forge.resolvePullRequestReviewThread && thread.nodeId) {
        await forge.resolvePullRequestReviewThread(thread.nodeId);
      }
      continue;
    }

    if (!thread.isOutdated) {
      existingFindingKeys.add(metadata.findingKey);
    }
  }

  return existingFindingKeys;
}

function parseReviewComments(rawContent: string): {
  comments: ReturnType<typeof PRReviewComment.parse>[];
  invalid: number;
} {
  const parsed = JSON.parse(rawContent) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Codex PR review comments file must contain a JSON array.");
  }

  const comments: ReturnType<typeof PRReviewComment.parse>[] = [];
  let invalid = 0;
  for (const rawComment of parsed) {
    const result = PRReviewComment.safeParse(rawComment);
    if (result.success) {
      comments.push(result.data);
    } else {
      invalid += 1;
    }
  }

  return { comments, invalid };
}

export async function publishPullRequestLocalReview(
  options: PublishPullRequestLocalReviewOptions
): Promise<PublishPullRequestLocalReviewResult> {
  const reportFilePath = resolve(options.repoRoot, options.reportFilePath);
  const commentsFilePath = resolve(options.repoRoot, options.commentsFilePath);
  const contextFilePath = resolve(dirname(reportFilePath), "pr-review-context.md");

  if (!existsSync(reportFilePath)) {
    throw new Error(`Codex PR review report file does not exist: ${options.reportFilePath}`);
  }
  if (!existsSync(commentsFilePath)) {
    throw new Error(`Codex PR review comments file does not exist: ${options.commentsFilePath}`);
  }
  if (!existsSync(contextFilePath)) {
    throw new Error(`Codex PR review context file does not exist: ${contextFilePath}`);
  }

  const reportContent = readFileSync(reportFilePath, "utf8").trim();
  if (!reportContent) {
    throw new Error(`Codex PR review report file is empty: ${options.reportFilePath}`);
  }

  const pullRequest = await options.forge.fetchPullRequestDetails(options.prNumber);
  const contextContent = readFileSync(contextFilePath, "utf8");
  const changedLinesByPath = collectChangedLines(extractDiffFromContext(contextContent));
  const parsedComments = parseReviewComments(readFileSync(commentsFilePath, "utf8"));
  const existingFindingKeys = await collectExistingFindingKeys(
    options.forge,
    options.prNumber,
    pullRequest.headSha
  );
  const dedupe = new Set<string>();
  const skipped = {
    invalid: parsedComments.invalid,
    nonHighConfidence: 0,
    unchangedLine: 0,
    duplicate: 0,
    existing: 0,
  };
  const inlineComments: PullRequestInlineReviewCommentInput[] = [];

  for (const comment of parsedComments.comments) {
    if (comment.confidence !== "high") {
      skipped.nonHighConfidence += 1;
      continue;
    }

    const changedLines = changedLinesByPath.get(comment.path);
    if (!changedLines?.has(comment.line)) {
      skipped.unchangedLine += 1;
      continue;
    }

    const findingKey = buildFindingKey(comment);
    if (dedupe.has(findingKey)) {
      skipped.duplicate += 1;
      continue;
    }
    if (existingFindingKeys.has(findingKey)) {
      skipped.existing += 1;
      continue;
    }

    dedupe.add(findingKey);
    inlineComments.push({
      path: comment.path,
      line: comment.line,
      side: "RIGHT",
      body: formatInlineCommentBody(comment, pullRequest.headSha, options.outputMode),
    });
  }

  const audit = await publishAuditArtifact(options.forge, {
    target: { type: "pull-request", number: options.prNumber },
    sectionName: "Codex PR review",
    content: reportContent,
    outputMode: options.outputMode,
  });

  let inlineReviewUrl: string | undefined;
  if (inlineComments.length > 0) {
    if (!options.forge.createPullRequestReview) {
      throw new Error("Repository forge does not support creating pull request reviews.");
    }
    const review = await options.forge.createPullRequestReview({
      prNumber: options.prNumber,
      commitSha: pullRequest.headSha,
      body: applyGitHubOutputFraming(
        `Local Codex PR review generated ${inlineComments.length} high-confidence inline comment${
          inlineComments.length === 1 ? "" : "s"
        } on changed lines.`,
        options.outputMode
      ),
      comments: inlineComments,
    });
    inlineReviewUrl = review.url;
  }

  return {
    status: "published",
    prNumber: options.prNumber,
    auditCommentUrl: audit.comment.url,
    inlineReviewUrl,
    inlineCommentsPublished: inlineComments.length,
    skipped,
  };
}
