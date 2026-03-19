import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFeatureBacklog } from "./feature-backlog";

function writeFile(repoRoot: string, relativePath: string, contents: string): void {
  const filePath = resolve(repoRoot, relativePath);
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, contents);
}

describe("analyzeFeatureBacklog", () => {
  it("identifies release automation, issue-template, example, and provider gaps", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-feature-backlog-"));

    writeFile(
      repoRoot,
      "package.json",
      JSON.stringify(
        {
          name: "fixture-repo",
          private: true,
          bin: {
            "fixture-cli": "dist/index.js",
          },
          scripts: {
            "cli:test": "node dist/index.js",
          },
        },
        null,
        2
      )
    );
    writeFile(
      repoRoot,
      "README.md",
      "# Fixture Repo\n\nCLI and workflow automation.\n"
    );
    writeFile(
      repoRoot,
      ".github/workflows/ci.yml",
      [
        "name: CI",
        "on: [push]",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: pnpm build",
      ].join("\n")
    );
    writeFile(
      repoRoot,
      "packages/providers/src/openai.ts",
      "export const provider = 'openai';\n"
    );
    writeFile(
      repoRoot,
      "packages/cli/src/index.ts",
      "export function run(): void {}\n"
    );
    writeFile(
      repoRoot,
      "packages/core/src/index.test.ts",
      'import { expect, it } from "vitest";\n' +
        'it("works", () => { expect(true).toBe(true); });\n'
    );

    const result = await analyzeFeatureBacklog({
      repoRoot,
      maxSuggestions: 10,
    });

    expect(result.repositorySignals.hasCli).toBe(true);
    expect(result.repositorySignals.hasGitHubActions).toBe(true);
    expect(result.repositorySignals.hasIssueTemplates).toBe(false);
    expect(result.repositorySignals.hasReleaseAutomation).toBe(false);
    expect(result.repositorySignals.hasExamples).toBe(false);
    expect(result.repositorySignals.providerCount).toBe(1);
    expect(result.suggestions.map((suggestion) => suggestion.id)).toEqual([
      "feedback-intake",
      "release-automation",
      "starter-templates",
      "multi-provider",
    ]);
  });

  it("ignores excluded example paths from repository signals", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-feature-backlog-exclude-"));

    writeFile(
      repoRoot,
      "package.json",
      JSON.stringify(
        {
          name: "fixture-repo",
          private: true,
          bin: {
            "fixture-cli": "dist/index.js",
          },
        },
        null,
        2
      )
    );
    writeFile(repoRoot, "README.md", "# Fixture Repo\n");
    writeFile(repoRoot, "examples/basic/README.md", "# Example\n");

    const result = await analyzeFeatureBacklog({
      excludePaths: ["examples/**"],
      repoRoot,
      maxSuggestions: 10,
    });

    expect(result.repositorySignals.hasExamples).toBe(false);
    expect(result.suggestions.map((suggestion) => suggestion.id)).toContain(
      "starter-templates"
    );
  });
});
