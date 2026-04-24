import { describe, expect, it } from "vitest";
import type { RepositoryComment } from "../../forge";
import {
  findManagedTestSuggestionsComment,
  parseManagedTestSuggestionsComment,
  parsePullRequestTestSuggestionSelection,
} from "./selection";

function createComment(
  body: string,
  options: Partial<RepositoryComment> = {}
): RepositoryComment {
  return {
    id: options.id ?? 1,
    body,
    url: options.url ?? "https://github.com/DevwareUK/prs/pull/71#issuecomment-1",
    createdAt: options.createdAt ?? "2026-03-20T11:00:00Z",
    updatedAt: options.updatedAt ?? "2026-03-20T11:00:00Z",
    author: options.author ?? "github-actions[bot]",
    isBot: options.isBot ?? true,
  };
}

function buildSuggestionBlock(options: {
  title: string;
  priority: "High" | "Medium" | "Low";
  testType?: string;
  behavior?: string;
  regressionRisk?: string;
  value: string;
  protectedPaths?: string[];
  likelyLocations?: string[];
  edgeCases?: string[];
  implementationNote?: string;
}): string[] {
  const lines = [
    `#### ${options.title}`,
    `- Priority: ${options.priority}`,
    `- Test type: ${options.testType ?? "integration"}`,
    `- Behavior covered: ${options.behavior ?? `${options.title} should stay covered.`}`,
    `- Regression risk: ${options.regressionRisk ?? `${options.title} could regress without targeted coverage.`}`,
    `- Why it matters: ${options.value}`,
  ];

  if (options.protectedPaths?.length) {
    lines.push(
      `- Protected paths: ${options.protectedPaths
        .map((path) => `\`${path}\``)
        .join(", ")}`
    );
  }

  if (options.likelyLocations?.length) {
    lines.push(
      `- Likely locations: ${options.likelyLocations
        .map((path) => `\`${path}\``)
        .join(", ")}`
    );
  }

  if (options.edgeCases?.length) {
    lines.push("- Edge cases:");
    lines.push(...options.edgeCases.map((edgeCase) => `  - ${edgeCase}`));
  }

  lines.push(
    `- Implementation note: ${
      options.implementationNote ?? `Add or extend a test that proves ${options.title.toLowerCase()}.`
    }`
  );

  return lines;
}

describe("pr-fix-tests selection helpers", () => {
  it("parses a managed AI test suggestions comment into structured suggestions", () => {
    const comment = createComment(
      [
        "<!-- prs:test-suggestions -->",
        "## AI Test Suggestions",
        "",
        "### Overview",
        "The CLI command adds a new workflow that needs direct test coverage.",
        "Keep the parser strict so malformed automation output fails clearly.",
        "",
        "### Suggested test areas",
        "",
        ...buildSuggestionBlock({
          title: "Verify command execution for 'prs pr fix-tests'",
          priority: "High",
          behavior:
            "The workflow should fetch PR context and hand the selected tests to Codex with the full task details.",
          regressionRisk:
            "The runtime handoff can drop the richer suggestion context or target the wrong files.",
          value:
            "The workflow should fetch PR context and hand the selected tests to Codex.",
          protectedPaths: [
            "packages/cli/src/workflows/pr-fix-tests/run.ts",
            "packages/cli/src/workflows/pr-fix-tests/selection.ts",
          ],
          likelyLocations: [
            "packages/cli/src/index.test.ts",
            "packages/cli/src/workflows/pr-fix-tests/run.test.ts",
            "packages/cli/src/index.test.ts",
          ],
          edgeCases: [
            "The managed comment omits a required task field.",
          ],
          implementationNote:
            "Add a command test that selects a suggestion and asserts the runtime handoff keeps the structured fields.",
        }),
        "",
        ...buildSuggestionBlock({
          title: "Test parsing of managed AI test suggestions comments",
          priority: "Medium",
          behavior:
            "Managed AI test suggestion comments should parse into task-ready suggestion objects.",
          regressionRisk:
            "Parser drift can silently discard fields needed by the fix-tests workflow.",
          value: "Parsing needs to stay stable across the managed comment format.",
          likelyLocations: [
            "packages/cli/src/workflows/pr-fix-tests/selection.test.ts",
            "packages/cli/src/index.test.ts",
            "packages/cli/src/workflows/pr-fix-tests/selection.test.ts",
          ],
          implementationNote:
            "Extend selection parser tests to cover the richer fields and strict validation behavior.",
        }),
        "",
        "### Edge cases",
        "- Missing the suggested test areas section.",
        "- Invalid priority values should fail clearly.",
        "",
        "### Likely places to add tests",
        "- `packages/cli/src/index.test.ts`",
        "- `packages/cli/src/workflows/pr-fix-tests/selection.test.ts`",
      ].join("\n")
    );

    expect(parseManagedTestSuggestionsComment(comment)).toEqual({
      sourceComment: comment,
      overview: [
        "The CLI command adds a new workflow that needs direct test coverage.",
        "Keep the parser strict so malformed automation output fails clearly.",
      ].join("\n"),
      suggestions: [
        {
          suggestionId: "suggestion-1",
          area: "Verify command execution for 'prs pr fix-tests'",
          priority: "high",
          testType: "integration",
          behavior:
            "The workflow should fetch PR context and hand the selected tests to Codex with the full task details.",
          regressionRisk:
            "The runtime handoff can drop the richer suggestion context or target the wrong files.",
          value:
            "The workflow should fetch PR context and hand the selected tests to Codex.",
          protectedPaths: [
            "packages/cli/src/workflows/pr-fix-tests/run.ts",
            "packages/cli/src/workflows/pr-fix-tests/selection.ts",
          ],
          likelyLocations: [
            "packages/cli/src/index.test.ts",
            "packages/cli/src/workflows/pr-fix-tests/run.test.ts",
          ],
          edgeCases: ["The managed comment omits a required task field."],
          implementationNote:
            "Add a command test that selects a suggestion and asserts the runtime handoff keeps the structured fields.",
        },
        {
          suggestionId: "suggestion-2",
          area: "Test parsing of managed AI test suggestions comments",
          priority: "medium",
          testType: "integration",
          behavior:
            "Managed AI test suggestion comments should parse into task-ready suggestion objects.",
          regressionRisk:
            "Parser drift can silently discard fields needed by the fix-tests workflow.",
          value: "Parsing needs to stay stable across the managed comment format.",
          protectedPaths: [],
          likelyLocations: [
            "packages/cli/src/workflows/pr-fix-tests/selection.test.ts",
            "packages/cli/src/index.test.ts",
          ],
          edgeCases: [],
          implementationNote:
            "Extend selection parser tests to cover the richer fields and strict validation behavior.",
        },
      ],
      edgeCases: [
        "Missing the suggested test areas section.",
        "Invalid priority values should fail clearly.",
      ],
      likelyLocations: [
        "packages/cli/src/index.test.ts",
        "packages/cli/src/workflows/pr-fix-tests/selection.test.ts",
      ],
    });
  });

  it("falls back to combined suggestion locations when the comment omits a likely places section", () => {
    const comment = createComment(
      [
        "<!-- prs:test-suggestions -->",
        "## AI Test Suggestions",
        "",
        "### Suggested test areas",
        "",
        ...buildSuggestionBlock({
          title: "First parser gap",
          priority: "High",
          value: "The first parser branch should be covered.",
          likelyLocations: [
            "packages/cli/src/workflows/pr-fix-tests/selection.test.ts",
            "packages/cli/src/index.test.ts",
          ],
        }),
        "",
        ...buildSuggestionBlock({
          title: "Second parser gap",
          priority: "Low",
          value: "The fallback list should stay deduplicated.",
          likelyLocations: [
            "packages/cli/src/index.test.ts",
            "packages/cli/src/workflows/pr-fix-tests/run.test.ts",
          ],
        }),
      ].join("\n")
    );

    expect(parseManagedTestSuggestionsComment(comment).likelyLocations).toEqual([
      "packages/cli/src/workflows/pr-fix-tests/selection.test.ts",
      "packages/cli/src/index.test.ts",
      "packages/cli/src/workflows/pr-fix-tests/run.test.ts",
    ]);
  });

  it("selects the newest managed comment and breaks ties by id", () => {
    const older = createComment("<!-- prs:test-suggestions -->", {
      id: 10,
      updatedAt: "2026-03-20T10:00:00Z",
    });
    const newer = createComment("<!-- prs:test-suggestions -->", {
      id: 11,
      updatedAt: "2026-03-20T11:00:00Z",
    });
    const sameTimeHigherId = createComment("<!-- prs:test-suggestions -->", {
      id: 12,
      updatedAt: "2026-03-20T11:00:00Z",
    });
    const unrelated = createComment("Human discussion only", {
      id: 13,
      updatedAt: "2026-03-20T12:00:00Z",
    });

    expect(
      findManagedTestSuggestionsComment([older, unrelated, newer, sameTimeHigherId])
    ).toBe(sameTimeHigherId);
  });

  it("parses canonical prs managed comments while still ignoring either marker line", () => {
    const comment = createComment(
      [
        "<!-- prs:test-suggestions -->",
        "## AI Test Suggestions",
        "",
        "### Suggested test areas",
        "",
        ...buildSuggestionBlock({
          title: "Verify command execution for 'prs pr fix-tests'",
          priority: "High",
          value: "The renamed workflow should keep its structured task details.",
        }),
      ].join("\n")
    );

    expect(parseManagedTestSuggestionsComment(comment).suggestions).toHaveLength(1);
    expect(parseManagedTestSuggestionsComment(comment).suggestions[0]?.area).toContain(
      "prs pr fix-tests"
    );
  });

  it("parses interactive suggestion selection and rejects invalid entries", () => {
    expect(parsePullRequestTestSuggestionSelection("all", 3)).toEqual([0, 1, 2]);
    expect(parsePullRequestTestSuggestionSelection("2, 1, 2", 3)).toEqual([1, 0]);
    expect(parsePullRequestTestSuggestionSelection("none", 3)).toEqual([]);
    expect(() => parsePullRequestTestSuggestionSelection("x", 3)).toThrow(
      "Invalid selection. Enter `all`, `none`, or a comma-separated list like `1,2`."
    );
    expect(() => parsePullRequestTestSuggestionSelection("4", 3)).toThrow(
      "Invalid selection. Choose suggestion numbers between 1 and 3."
    );
  });
});
