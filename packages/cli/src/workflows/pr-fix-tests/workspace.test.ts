import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PullRequestDetails } from "../../forge";
import {
  createPullRequestFixTestsWorkspace,
  writePullRequestFixTestsWorkspaceFiles,
} from "./workspace";
import type {
  PullRequestLinkedIssueContext,
  PullRequestTestSuggestion,
  PullRequestTestSuggestionsComment,
} from "./types";

const cleanupTargets = new Set<string>();

function createTempRepoRoot(): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-pr-fix-tests-"));
  cleanupTargets.add(repoRoot);
  return repoRoot;
}

afterEach(() => {
  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

describe("pr-fix-tests workspace", () => {
  it("creates the run directory and writes prompt, snapshot, metadata, and log artifacts", () => {
    const repoRoot = createTempRepoRoot();
    const workspace = createPullRequestFixTestsWorkspace(repoRoot, 71);

    const pullRequest: PullRequestDetails = {
      number: 71,
      title: "Add git-ai pr fix-tests",
      body: "Closes #70\n\nImplement AI test suggestion handoff.",
      url: "https://github.com/DevwareUK/git-ai/pull/71",
      baseRefName: "main",
      headRefName: "feat/pr-fix-tests",
    };
    const selectedSuggestions: PullRequestTestSuggestion[] = [
      {
        suggestionId: "suggestion-2",
        area: "Test parsing of managed AI test suggestions comments",
        priority: "high",
        value: "Parsing failures should be explicit and auditable.",
        likelyLocations: ["packages/cli/src/workflows/pr-fix-tests/selection.test.ts"],
      },
    ];
    const suggestionsComment: PullRequestTestSuggestionsComment = {
      sourceComment: {
        id: 4097382615,
        body: "<!-- git-ai-test-suggestions -->",
        url: "https://github.com/DevwareUK/git-ai/pull/71#issuecomment-4097382615",
        createdAt: "2026-03-20T11:20:00Z",
        updatedAt: "2026-03-20T11:29:35Z",
        author: "github-actions[bot]",
        isBot: true,
      },
      overview: "The new CLI workflow needs direct test coverage for parsing and orchestration.",
      suggestions: selectedSuggestions,
      edgeCases: ["Missing the managed comment should fail clearly."],
      likelyLocations: [
        "packages/cli/src/workflows/pr-fix-tests/selection.test.ts",
        "packages/cli/src/workflows/pr-fix-tests/run.test.ts",
      ],
    };
    const linkedIssues: PullRequestLinkedIssueContext[] = [
      {
        number: 70,
        title: "Add git-ai pr fix-tests",
        body: "Support implementing managed AI test suggestions from pull requests.",
        url: "https://github.com/DevwareUK/git-ai/issues/70",
      },
    ];

    writePullRequestFixTestsWorkspaceFiles(
      repoRoot,
      pullRequest,
      selectedSuggestions,
      suggestionsComment,
      workspace,
      ["pnpm", "build"],
      linkedIssues
    );

    expect(existsSync(workspace.runDir)).toBe(true);
    expect(workspace.runDir).toMatch(/\.git-ai\/runs\/.+-pr-71-fix-tests$/);

    const snapshot = readFileSync(workspace.snapshotFilePath, "utf8");
    const prompt = readFileSync(workspace.promptFilePath, "utf8");
    const metadata = JSON.parse(readFileSync(workspace.metadataFilePath, "utf8")) as {
      prNumber: number;
      linkedIssues: Array<{ number: number; title: string; url: string }>;
      selectedSuggestions: Array<{ id: string; area: string; priority: string }>;
      edgeCases: string[];
      likelyLocations: string[];
      snapshotFile: string;
      promptFile: string;
      outputLog: string;
      finalMessageFile: string;
      runDir: string;
    };
    const outputLog = readFileSync(workspace.outputLogPath, "utf8");

    expect(snapshot).toContain("# Pull Request Test Suggestions Fix Snapshot");
    expect(snapshot).toContain("### Issue #70: Add git-ai pr fix-tests");
    expect(snapshot).toContain(
      "### Suggestion 1: Test parsing of managed AI test suggestions comments"
    );
    expect(snapshot).toContain("## Suggested edge cases");

    expect(prompt).toContain(
      "Read the pull request test suggestions fix snapshot at `.git-ai/runs/"
    );
    expect(prompt).toContain("Use `.git-ai/runs/");
    expect(prompt).toContain("- keep code changes focused on implementing automated tests");
    expect(prompt).toContain(
      "- do not run build, test, commit, push, or pull request commands; git-ai will handle execution after you exit"
    );
    expect(prompt).toContain("- finish with a concise final summary and then exit cleanly");

    expect(metadata.prNumber).toBe(71);
    expect(metadata.linkedIssues).toEqual([
      {
        number: 70,
        title: "Add git-ai pr fix-tests",
        url: "https://github.com/DevwareUK/git-ai/issues/70",
      },
    ]);
    expect(metadata.selectedSuggestions).toEqual([
      {
        id: "suggestion-2",
        area: "Test parsing of managed AI test suggestions comments",
        priority: "high",
        value: "Parsing failures should be explicit and auditable.",
        likelyLocations: ["packages/cli/src/workflows/pr-fix-tests/selection.test.ts"],
      },
    ]);
    expect(metadata.edgeCases).toEqual([
      "Missing the managed comment should fail clearly.",
    ]);
    expect(metadata.likelyLocations).toEqual([
      "packages/cli/src/workflows/pr-fix-tests/selection.test.ts",
      "packages/cli/src/workflows/pr-fix-tests/run.test.ts",
    ]);
    expect(metadata.snapshotFile).toMatch(/\.git-ai\/runs\/.+\/pr-test-suggestions\.md$/);
    expect(metadata.promptFile).toMatch(/\.git-ai\/runs\/.+\/prompt\.md$/);
    expect(metadata.outputLog).toMatch(/\.git-ai\/runs\/.+\/output\.log$/);
    expect(metadata.finalMessageFile).toMatch(
      /\.git-ai\/runs\/.+\/codex-final-message\.md$/
    );
    expect(metadata.runDir).toMatch(/\.git-ai\/runs\/.+-pr-71-fix-tests$/);
    expect(readFileSync(workspace.finalMessageFilePath, "utf8")).toBe("");

    expect(outputLog).toContain("# git-ai pr fix-tests run log");
    expect(outputLog).toContain("Snapshot file: .git-ai/runs/");
    expect(outputLog).toContain("Prompt file: .git-ai/runs/");
    expect(outputLog).toContain("Final message file: .git-ai/runs/");
  });

  it("instructs Codex to exit cleanly and leave execution to git-ai", () => {
    const repoRoot = createTempRepoRoot();
    const workspace = createPullRequestFixTestsWorkspace(repoRoot, 88);

    writePullRequestFixTestsWorkspaceFiles(
      repoRoot,
      {
        number: 88,
        title: "Test prompt build command formatting",
        body: "",
        url: "https://github.com/DevwareUK/git-ai/pull/88",
        baseRefName: "main",
        headRefName: "feat/prompt-build-command-formatting",
      },
      [
        {
          suggestionId: "suggestion-1",
          area: "Verify prompt build command formatting",
          priority: "medium",
          value: "Prompt instructions should reflect the configured verification command.",
          likelyLocations: [],
        },
      ],
      {
        sourceComment: {
          id: 901,
          body: "<!-- git-ai-test-suggestions -->",
          url: "https://github.com/DevwareUK/git-ai/pull/88#issuecomment-901",
          createdAt: "2026-03-20T12:00:00Z",
          updatedAt: "2026-03-20T12:00:00Z",
          author: "github-actions[bot]",
          isBot: true,
        },
        overview: "",
        suggestions: [],
        edgeCases: [],
        likelyLocations: [],
      },
      workspace,
      ["pnpm", "exec", "vitest", "--project", "cli smoke"],
      []
    );

    expect(readFileSync(workspace.promptFilePath, "utf8")).toContain(
      "do not run build, test, commit, push, or pull request commands"
    );
    expect(readFileSync(workspace.promptFilePath, "utf8")).toContain(
      "finish with a concise final summary and then exit cleanly"
    );
  });
});
