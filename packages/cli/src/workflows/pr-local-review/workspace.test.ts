import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPullRequestLocalReviewWorkspace,
  writePullRequestLocalReviewWorkspaceFiles,
} from "./workspace";
import type { PullRequestLocalReviewContextInput } from "./types";

const cleanupTargets = new Set<string>();

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

describe("pull request local review workspace", () => {
  it("writes a focused report prompt and review context", () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-pr-local-review-workspace-"));
    cleanupTargets.add(repoRoot);
    const workspace = createPullRequestLocalReviewWorkspace(repoRoot, 224);
    const input: PullRequestLocalReviewContextInput = {
      flow: "pr-review",
      pullRequest: {
        number: 224,
        title: "Improve dashboard filters",
        body: "Adds local filter controls.",
        url: "https://github.com/DevwareUK/prs/pull/224",
        baseRefName: "main",
        headRefName: "feature/dashboard-filters",
      },
      linkedIssues: [],
      checkoutTarget: {
        source: "fetched-review",
        branchName: "review/pr-224-improve-dashboard-filters",
        headRefName: "feature/dashboard-filters",
      },
      baseSync: {
        baseRefName: "main",
        remoteRef: "origin/main",
        baseTip: "abc123base",
        status: "up-to-date",
        conflictResolution: "not-needed",
        summary: "Already up to date.",
        warnings: [],
      },
      buildCommandDisplay: "pnpm test",
      checks: { status: "available", items: [] },
      issueComments: { status: "available", items: [] },
      reviewComments: { status: "available", items: [] },
      changedFiles: ["src/filter.ts"],
      diff: "diff --git a/src/filter.ts b/src/filter.ts\n+applyFilter();\n",
      warnings: [],
      reportFilePath: workspace.reportFilePath,
    };

    writePullRequestLocalReviewWorkspaceFiles(repoRoot, workspace, input, ["pnpm", "test"]);

    expect(readFileSync(workspace.promptFilePath, "utf8")).toContain(
      "Write the final Markdown report to `.prs/runs/"
    );
    expect(readFileSync(workspace.promptFilePath, "utf8")).toContain(
      "Blocking concerns"
    );
    expect(readFileSync(workspace.promptFilePath, "utf8")).toContain(
      "do not commit, push, or resolve comments"
    );
    expect(readFileSync(workspace.promptFilePath, "utf8")).toContain(
      "do not post directly to GitHub except through the audit publish command below"
    );
    expect(readFileSync(workspace.promptFilePath, "utf8")).toContain(
      `After saving the report, publish it with \`prs audit publish --pr 224 --file ${workspace.reportFilePath} --section "Codex PR review"\`.`
    );
    expect(readFileSync(workspace.contextFilePath, "utf8")).toContain(
      "## Changed Files\n\n- src/filter.ts"
    );
    expect(readFileSync(workspace.contextFilePath, "utf8")).toContain(
      "```diff\ndiff --git a/src/filter.ts b/src/filter.ts"
    );
  });
});
