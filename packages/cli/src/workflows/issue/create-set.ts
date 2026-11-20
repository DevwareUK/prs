import type { CreatedIssueRecord, IssueIdentity, IssueTracker } from "../../issue-tracker";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensurePrsManagedIssueBody } from "./artifacts";
import type { ParsedIssueDraftSet, ParsedIssueDraftSetIssue } from "./draft-set";

type LinkedIssue = { id: string; number: number; url: string };
export type ToolCreatedIssueRecord = CreatedIssueRecord & { id?: string; replacementOf?: IssueIdentity };

function formatIssueNumberList(
  issueSet: ParsedIssueDraftSet,
  createdById: Map<string, LinkedIssue>,
  ids: string[],
  nativeUrls = false
): string | undefined {
  const refs = issueSet.issues
    .filter((issue) => ids.includes(issue.id))
    .map((issue) => createdById.get(issue.id))
    .filter((issue): issue is LinkedIssue => issue !== undefined)
    .map((issue) => nativeUrls ? issue.url : `#${issue.number}`);
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
  forcePrsManaged: boolean,
  nativeUrls = false,
  sourceUrl?: string
): string {
  const lines = ["## Linked Issues", ""];
  if (issueSet.linkingStrategy) lines.push(`- Part of: ${issueSet.linkingStrategy}`);
  const dependsOn = formatIssueNumberList(issueSet, createdById, issue.dependsOn, nativeUrls);
  if (dependsOn) lines.push(`- Depends on: ${dependsOn}`);
  const blocks = formatIssueNumberList(issueSet, createdById, issue.blocks, nativeUrls);
  if (blocks) lines.push(`- Blocks: ${blocks}`);
  const related = formatIssueNumberList(issueSet, createdById, issue.related, nativeUrls);
  if (related) lines.push(`- Related: ${related}`);
  if (issueSet.sourceIssueNumber !== undefined) {
    lines.push(`- Source issue: ${nativeUrls ? sourceUrl : `#${issueSet.sourceIssueNumber}`}`);
  }
  const linked = replaceLinkedIssuesSection(issue.body, lines.join("\n"));
  return forcePrsManaged ? ensurePrsManagedIssueBody(linked) : linked;
}

export async function createIssueDraftSetWithRecords(input: {
  issueSet: ParsedIssueDraftSet;
  tracker: IssueTracker;
  labels: string[];
  forcePrsManaged: boolean;
  receiptFilePath?: string;
  deferLinks?: boolean;
}): Promise<ToolCreatedIssueRecord[]> {
  const created: ToolCreatedIssueRecord[] = [];
  const baseBodyById = new Map<string, string>();
  const receiptIssues = input.receiptFilePath && existsSync(input.receiptFilePath)
    ? ((JSON.parse(readFileSync(input.receiptFilePath, "utf8")) as { issues?: ToolCreatedIssueRecord[] }).issues ?? [])
    : [];
  const receiptById = new Map(
    receiptIssues
      .filter((issue): issue is ToolCreatedIssueRecord & { id: string } => Boolean(issue.id))
      .map((issue) => [issue.id, issue])
  );
  await input.tracker.preflightIssueSet?.({issues: input.issueSet.issues.map(issue => {
    const record = receiptById.get(issue.id);
    return record?.replacementOf && record.replacementOf.number === issue.issueNumber ? {...issue, issueNumber: record.number} : issue;
  }), labels: input.labels});
  const persistReceipt = (): void => {
    if (!input.receiptFilePath) return;
    writeFileSync(input.receiptFilePath, `${JSON.stringify({ version: 1, issues: created }, null, 2)}\n`, "utf8");
  };
  const ordered = input.tracker.type === "monday" && input.issueSet.orchestration.mode === "parent"
    ? [...input.issueSet.issues].sort((a,b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId))) : input.issueSet.issues;
  for (const issue of ordered) {
    const receipt = receiptById.get(issue.id);
    const knownIssueNumber = receipt?.replacementOf && receipt.replacementOf.number === issue.issueNumber ? receipt.number : issue.issueNumber ?? receipt?.number;
    if (knownIssueNumber !== undefined) {
      const existing = await input.tracker.fetchIssueDetails(knownIssueNumber);
      baseBodyById.set(issue.id, existing.body);
      created.push({
        ...(receipt?.replacementOf ? {replacementOf: receipt.replacementOf} : {}),
        id: issue.id,
        number: knownIssueNumber,
        title: existing.title,
        url: existing.url,
        status: "existing",
      });
      persistReceipt();
      continue;
    }
    const body = input.forcePrsManaged
      ? ensurePrsManagedIssueBody(issue.body)
      : issue.body;
    const parent = issue.parentId ? created.find(record => record.id === issue.parentId) : undefined;
    const record = input.tracker.type === "monday" && parent
      ? await input.tracker.createOrReuseIssue(issue.title, body, input.labels, {parentNumber: parent.number})
      : await input.tracker.createOrReuseIssue(issue.title, body, input.labels);
    if (record.status === "existing") {
      const existing = await input.tracker.fetchIssueDetails(record.number);
      baseBodyById.set(issue.id, existing.body);
      record.title = existing.title;
      record.url = existing.url;
    } else {
      baseBodyById.set(issue.id, issue.body);
    }
    created.push({
      ...record,
      id: issue.id,
    });
    persistReceipt();
  }

  if (!input.deferLinks) await updateIssueSetLinks({...input, issues: created, baseBodyById});
  return created;
}

export async function updateIssueSetLinks(input: {
  issueSet: ParsedIssueDraftSet; tracker: IssueTracker; issues: ToolCreatedIssueRecord[];
  forcePrsManaged: boolean; baseBodyById?: Map<string,string>;
}): Promise<void> {
  const created = input.issues;
  const baseBodyById = input.baseBodyById ?? new Map<string,string>();
  if (!input.baseBodyById) for (const record of created) if (record.id) baseBodyById.set(record.id,(await input.tracker.fetchIssueDetails(record.number)).body);
  const sourceUrl = input.tracker.type === "monday" && input.issueSet.sourceIssueNumber !== undefined ? (await input.tracker.fetchIssueDetails(input.issueSet.sourceIssueNumber)).url : undefined;
  const createdById = new Map<string, LinkedIssue>();
  for (const issue of created) {
    if (issue.id) createdById.set(issue.id, issue as LinkedIssue);
  }
  for (const issue of input.issueSet.issues) {
    const record = created.find((candidate) => candidate.id === issue.id);
    if (!record) continue;
    const updated = await input.tracker.updateIssue(
      record.number,
      record.title,
      buildLinkedIssueBody(
        input.issueSet,
        { ...issue, body: baseBodyById.get(issue.id) ?? issue.body },
        createdById,
        input.forcePrsManaged,
        input.tracker.type === "monday",
        sourceUrl
      )
    );
    record.url = updated.url;
  }

}
