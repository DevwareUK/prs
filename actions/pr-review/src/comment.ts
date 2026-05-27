import {
  applyGitHubOutputFraming,
  GitHubOutputMode,
  PRReviewOutputType,
} from "@prs/contracts";
import { formatPRReviewMarkdown } from "@prs/core";

export function buildCommentBody(
  review: PRReviewOutputType,
  issue: {
    number?: number;
    title?: string;
    url?: string;
  },
  outputMode: GitHubOutputMode = "unattended"
): string {
  return applyGitHubOutputFraming(
    formatPRReviewMarkdown(review, issue),
    outputMode
  );
}
