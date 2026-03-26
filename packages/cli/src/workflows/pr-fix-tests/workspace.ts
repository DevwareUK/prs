import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PullRequestDetails } from "../../forge";
import { formatRunTimestamp, toRepoRelativePath } from "../../run-artifacts";
import { formatPullRequestTestSuggestionsSnapshot } from "./snapshot";
import type {
  PullRequestFixTestsWorkspace,
  PullRequestLinkedIssueContext,
  PullRequestTestSuggestion,
  PullRequestTestSuggestionsComment,
} from "./types";

export function createPullRequestFixTestsWorkspace(
  repoRoot: string,
  prNumber: number
): PullRequestFixTestsWorkspace {
  const runDir = resolve(
    repoRoot,
    ".git-ai",
    "runs",
    `${formatRunTimestamp()}-pr-${prNumber}-fix-tests`
  );

  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    snapshotFilePath: resolve(runDir, "pr-test-suggestions.md"),
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    finalMessageFilePath: resolve(runDir, "codex-final-message.md"),
  };
}

function buildPullRequestFixTestsCodexPrompt(
  repoRoot: string,
  workspace: PullRequestFixTestsWorkspace
): string {
  const snapshotFile = toRepoRelativePath(repoRoot, workspace.snapshotFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);

  return [
    "You are working in the current repository.",
    "",
    `Read the pull request test suggestions fix snapshot at \`${snapshotFile}\` before making changes.`,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to Codex:",
    "- analyze the repository only as needed for the selected test suggestions",
    "- keep code changes focused on implementing automated tests for the selected areas",
    "- follow existing architecture and test patterns",
    "- preserve current behavior outside the selected testing scope",
    "- verify each selected test suggestion is addressed before finishing",
    "- do not run build, test, commit, push, or pull request commands; git-ai will handle execution after you exit",
    "- finish with a concise final summary and then exit cleanly",
    "- do not modify `.git-ai/` unless needed for local workflow artifacts",
    "- do not commit `.git-ai/` files",
  ].join("\n");
}

export function writePullRequestFixTestsWorkspaceFiles(
  repoRoot: string,
  pullRequest: PullRequestDetails,
  selectedSuggestions: PullRequestTestSuggestion[],
  suggestionsComment: PullRequestTestSuggestionsComment,
  workspace: PullRequestFixTestsWorkspace,
  _buildCommand: string[],
  linkedIssues: PullRequestLinkedIssueContext[]
): void {
  const createdAt = new Date().toISOString();
  const prompt = buildPullRequestFixTestsCodexPrompt(repoRoot, workspace);

  writeFileSync(
    workspace.snapshotFilePath,
    formatPullRequestTestSuggestionsSnapshot(
      pullRequest,
      selectedSuggestions,
      suggestionsComment,
      linkedIssues
    ),
    "utf8"
  );
  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        prNumber: pullRequest.number,
        prTitle: pullRequest.title,
        prUrl: pullRequest.url,
        baseRefName: pullRequest.baseRefName,
        headRefName: pullRequest.headRefName,
        sourceComment: {
          id: suggestionsComment.sourceComment.id,
          url: suggestionsComment.sourceComment.url,
          updatedAt: suggestionsComment.sourceComment.updatedAt,
        },
        snapshotFile: toRepoRelativePath(repoRoot, workspace.snapshotFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        finalMessageFile: toRepoRelativePath(repoRoot, workspace.finalMessageFilePath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        linkedIssues: linkedIssues.map((issue) => ({
          number: issue.number,
          title: issue.title,
          url: issue.url,
        })),
        selectedSuggestions: selectedSuggestions.map((suggestion) => ({
          id: suggestion.suggestionId,
          area: suggestion.area,
          priority: suggestion.priority,
          value: suggestion.value,
          likelyLocations: suggestion.likelyLocations,
        })),
        edgeCases: suggestionsComment.edgeCases,
        likelyLocations: suggestionsComment.likelyLocations,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(workspace.finalMessageFilePath, "", "utf8");
  writeFileSync(
    workspace.outputLogPath,
    [
      "# git-ai pr fix-tests run log",
      "",
      `Created: ${createdAt}`,
      `Snapshot file: ${toRepoRelativePath(repoRoot, workspace.snapshotFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      `Final message file: ${toRepoRelativePath(repoRoot, workspace.finalMessageFilePath)}`,
      "",
    ].join("\n"),
    "utf8"
  );
}
