import type { IssueIdentity, RepositoryForge } from "../../forge";
import type { ParsedIssueDraftSet } from "./draft-set";
import type { ToolCreatedIssueRecord } from "./create-set";

export type IssueHierarchyRelationship = {
  parentId: number;
  parentNumber: number;
  parentUrl: string;
  childId: number;
  childNumber: number;
  childUrl: string;
  status: "verified" | "conflict" | "incomplete";
  message?: string;
  nextAction?: string;
};

export type IssueHierarchyResult =
  | { mode: "flat"; reason: string; relationships: [] }
  | { mode: "parent"; orchestratorId: string; relationships: IssueHierarchyRelationship[] };

function relationship(
  parent: IssueIdentity,
  child: IssueIdentity,
  status: IssueHierarchyRelationship["status"],
  detail: Pick<IssueHierarchyRelationship, "message" | "nextAction"> = {}
): IssueHierarchyRelationship {
  return {
    parentId: parent.id,
    parentNumber: parent.number,
    parentUrl: parent.url,
    childId: child.id,
    childNumber: child.number,
    childUrl: child.url,
    status,
    ...detail,
  };
}

async function verifyBothDirections(
  forge: RepositoryForge,
  parent: IssueIdentity,
  child: IssueIdentity
): Promise<boolean> {
  const [actualParent, children] = await Promise.all([
    forge.fetchIssueParent(child.number),
    forge.fetchIssueChildren(parent.number),
  ]);
  return actualParent?.id === parent.id && children.some((candidate) => candidate.id === child.id);
}

export async function ensureIssueHierarchy(input: {
  forge: RepositoryForge;
  issueSet: ParsedIssueDraftSet;
  issues: ToolCreatedIssueRecord[];
}): Promise<IssueHierarchyResult> {
  if (input.issueSet.orchestration.mode === "flat") {
    return {
      mode: "flat",
      reason: input.issueSet.orchestration.reason,
      relationships: [],
    };
  }

  const recordsById = new Map(
    input.issues
      .filter((issue): issue is ToolCreatedIssueRecord & { id: string } => Boolean(issue.id))
      .map((issue) => [issue.id, issue])
  );
  const parentRecord = recordsById.get(input.issueSet.orchestration.orchestratorId);
  if (!parentRecord) {
    throw new Error(`Issue record for orchestrator "${input.issueSet.orchestration.orchestratorId}" is missing.`);
  }
  const parent = await input.forge.fetchIssueIdentity(parentRecord.number);
  const relationships: IssueHierarchyRelationship[] = [];

  for (const entry of input.issueSet.issues.filter((issue) => issue.parentId)) {
    const childRecord = recordsById.get(entry.id);
    if (!childRecord) {
      throw new Error(`Issue record for child "${entry.id}" is missing.`);
    }
    const child = await input.forge.fetchIssueIdentity(childRecord.number);
    try {
      const currentParent = await input.forge.fetchIssueParent(child.number);
      if (currentParent && currentParent.id !== parent.id) {
        relationships.push(relationship(parent, child, "conflict", {
          message: `Child #${child.number} already belongs to unrelated parent #${currentParent.number}; it was not reparented.`,
          nextAction: "Review the existing parent and obtain separate approval before reparenting.",
        }));
        continue;
      }

      if (!currentParent) {
        try {
          await input.forge.addIssueChild(parent.number, child.id);
        } catch {
          // The response may have been lost after GitHub applied the relationship.
        }
      }

      if (await verifyBothDirections(input.forge, parent, child)) {
        relationships.push(relationship(parent, child, "verified"));
      } else {
        relationships.push(relationship(parent, child, "incomplete", {
          message: `Native hierarchy between parent #${parent.number} and child #${child.number} could not be verified in both directions.`,
          nextAction: "Retry the same approved issue-set creation command; PRS will reconcile the known issue identities.",
        }));
      }
    } catch (error) {
      relationships.push(relationship(parent, child, "incomplete", {
        message: error instanceof Error ? error.message : String(error),
        nextAction: "Check GitHub issue permissions and retry the same approved issue-set creation command.",
      }));
    }
  }

  return {
    mode: "parent",
    orchestratorId: input.issueSet.orchestration.orchestratorId,
    relationships,
  };
}
