import type {
  PRReviewCommentType,
  PRReviewFindingType,
  PRReviewOutputType,
} from "@prs/contracts";

export const MAX_PR_REVIEW_SIGNALS = 5;

type RankedSignalBase = {
  score: number;
  key: string;
};

export type RankedPRReviewSignal =
  | (RankedSignalBase & {
      kind: "finding";
      index: number;
      signal: PRReviewFindingType;
    })
  | (RankedSignalBase & {
      kind: "comment";
      index: number;
      signal: PRReviewCommentType;
    });

const SEVERITY_WEIGHT = {
  high: 300,
  medium: 200,
  low: 100,
} as const;

const CONFIDENCE_WEIGHT = {
  high: 30,
  medium: 20,
  low: 10,
} as const;

const KIND_WEIGHT = {
  finding: 1,
  comment: 0,
} as const;

function scoreSignal(
  signal: PRReviewFindingType | PRReviewCommentType
): number {
  return (
    SEVERITY_WEIGHT[signal.severity] + CONFIDENCE_WEIGHT[signal.confidence]
  );
}

export function rankPRReviewSignals(
  review: PRReviewOutputType
): RankedPRReviewSignal[] {
  const rankedSignals: RankedPRReviewSignal[] = [
    ...review.findings.map((finding, index) => ({
      kind: "finding" as const,
      index,
      signal: finding,
      key: `finding:${index}`,
      score: scoreSignal(finding),
    })),
    ...review.comments.map((comment, index) => ({
      kind: "comment" as const,
      index,
      signal: comment,
      key: `comment:${index}`,
      score: scoreSignal(comment),
    })),
  ];

  return rankedSignals.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }

    if (left.kind !== right.kind) {
      return KIND_WEIGHT[right.kind] - KIND_WEIGHT[left.kind];
    }

    return left.index - right.index;
  });
}

export function trimPRReviewOutput(
  review: PRReviewOutputType
): PRReviewOutputType {
  const selected = new Set(
    rankPRReviewSignals(review)
      .slice(0, MAX_PR_REVIEW_SIGNALS)
      .map((signal) => signal.key)
  );

  return {
    ...review,
    findings: review.findings.filter((_, index) =>
      selected.has(`finding:${index}`)
    ),
    comments: review.comments.filter((_, index) =>
      selected.has(`comment:${index}`)
    ),
  };
}
