import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RepositoryForge } from "./forge";
import { createIssueDraftSetWithRecords } from "./workflows/issue/create-set";
import { formatIssueDraftSetPreview, loadIssueDraftSet } from "./workflows/issue/draft-set";

describe("deterministic linked issue creation", () => {
  it("creates every draft before adding number-based links", async () => {
    let number = 40;
    const createOrReuseIssue = vi.fn(async (title: string) => ({
      number: ++number,
      title,
      url: `https://example.test/issues/${number}`,
      status: "created" as const,
    }));
    const updateIssue = vi.fn(async (issueNumber: number, title: string) => ({
      number: issueNumber,
      title,
      url: `https://example.test/issues/${issueNumber}`,
      status: "created" as const,
    }));
    const forge = { createOrReuseIssue, updateIssue } as unknown as RepositoryForge;

    const result = await createIssueDraftSetWithRecords({
      forge,
      labels: ["prs"],
      forcePrsManaged: true,
      issueSet: {
        mode: "multiple",
        linkingStrategy: "One orchestrated migration",
        issues: [
          {
            id: "contract", draftFilePath: "contract.md", title: "Contract", body: "Contract body",
            dependsOn: [], blocks: ["adapter"], related: [],
          },
          {
            id: "adapter", draftFilePath: "adapter.md", title: "Adapter", body: "Adapter body",
            dependsOn: ["contract"], blocks: [], related: [],
          },
        ],
      },
    });

    expect(result.map((issue) => issue.id)).toEqual(["contract", "adapter"]);
    expect(createOrReuseIssue).toHaveBeenCalledTimes(2);
    expect(updateIssue).toHaveBeenCalledWith(
      41,
      "Contract",
      expect.stringContaining("- Blocks: #42")
    );
    expect(updateIssue).toHaveBeenCalledWith(
      42,
      "Adapter",
      expect.stringContaining("- Depends on: #41")
    );
    expect(updateIssue.mock.calls[0]?.[2]).toMatch(/^<!-- prs:managed-issue -->/);
  });

  it("preflights every issue-specific draft, specification, and plan", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-linked-set-"));
    const runDir = resolve(repoRoot, ".prs/runs/set");
    mkdirSync(runDir, { recursive: true });
    for (const id of ["parent", "child"]) {
      writeFileSync(resolve(runDir, `${id}.md`), `# ${id}\n\n${id} body\n`);
      writeFileSync(resolve(runDir, `${id}-spec.md`), `# ${id} spec\n`);
      writeFileSync(resolve(runDir, `${id}-plan.md`), `# ${id} plan\n`);
    }
    const manifestPath = resolve(runDir, "set.json");
    writeFileSync(manifestPath, JSON.stringify({
      version: 2,
      mode: "multiple",
      orchestration: { mode: "parent", orchestratorId: "parent" },
      issues: [
        { id: "parent", draftFile: ".prs/runs/set/parent.md", specFile: ".prs/runs/set/parent-spec.md", planFile: ".prs/runs/set/parent-plan.md" },
        { id: "child", parentId: "parent", draftFile: ".prs/runs/set/child.md", specFile: ".prs/runs/set/child-spec.md", planFile: ".prs/runs/set/child-plan.md" },
      ],
    }));

    const parsed = loadIssueDraftSet({ repoRoot, runDir, issueSetFilePath: manifestPath });

    expect(parsed.issues.map(({ id, specMarkdown, planMarkdown }) => ({ id, specMarkdown, planMarkdown }))).toEqual([
      { id: "parent", specMarkdown: "# parent spec", planMarkdown: "# parent plan" },
      { id: "child", specMarkdown: "# child spec", planMarkdown: "# child plan" },
    ]);
    expect(formatIssueDraftSetPreview(repoRoot, parsed)).toContain("Spec: .prs/runs/set/child-spec.md");
    expect(formatIssueDraftSetPreview(repoRoot, parsed)).toContain("Parent: parent");
  });

  it("rejects a legacy linked manifest with upgrade guidance", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-linked-set-v1-"));
    const runDir = resolve(repoRoot, ".prs/runs/set");
    mkdirSync(runDir, { recursive: true });
    const manifestPath = resolve(runDir, "set.json");
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      mode: "multiple",
      issues: [{ id: "one", draftFile: "one.md" }, { id: "two", draftFile: "two.md" }],
    }));

    expect(() => loadIssueDraftSet({ repoRoot, runDir, issueSetFilePath: manifestPath }))
      .toThrow(/version 2.*specFile.*planFile/i);
  });

  it("rejects empty artifacts and symlink escapes before publication", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-linked-set-escape-"));
    const runDir = resolve(repoRoot, ".prs/runs/set");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, "parent.md"), "# Parent\n\nBody\n");
    writeFileSync(resolve(runDir, "parent-plan.md"), "# Plan\n");
    const outsideSpec = resolve(repoRoot, "outside-spec.md");
    writeFileSync(outsideSpec, "# Escaped spec\n");
    symlinkSync(outsideSpec, resolve(runDir, "parent-spec.md"));
    const manifestPath = resolve(runDir, "set.json");
    writeFileSync(manifestPath, JSON.stringify({
      version: 2,
      mode: "multiple",
      orchestration: { mode: "flat", reason: "Independent" },
      issues: [
        { id: "parent", draftFile: ".prs/runs/set/parent.md", specFile: ".prs/runs/set/parent-spec.md", planFile: ".prs/runs/set/parent-plan.md" },
        { id: "second", draftFile: ".prs/runs/set/missing.md", specFile: ".prs/runs/set/missing-spec.md", planFile: ".prs/runs/set/missing-plan.md" },
      ],
    }));

    expect(() => loadIssueDraftSet({ repoRoot, runDir, issueSetFilePath: manifestPath }))
      .toThrow(/specification.*stay inside/i);
  });
});
