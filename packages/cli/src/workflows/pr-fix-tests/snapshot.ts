import type { PullRequestDetails } from "../../forge";
import { fetchLinkedIssuesForPullRequest } from "../pr-fix-comments/snapshot";
import type {
  PullRequestLinkedIssueContext,
  PullRequestTestSuggestion,
  PullRequestTestSuggestionsComment,
} from "./types";

export { fetchLinkedIssuesForPullRequest };

function formatLikelyLocations(locations: string[]): string {
  if (locations.length === 0) {
    return "None provided";
  }

  return locations.join(", ");
}

export function formatPullRequestTestSuggestionsSnapshot(
  pullRequest: PullRequestDetails,
  selectedSuggestions: PullRequestTestSuggestion[],
  suggestionsComment: PullRequestTestSuggestionsComment,
  linkedIssues: PullRequestLinkedIssueContext[]
): string {
  const pullRequestBody = pullRequest.body.trim() || "(No pull request body provided.)";
  const lines = [
    "# Pull Request Test Suggestions Fix Snapshot",
    "",
    "## Pull Request",
    "",
    `- PR number: ${pullRequest.number}`,
    `- Title: ${pullRequest.title}`,
    `- URL: ${pullRequest.url}`,
    `- Base branch: ${pullRequest.baseRefName}`,
    `- Head branch: ${pullRequest.headRefName}`,
    "",
    "## Body",
    "",
    pullRequestBody,
    "",
    "## Managed AI test suggestions comment",
    "",
    `- Comment ID: ${suggestionsComment.sourceComment.id}`,
    `- URL: ${suggestionsComment.sourceComment.url}`,
    `- Updated at: ${suggestionsComment.sourceComment.updatedAt}`,
  ];

  if (suggestionsComment.overview) {
    lines.push("", "## Overview", "", suggestionsComment.overview);
  }

  if (linkedIssues.length > 0) {
    lines.push("", "## Linked issues");

    for (const issue of linkedIssues) {
      lines.push(
        "",
        `### Issue #${issue.number}: ${issue.title}`,
        "",
        `- URL: ${issue.url}`,
        "",
        issue.body.trim() || "(No issue body provided.)"
      );
    }
  }

  lines.push("", "## Selected test suggestions");

  for (const [index, suggestion] of selectedSuggestions.entries()) {
    lines.push(
      "",
      `### Suggestion ${index + 1}: ${suggestion.area}`,
      "",
      `- Priority: ${suggestion.priority}`,
      `- Why it matters: ${suggestion.value}`,
      `- Likely locations: ${formatLikelyLocations(suggestion.likelyLocations)}`,
      "",
      "#### Success looks like",
      "",
      "- Add or update automated tests for this selected area.",
      "- Keep the change focused on the selected testing gap.",
      "- Preserve the repository's existing test conventions and architecture."
    );
  }

  if (suggestionsComment.edgeCases.length > 0) {
    lines.push("", "## Suggested edge cases", "");
    lines.push(...suggestionsComment.edgeCases.map((edgeCase) => `- ${edgeCase}`));
  }

  if (suggestionsComment.likelyLocations.length > 0) {
    lines.push("", "## Likely places to add tests", "");
    lines.push(
      ...suggestionsComment.likelyLocations.map((location) => `- \`${location}\``)
    );
  }

  lines.push("");
  return lines.join("\n");
}
