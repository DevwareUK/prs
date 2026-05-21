export type ActionableIssue = {
  number: number;
  title: string;
  url: string;
  author: string;
  assignees: string[];
  labels: string[];
  updatedAt: string;
  hasLinkedOpenPullRequest: boolean;
  hasPrsPlan: boolean;
};

export type ActionablePullRequest = {
  number: number;
  title: string;
  url: string;
  author: string;
  assignees: string[];
  reviewRequestedFrom: string[];
  headRefName: string;
  labels: string[];
  updatedAt: string;
  hasConflicts: boolean;
  hasFailedChecks: boolean;
  hasUnresolvedReviewComments: boolean;
  hasPrsTestSuggestions: boolean;
};

const READY_ISSUE_LABELS = new Set([
  "ready",
  "accepted",
  "approved",
  "prs-ready",
  "ai-ready",
]);

function hasReadyIssueLabel(issue: ActionableIssue): boolean {
  return issue.labels.some((label) => READY_ISSUE_LABELS.has(label.toLowerCase()));
}

function issueScore(issue: ActionableIssue, currentUser: string): number {
  let score = 0;
  if (issue.assignees.includes(currentUser)) score += 100;
  if (issue.hasPrsPlan) score += 80;
  if (issue.author === currentUser) score += 60;
  if (hasReadyIssueLabel(issue)) score += 40;
  return score;
}

function pullRequestScore(pr: ActionablePullRequest, currentUser: string): number {
  let score = 0;
  if (pr.hasConflicts) score += 120;
  if (pr.hasFailedChecks) score += 110;
  if (pr.hasUnresolvedReviewComments) score += 100;
  if (pr.hasPrsTestSuggestions) score += 90;
  if (pr.reviewRequestedFrom.includes(currentUser)) score += 80;
  if (pr.assignees.includes(currentUser)) score += 70;
  if (pr.author === currentUser) score += 60;
  if (pr.headRefName.includes(currentUser)) score += 20;
  return score;
}

function compareByScoreThenUpdatedAt<T extends { updatedAt: string }>(
  left: T,
  right: T,
  leftScore: number,
  rightScore: number
): number {
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

export function filterActionableIssuesForUser(
  issues: ActionableIssue[],
  currentUser: string
): ActionableIssue[] {
  return issues
    .filter((issue) => !issue.hasLinkedOpenPullRequest)
    .filter(
      (issue) =>
        issue.assignees.includes(currentUser) ||
        issue.author === currentUser ||
        issue.hasPrsPlan ||
        hasReadyIssueLabel(issue)
    )
    .sort((left, right) =>
      compareByScoreThenUpdatedAt(
        left,
        right,
        issueScore(left, currentUser),
        issueScore(right, currentUser)
      )
    );
}

export function filterActionablePullRequestsForUser(
  pullRequests: ActionablePullRequest[],
  currentUser: string
): ActionablePullRequest[] {
  return pullRequests
    .filter((pr) => pullRequestScore(pr, currentUser) > 0)
    .sort((left, right) =>
      compareByScoreThenUpdatedAt(
        left,
        right,
        pullRequestScore(left, currentUser),
        pullRequestScore(right, currentUser)
      )
    );
}
