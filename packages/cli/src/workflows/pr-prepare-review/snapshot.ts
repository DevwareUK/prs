import {
  PR_ASSISTANT_END_MARKER,
  PR_ASSISTANT_START_MARKER,
  stripManagedPRAssistantSection,
} from "@prs/core";
import { fetchLinkedIssuesForPullRequest } from "../pr-fix-comments/snapshot";
import type { PullRequestPrepareReviewSnapshotInput } from "./types";

export { fetchLinkedIssuesForPullRequest };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractManagedPRAssistantSection(body: string): string | undefined {
  const pattern = new RegExp(
    `${escapeRegExp(PR_ASSISTANT_START_MARKER)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(
      PR_ASSISTANT_END_MARKER
    )}`,
    "m"
  );
  const match = body.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function formatCheckoutSource(
  checkoutTarget: PullRequestPrepareReviewSnapshotInput["checkoutTarget"]
): string {
  if (checkoutTarget.source === "issue-branch") {
    return `Reused saved local issue branch from issue #${checkoutTarget.linkedIssueNumber}`;
  }

  if (checkoutTarget.source === "local-head") {
    return "Reused existing local PR head branch";
  }

  return `Fetched PR head into dedicated local review branch from ${checkoutTarget.headRefName}`;
}

function formatBaseSyncStatus(
  baseSync: PullRequestPrepareReviewSnapshotInput["baseSync"]
): string {
  if (baseSync.status === "up-to-date") {
    return `Already contained the latest ${baseSync.remoteRef} tip ${baseSync.baseTip}`;
  }

  if (baseSync.status === "merged") {
    return baseSync.conflictResolution === "required"
      ? `Merged ${baseSync.remoteRef} tip ${baseSync.baseTip} after Codex resolved merge conflicts`
      : `Merged the latest ${baseSync.remoteRef} tip ${baseSync.baseTip} into the checked-out branch`;
  }

  return `Blocked while syncing ${baseSync.remoteRef} tip ${baseSync.baseTip} into the checked-out branch`;
}

export function formatPullRequestPrepareReviewSnapshot(
  input: PullRequestPrepareReviewSnapshotInput
): string {
  const manualBody =
    stripManagedPRAssistantSection(input.pullRequest.body)?.trim() ||
    "(No pull request body provided.)";
  const managedAssistantSection = extractManagedPRAssistantSection(input.pullRequest.body);
  const lines = [
    "# Pull Request Review Preparation Snapshot",
    "",
    "## Pull Request",
    "",
    `- PR number: ${input.pullRequest.number}`,
    `- Title: ${input.pullRequest.title}`,
    `- URL: ${input.pullRequest.url}`,
    `- Base branch: ${input.pullRequest.baseRefName}`,
    `- Head branch: ${input.pullRequest.headRefName}`,
    "",
    "## Pull Request Body",
    "",
    manualBody,
  ];

  if (managedAssistantSection) {
    lines.push("", "## Managed PR Assistant Section", "", managedAssistantSection);
  }

  if (input.linkedIssues.length > 0) {
    lines.push("", "## Linked Issues");

    for (const linkedIssue of input.linkedIssues) {
      lines.push(
        "",
        `### Issue #${linkedIssue.issue.number}: ${linkedIssue.issue.title}`,
        "",
        `- URL: ${linkedIssue.issue.url}`
      );

      if (linkedIssue.sessionState) {
        lines.push(
          `- Saved branch: ${linkedIssue.sessionState.branchName}`,
          `- Saved runtime: ${linkedIssue.sessionState.runtimeType}`,
          `- Saved session id: ${linkedIssue.sessionState.sessionId ?? "None"}`
        );
      } else {
        lines.push("- Saved local issue state: None found");
      }

      lines.push("", linkedIssue.issue.body.trim() || "(No issue body provided.)");
    }
  }

  lines.push(
    "",
    "## Local Review Workspace",
    "",
    `- Checkout source: ${formatCheckoutSource(input.checkoutTarget)}`,
    `- Checked out branch: ${input.checkoutTarget.branchName}`,
    `- Base branch sync: ${formatBaseSyncStatus(input.baseSync)}`,
    `- Base branch sync summary: ${input.baseSync.summary}`,
    `- Base branch conflict resolution: ${input.baseSync.conflictResolution}`,
    `- Runtime invocation: ${input.runtimePlan.invocation}`,
    `- Runtime session reuse: ${
      input.runtimePlan.sessionId
        ? `Reusing linked issue #${input.runtimePlan.linkedIssueNumber} session ${input.runtimePlan.sessionId}`
        : "Starting a fresh Codex brief-generation run"
    }`,
    `- Configured verification command: ${input.buildCommandDisplay}`
  );

  if (input.baseSync.warnings.length > 0) {
    lines.push("", "## Base Branch Sync Warnings", "");
    lines.push(...input.baseSync.warnings.map((warning) => `- ${warning}`));
  }

  if (input.baseSync.recoveryMessage) {
    lines.push("", "## Base Branch Sync Recovery", "", input.baseSync.recoveryMessage);
  }

  if (input.runtimePlan.warnings.length > 0) {
    lines.push("", "## Runtime Warnings", "");
    lines.push(...input.runtimePlan.warnings.map((warning) => `- ${warning}`));
  }

  lines.push("");
  return lines.join("\n");
}
