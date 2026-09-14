import { describe, expect, it } from "vitest";
import { IssueDraftSet, LinkedIssueSetV2 } from "./issue-draft";

const row = (id: string, parentId?: string) => ({
  id,
  draftFile: `${id}.md`,
  specFile: `${id}-spec.md`,
  planFile: `${id}-plan.md`,
  ...(parentId ? { parentId } : {}),
  dependsOn: [],
  blocks: [],
  related: [],
});

const parentSet = () => ({
  version: 2 as const,
  mode: "multiple" as const,
  orchestration: { mode: "parent" as const, orchestratorId: "parent" },
  issues: [row("parent"), row("child", "parent")],
});

describe("linked issue set contract", () => {
  it("keeps version 1 readable for migration guidance", () => {
    expect(IssueDraftSet.parse({
      version: 1,
      mode: "multiple",
      issues: [
        { id: "contract", draftFile: "contract.md" },
        { id: "adapter", draftFile: "adapter.md", dependsOn: ["contract"] },
      ],
    }).issues).toHaveLength(2);
  });

  it("accepts a parent-orchestrated version 2 set", () => {
    expect(LinkedIssueSetV2.parse(parentSet()).issues).toHaveLength(2);
  });

  it.each([
    ["self parent", { ...parentSet(), issues: [row("parent"), row("child", "child")] }],
    ["missing orchestrator", { ...parentSet(), orchestration: { mode: "parent", orchestratorId: "missing" } }],
    ["missing child parent", { ...parentSet(), issues: [row("parent"), row("child")] }],
    ["parent has a parent", { ...parentSet(), issues: [row("parent", "child"), row("child", "parent")] }],
    ["unknown dependency", { ...parentSet(), issues: [row("parent"), { ...row("child", "parent"), dependsOn: ["missing"] }] }],
    ["self dependency", { ...parentSet(), issues: [row("parent"), { ...row("child", "parent"), dependsOn: ["child"] }] }],
    ["dependency cycle", { ...parentSet(), issues: [{ ...row("parent"), dependsOn: ["child"] }, { ...row("child", "parent"), dependsOn: ["parent"] }] }],
    ["duplicate issue numbers", { ...parentSet(), issues: [{ ...row("parent"), issueNumber: 7 }, { ...row("child", "parent"), issueNumber: 7 }] }],
  ])("rejects %s", (_name, value) => {
    expect(LinkedIssueSetV2.safeParse(value).success).toBe(false);
  });

  it("accepts an explicitly flat set with a reason", () => {
    expect(LinkedIssueSetV2.safeParse({
      version: 2,
      mode: "multiple",
      orchestration: { mode: "flat", reason: "Independent maintenance tasks" },
      issues: [row("first"), row("second")],
    }).success).toBe(true);
  });

  it("rejects parent declarations in flat mode", () => {
    expect(LinkedIssueSetV2.safeParse({
      version: 2,
      mode: "multiple",
      orchestration: { mode: "flat", reason: "Independent maintenance tasks" },
      issues: [row("first"), row("second", "first")],
    }).success).toBe(false);
  });
});
