import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
import { estimateIssueTool } from "./issue-estimate-tool";

describe("issue estimate tool", () => {
  it("uses default comparison profiles when repository config has no explicit profiles", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-issue-estimate-"));
    writeFileSync(resolve(repoRoot, "README.md"), "# Test repository\n", "utf8");
    const forge = {
      fetchIssuePlanComment: vi.fn().mockResolvedValue({
        id: 1,
        url: "https://github.com/DevwareUK/prs/issues/267#issuecomment-1",
        updatedAt: "2026-06-11T08:47:44Z",
        body: [
          "<!-- prs:issue-plan -->",
          "## Likely files",
          "",
          "- `README.md`",
          "",
          "## Steps",
          "",
          "1. Update docs.",
        ].join("\n"),
      }),
    };

    const result = await estimateIssueTool({
      issueNumber: 267,
      repoRoot,
      forge,
      repositoryConfig: resolveRepositoryConfig(),
    });

    expect(result.status).toBe("estimated");
    if (result.status === "estimated") {
      expect(result.profiles.map((profile) => profile.name)).toEqual([
        "premium",
        "standard",
      ]);
      expect(result.profiles.find((profile) => profile.name === "standard")?.notes).toContain(
        "Configured implementer profile."
      );
    }
  });
});
