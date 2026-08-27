import type { CreatedIssueRecord, RepositoryForge } from "../../forge";
import { ensurePrsManagedIssueBody } from "./artifacts";
import type { ParsedIssueDraftSet, ParsedIssueDraftSetIssue } from "./draft-set";

type LinkedIssue = { id: string; number: number; url: string };
export type ToolCreatedIssueRecord = CreatedIssueRecord & { id?: string };

function formatIssueNumberList(
  issueSet: ParsedIssueDraftSet,
  createdById: Map<string, LinkedIssue>,
  ids: string[]
): string | undefined {
  const refs = issueSet.issues
    .filter((issue) => ids.includes(issue.id))
    .map((issue) => createdById.get(issue.id))
    .filter((issue): issue is LinkedIssue => issue !== undefined)
    .map((issue) => `#${issue.number}`);
  return refs.length > 0 ? refs.join(", ") : undefined;
}

function replaceLinkedIssuesSection(body: string, section: string): string {
  const trimmed = body.trim();
  const match = /^## Linked Issues\s*$/m.exec(trimmed);
  if (!match || match.index === undefined) {
    return `${trimmed}\n\n${section}`;
  }
  const before = trimmed.slice(0, match.index).trimEnd();
  const afterStart = match.index + match[0].length;
  const nextHeading = /\n##\s+/.exec(trimmed.slice(afterStart));
  const after =
    nextHeading && nextHeading.index !== undefined
      ? trimmed.slice(afterStart + nextHeading.index).trimStart()
      : "";
  return [before, section, after].filter(Boolean).join("\n\n");
}

function buildLinkedIssueBody(
  issueSet: ParsedIssueDraftSet,
  issue: ParsedIssueDraftSetIssue,
  createdById: Map<string, LinkedIssue>,
  forcePrsManaged: boolean
): string {
  const lines = ["## Linked Issues", ""];
  if (issueSet.linkingStrategy) lines.push(`- Part of: ${issueSet.linkingStrategy}`);
  const dependsOn = formatIssueNumberList(issueSet, createdById, issue.dependsOn);
  if (dependsOn) lines.push(`- Depends on: ${dependsOn}`);
  const blocks = formatIssueNumberList(issueSet, createdById, issue.blocks);
  if (blocks) lines.push(`- Blocks: ${blocks}`);
  const related = formatIssueNumberList(issueSet, createdById, issue.related);
  if (related) lines.push(`- Related: ${related}`);
  if (issueSet.sourceIssueNumber !== undefined) {
    lines.push(`- Source issue: #${issueSet.sourceIssueNumber}`);
  }
  const linked = replaceLinkedIssuesSection(issue.body, lines.join("\n"));
  return forcePrsManaged ? ensurePrsManagedIssueBody(linked) : linked;
}

export async function createIssueDraftSetWithRecords(input: {
  issueSet: ParsedIssueDraftSet;
  forge: RepositoryForge;
  labels: string[];
  forcePrsManaged: boolean;
}): Promise<ToolCreatedIssueRecord[]> {
  const created: ToolCreatedIssueRecord[] = [];
  for (const issue of input.issueSet.issues) {
    const body = input.forcePrsManaged
      ? ensurePrsManagedIssueBody(issue.body)
      : issue.body;
    created.push({
      ...(await input.forge.createOrReuseIssue(issue.title, body, input.labels)),
      id: issue.id,
    });
  }

  const createdById = new Map<string, LinkedIssue>();
  for (const issue of created) {
    if (issue.id) createdById.set(issue.id, issue as LinkedIssue);
  }
  for (const issue of input.issueSet.issues) {
    const record = created.find((candidate) => candidate.id === issue.id);
    if (!record || record.status !== "created") continue;
    const updated = await input.forge.updateIssue(
      record.number,
      issue.title,
      buildLinkedIssueBody(
        input.issueSet,
        issue,
        createdById,
        input.forcePrsManaged
      )
    );
    record.url = updated.url;
  }
  return created;
}
