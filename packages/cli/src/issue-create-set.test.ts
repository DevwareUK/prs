import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RepositoryForge } from "./forge";
import { createIssueDraftSetWithRecords } from "./workflows/issue/create-set";
import { publishLinkedIssueArtifacts } from "./workflows/issue/artifacts";
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

  it("publishes each issue's artifacts by stable id and preserves managed comment ids", async () => {
    const updatedComments: Array<{ id: number; body: string }> = [];
    const forge = {
      fetchIssueComments: vi.fn(async (issueNumber: number) => [{
        id: issueNumber * 10,
        body: "<!-- prs:issue-spec -->\nOld spec",
        url: `https://example.test/comments/${issueNumber * 10}`,
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        author: "owner",
        isBot: false,
      }]),
      fetchIssuePlanComment: vi.fn(async (issueNumber: number) => ({
        id: issueNumber * 10 + 1,
        body: "<!-- prs:issue-plan -->\nOld plan",
        url: `https://example.test/comments/${issueNumber * 10 + 1}`,
        updatedAt: "2026-09-01T00:00:00Z",
      })),
      updateIssueComment: vi.fn(async (id: number, body: string) => {
        updatedComments.push({ id, body });
        return { id, body, url: `https://example.test/comments/${id}`, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", author: "owner", isBot: false };
      }),
      updateIssuePlanComment: vi.fn(async (id: number, body: string) => {
        updatedComments.push({ id, body });
        return { id, body, url: `https://example.test/comments/${id}`, updatedAt: "2026-09-02T00:00:00Z" };
      }),
    } as unknown as RepositoryForge;
    const issueSet = {
      mode: "multiple" as const,
      orchestration: { mode: "parent" as const, orchestratorId: "parent" },
      issues: [
        { id: "parent", draftFilePath: "parent.md", specFilePath: "parent-spec.md", planFilePath: "parent-plan.md", title: "Parent", body: "Parent", specMarkdown: "parent-spec", planMarkdown: "parent-plan", dependsOn: [], blocks: [], related: [] },
        { id: "child", parentId: "parent", draftFilePath: "child.md", specFilePath: "child-spec.md", planFilePath: "child-plan.md", title: "Child", body: "Child", specMarkdown: "child-spec", planMarkdown: "child-plan", dependsOn: [], blocks: [], related: [] },
      ],
    };

    const result = await publishLinkedIssueArtifacts({
      forge,
      issueSet,
      issues: [
        { id: "child", number: 42, title: "Child", url: "https://example.test/issues/42", status: "created" },
        { id: "parent", number: 41, title: "Parent", url: "https://example.test/issues/41", status: "existing" },
      ],
    });

    expect(updatedComments).toEqual(expect.arrayContaining([
      { id: 410, body: "<!-- prs:issue-spec -->\nparent-spec\n" },
      { id: 411, body: "<!-- prs:issue-plan -->\nparent-plan\n" },
      { id: 420, body: "<!-- prs:issue-spec -->\nchild-spec\n" },
      { id: 421, body: "<!-- prs:issue-plan -->\nchild-plan\n" },
    ]));
    expect(result.managedComments.map((comment) => comment.id)).toEqual([410, 411, 420, 421]);
  });

  it("reuses an explicitly numbered issue and only replaces its generated links", async () => {
    const updateIssue = vi.fn(async (number: number, title: string, body: string) => ({ number, title, body, url: `https://example.test/issues/${number}`, status: "existing" as const }));
    const forge = {
      fetchIssueDetails: vi.fn(async () => ({ title: "Existing parent", body: "Keep this text\n\n## Linked Issues\n\n- Old generated link\n\n## Notes\n\nKeep notes", url: "https://example.test/issues/7" })),
      createOrReuseIssue: vi.fn(async (title: string) => ({ number: 8, title, url: "https://example.test/issues/8", status: "created" as const })),
      updateIssue,
    } as unknown as RepositoryForge;

    const result = await createIssueDraftSetWithRecords({
      forge,
      labels: [],
      forcePrsManaged: false,
      issueSet: {
        mode: "multiple",
        orchestration: { mode: "parent", orchestratorId: "parent" },
        issues: [
          { id: "parent", issueNumber: 7, draftFilePath: "parent.md", specFilePath: "parent-spec.md", planFilePath: "parent-plan.md", title: "Draft parent", body: "Draft body", specMarkdown: "spec", planMarkdown: "plan", dependsOn: [], blocks: [], related: [] },
          { id: "child", parentId: "parent", draftFilePath: "child.md", specFilePath: "child-spec.md", planFilePath: "child-plan.md", title: "Child", body: "Child body", specMarkdown: "spec", planMarkdown: "plan", dependsOn: [], blocks: [], related: [] },
        ],
      },
    });

    expect(result[0]).toMatchObject({ id: "parent", number: 7, status: "existing" });
    expect(forge.createOrReuseIssue).toHaveBeenCalledTimes(1);
    expect(updateIssue).toHaveBeenCalledWith(7, "Existing parent", expect.stringContaining("Keep this text"));
    expect(updateIssue.mock.calls[0]?.[2]).toContain("## Notes\n\nKeep notes");
    expect(updateIssue.mock.calls[0]?.[2]).not.toContain("Old generated link");
  });

  it("persists each known issue identity and reuses it after a partial failure", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "prs-linked-receipt-"));
    const receiptFilePath = resolve(repoRoot, ".prs/runs/set/issue-set-receipt.json");
    mkdirSync(resolve(repoRoot, ".prs/runs/set"), { recursive: true });
    let attempt = 0;
    const createOrReuseIssue = vi.fn(async (title: string) => {
      attempt += 1;
      if (attempt === 2) throw new Error("temporary failure");
      return { number: attempt === 1 ? 41 : 42, title, url: `https://example.test/issues/${attempt === 1 ? 41 : 42}`, status: "created" as const };
    });
    const forge = {
      createOrReuseIssue,
      fetchIssueDetails: vi.fn(async (number: number) => ({ title: "Parent", body: "Parent body", url: `https://example.test/issues/${number}` })),
      updateIssue: vi.fn(async (number: number, title: string) => ({ number, title, url: `https://example.test/issues/${number}`, status: "existing" as const })),
    } as unknown as RepositoryForge;
    const issueSet = {
      mode: "multiple" as const,
      orchestration: { mode: "parent" as const, orchestratorId: "parent" },
      issues: [
        { id: "parent", draftFilePath: "", specFilePath: "", planFilePath: "", title: "Parent", body: "Parent body", specMarkdown: "spec", planMarkdown: "plan", dependsOn: [], blocks: [], related: [] },
        { id: "child", parentId: "parent", draftFilePath: "", specFilePath: "", planFilePath: "", title: "Child", body: "Child body", specMarkdown: "spec", planMarkdown: "plan", dependsOn: [], blocks: [], related: [] },
      ],
    };

    await expect(createIssueDraftSetWithRecords({ forge, labels: [], forcePrsManaged: false, issueSet, receiptFilePath }))
      .rejects.toThrow("temporary failure");
    expect(JSON.parse(readFileSync(receiptFilePath, "utf8"))).toMatchObject({ issues: [{ id: "parent", number: 41 }] });

    const retried = await createIssueDraftSetWithRecords({ forge, labels: [], forcePrsManaged: false, issueSet, receiptFilePath });
    expect(retried.map(({ id, number }) => ({ id, number }))).toEqual([{ id: "parent", number: 41 }, { id: "child", number: 42 }]);
    expect(createOrReuseIssue).toHaveBeenCalledTimes(3);
  });

  it("returns completed comment identities when a later artifact publication fails", async () => {
    const forge = {
      fetchIssueComments: vi.fn(async () => []),
      createIssuePlanComment: vi.fn()
        .mockResolvedValueOnce({ id: 10, body: "spec", url: "https://example.test/comments/10", updatedAt: "2026-09-01T00:00:00Z" })
        .mockRejectedValueOnce(new Error("permission denied")),
      fetchIssuePlanComment: vi.fn(async () => undefined),
    } as unknown as RepositoryForge;
    const issueSet = {
      mode: "multiple" as const,
      orchestration: { mode: "flat" as const, reason: "Independent" },
      issues: [
        { id: "one", draftFilePath: "one.md", specFilePath: "one-spec.md", planFilePath: "one-plan.md", title: "One", body: "One", specMarkdown: "one-spec", planMarkdown: "one-plan", dependsOn: [], blocks: [], related: [] },
      ],
    };

    const result = await publishLinkedIssueArtifacts({
      forge,
      issueSet,
      issues: [{ id: "one", number: 7, title: "One", url: "https://example.test/issues/7", status: "created" }],
    });

    expect(result.managedComments).toHaveLength(1);
    expect(result.managedCommentFailures).toEqual([expect.objectContaining({
      issueNumber: 7,
      status: "incomplete",
      file: "one-plan.md",
      message: "permission denied",
    })]);
  });
});
