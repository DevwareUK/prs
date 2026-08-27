import { describe, expect, it, vi } from "vitest";
import type { RepositoryForge } from "./forge";
import { createIssueDraftSetWithRecords } from "./workflows/issue/create-set";

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
});
