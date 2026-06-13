import {
generateDiffSummary
} from "@prs/core";
import {
parseSetupCommandArgs
} from "./setup";

export { parseAuditCommandArgs } from "./commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "./commands/backlog";
export { parseIssueCommandArgs } from "./commands/issue";
export { parseReviewCommandArgs } from "./commands/review";
export { parseSetupCommandArgs };

export function formatCommitMessage(title: string, body?: string): string {
  return body ? `${title}\n\n${body}\n` : `${title}\n`;
}

export function formatMarkdownList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function formatDiffSummary(
  summary: Awaited<ReturnType<typeof generateDiffSummary>>
): string {
  const sections = [
    "Changes Overview",
    summary.summary,
    "",
    "Major Areas Affected",
  ];

  for (const area of summary.majorAreas) {
    sections.push(`- ${area}`);
  }

  if (summary.riskAreas && summary.riskAreas.length > 0) {
    sections.push("", "Potential Risk Areas");
    for (const risk of summary.riskAreas) {
      sections.push(`- ${risk}`);
    }
  }

  sections.push("");
  return sections.join("\n");
}
