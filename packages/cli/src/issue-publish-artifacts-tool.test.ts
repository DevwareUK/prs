import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishIssueArtifactsTool } from "./issue-publish-artifacts-tool";

const cleanup = new Set<string>();

afterEach(() => {
  for (const path of cleanup) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanup.clear();
});

describe("publishIssueArtifactsTool", () => {
  it("creates both managed comments when approved artifacts are not published yet", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-publish-artifacts-new-"));
    cleanup.add(repoRoot);
    const specFilePath = resolve(repoRoot, "spec.md");
    const planFilePath = resolve(repoRoot, "plan.md");
    writeFileSync(specFilePath, "# Approved specification\n", "utf8");
    writeFileSync(planFilePath, "# Approved plan\n", "utf8");

    const forge = {
      fetchIssueDetails: vi.fn(async () => ({
        title: "Publish approved artifacts",
        body: "Use marker-based comments.",
        url: "https://github.com/DevwareUK/prs/issues/324",
      })),
      fetchIssueComments: vi.fn(async () => []),
      fetchIssuePlanComment: vi.fn(async () => undefined),
      updateIssueComment: vi.fn(),
      updateIssuePlanComment: vi.fn(),
      createIssuePlanComment: vi
        .fn()
        .mockResolvedValueOnce({
          id: 20,
          body: "<!-- prs:issue-spec -->\n# Approved specification\n",
          url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-20",
          updatedAt: "2026-08-27T11:00:00Z",
        })
        .mockResolvedValueOnce({
          id: 21,
          body: "<!-- prs:issue-plan -->\n# Approved plan\n",
          url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-21",
          updatedAt: "2026-08-27T11:00:00Z",
        }),
    };

    const result = await publishIssueArtifactsTool({
      issueNumber: 324,
      repoRoot,
      specFilePath,
      planFilePath,
      forge,
    });

    expect(result.managedComments.map(({ marker, url }) => ({ marker, url }))).toEqual([
      {
        marker: "<!-- prs:issue-spec -->",
        url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-20",
      },
      {
        marker: "<!-- prs:issue-plan -->",
        url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-21",
      },
    ]);
    expect(forge.createIssuePlanComment).toHaveBeenNthCalledWith(
      1,
      324,
      "<!-- prs:issue-spec -->\n# Approved specification\n"
    );
    expect(forge.createIssuePlanComment).toHaveBeenNthCalledWith(
      2,
      324,
      "<!-- prs:issue-plan -->\n# Approved plan\n"
    );
    expect(forge.updateIssueComment).not.toHaveBeenCalled();
    expect(forge.updateIssuePlanComment).not.toHaveBeenCalled();
  });

  it("updates existing managed comments from caller-approved Markdown", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-publish-artifacts-"));
    cleanup.add(repoRoot);
    const specFilePath = resolve(repoRoot, "spec.md");
    const planFilePath = resolve(repoRoot, "plan.md");
    writeFileSync(specFilePath, "# Approved specification\n", "utf8");
    writeFileSync(planFilePath, "# Approved plan\n", "utf8");

    const forge = {
      fetchIssueDetails: vi.fn(async () => ({
        title: "Publish approved artifacts",
        body: "Use marker-based comments.",
        url: "https://github.com/DevwareUK/prs/issues/324",
      })),
      fetchIssueComments: vi.fn(async () => [
        {
          id: 20,
          body: "<!-- prs:issue-spec -->\nOld spec.",
          url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-20",
          createdAt: "2026-08-27T10:00:00Z",
          updatedAt: "2026-08-27T10:00:00Z",
          author: "JamesDevware",
          isBot: false,
        },
      ]),
      fetchIssuePlanComment: vi.fn(async () => ({
        id: 21,
        body: "<!-- prs:issue-plan -->\nOld plan.",
        url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-21",
        updatedAt: "2026-08-27T10:00:00Z",
      })),
      updateIssueComment: vi.fn(async (_id: number, body: string) => ({
        id: 20,
        body,
        url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-20",
        createdAt: "2026-08-27T10:00:00Z",
        updatedAt: "2026-08-27T11:00:00Z",
        author: "JamesDevware",
        isBot: false,
      })),
      updateIssuePlanComment: vi.fn(async (_id: number, body: string) => ({
        id: 21,
        body,
        url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-21",
        updatedAt: "2026-08-27T11:00:00Z",
      })),
      createIssuePlanComment: vi.fn(),
    };

    const result = await publishIssueArtifactsTool({
      issueNumber: 324,
      repoRoot,
      specFilePath,
      planFilePath,
      forge,
    });

    expect(result).toEqual({
      status: "ok",
      issueNumber: 324,
      managedComments: [
        {
          issueNumber: 324,
          marker: "<!-- prs:issue-spec -->",
          status: "published",
          file: specFilePath,
          id: 20,
          url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-20",
        },
        {
          issueNumber: 324,
          marker: "<!-- prs:issue-plan -->",
          status: "published",
          file: planFilePath,
          id: 21,
          url: "https://github.com/DevwareUK/prs/issues/324#issuecomment-21",
        },
      ],
    });
    expect(forge.updateIssueComment).toHaveBeenCalledWith(
      20,
      "<!-- prs:issue-spec -->\n# Approved specification\n"
    );
    expect(forge.updateIssuePlanComment).toHaveBeenCalledWith(
      21,
      "<!-- prs:issue-plan -->\n# Approved plan\n"
    );
    expect(forge.createIssuePlanComment).not.toHaveBeenCalled();
  });

  it("rejects empty artifacts before making GitHub writes", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-publish-artifacts-empty-"));
    cleanup.add(repoRoot);
    const specFilePath = resolve(repoRoot, "spec.md");
    const planFilePath = resolve(repoRoot, "plan.md");
    writeFileSync(specFilePath, "  \n", "utf8");
    writeFileSync(planFilePath, "# Approved plan\n", "utf8");
    const forge = {
      fetchIssueDetails: vi.fn(),
      fetchIssueComments: vi.fn(),
      fetchIssuePlanComment: vi.fn(),
      updateIssueComment: vi.fn(),
      updateIssuePlanComment: vi.fn(),
      createIssuePlanComment: vi.fn(),
    };

    await expect(
      publishIssueArtifactsTool({
        issueNumber: 324,
        repoRoot,
        specFilePath,
        planFilePath,
        forge,
      })
    ).rejects.toThrow("Specification artifact must contain non-empty Markdown");
    expect(forge.fetchIssueDetails).not.toHaveBeenCalled();
    expect(forge.updateIssueComment).not.toHaveBeenCalled();
  });
});
