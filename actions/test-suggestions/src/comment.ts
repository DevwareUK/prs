import {
  TEST_SUGGESTIONS_COMMENT_MARKER,
  type TestSuggestionsOutputType,
} from "@prs/contracts";

export type ChecklistTestSuggestion = {
  suggestionId: string;
  area: string;
  addressed: boolean;
  priority: "high" | "medium" | "low";
  testType: string;
  behavior: string;
  regressionRisk: string;
  value: string;
  protectedPaths: string[];
  likelyLocations: string[];
  edgeCases: string[];
  implementationNote: string;
};

export type ChecklistComment = {
  overview: string;
  suggestions: ChecklistTestSuggestion[];
};

const RESOLVED_TEST_SUGGESTIONS_START_MARKER =
  "<!-- prs:test-suggestions:resolved-start -->";
const RESOLVED_TEST_SUGGESTIONS_END_MARKER =
  "<!-- prs:test-suggestions:resolved-end -->";

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatPaths(paths: string[]): string {
  return paths.map((path) => `\`${path}\``).join(", ");
}

function collectLikelyLocations(
  suggestions: TestSuggestionsOutputType["suggestedTests"]
): string[] {
  const locations = new Set<string>();
  for (const suggestion of suggestions) {
    for (const location of suggestion.likelyLocations ?? []) {
      locations.add(location);
    }
  }

  return [...locations];
}

function parsePathList(rawValue: string): string[] {
  const inlineCodeMatches = [...rawValue.matchAll(/`([^`]+)`/g)].map((match) =>
    match[1].trim()
  );
  if (inlineCodeMatches.length > 0) {
    return [...new Set(inlineCodeMatches.filter(Boolean))];
  }

  return [
    ...new Set(
      rawValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

function normalizePriority(rawValue: string): ChecklistTestSuggestion["priority"] {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }

  throw new Error(`Invalid suggestion priority "${rawValue.trim()}".`);
}

function splitCommentSections(lines: string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentSection: string | undefined;

  for (const line of lines) {
    const sectionMatch = line.trim().match(/^### (.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      sections.set(currentSection, []);
      continue;
    }

    if (!currentSection) {
      continue;
    }

    sections.get(currentSection)?.push(line);
  }

  return sections;
}

function stripResolvedTestSuggestionsBlocks(body: string): string {
  const lines = body.split(/\r?\n/);
  const result: string[] = [];
  let insideResolvedBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === RESOLVED_TEST_SUGGESTIONS_START_MARKER) {
      insideResolvedBlock = true;
      continue;
    }

    if (trimmed === RESOLVED_TEST_SUGGESTIONS_END_MARKER) {
      insideResolvedBlock = false;
      continue;
    }

    if (!insideResolvedBlock) {
      result.push(line);
    }
  }

  return result.join("\n");
}

function parseSuggestionBlock(
  blockTitle: string,
  blockLines: string[],
  suggestionIndex: number
): ChecklistTestSuggestion {
  let addressed = false;
  let sawAddressed = false;
  let priority: ChecklistTestSuggestion["priority"] | undefined;
  let testType: string | undefined;
  let behavior: string | undefined;
  let regressionRisk: string | undefined;
  let value: string | undefined;
  let protectedPaths: string[] = [];
  let likelyLocations: string[] = [];
  const edgeCases: string[] = [];
  let implementationNote: string | undefined;
  let collectingEdgeCases = false;

  for (const rawLine of blockLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    if (collectingEdgeCases) {
      const nestedBulletMatch = rawLine.match(/^\s+- (.+)$/);
      if (nestedBulletMatch) {
        edgeCases.push(nestedBulletMatch[1].trim());
        continue;
      }

      collectingEdgeCases = false;
    }

    const line = trimmed;
    const addressedMatch = line.match(/^- \[( |x|X)\] Addressed$/);
    if (addressedMatch) {
      addressed = addressedMatch[1].toLowerCase() === "x";
      sawAddressed = true;
      continue;
    }

    const priorityMatch = line.match(/^- Priority:\s*(.+)$/i);
    if (priorityMatch) {
      priority = normalizePriority(priorityMatch[1]);
      continue;
    }

    const testTypeMatch = line.match(/^- Test type:\s*(.+)$/i);
    if (testTypeMatch) {
      testType = testTypeMatch[1].trim();
      continue;
    }

    const behaviorMatch = line.match(/^- Behavior covered:\s*(.+)$/i);
    if (behaviorMatch) {
      behavior = behaviorMatch[1].trim();
      continue;
    }

    const regressionRiskMatch = line.match(/^- Regression risk:\s*(.+)$/i);
    if (regressionRiskMatch) {
      regressionRisk = regressionRiskMatch[1].trim();
      continue;
    }

    const whyMatch = line.match(/^- Why it matters:\s*(.+)$/i);
    if (whyMatch) {
      value = whyMatch[1].trim();
      continue;
    }

    const protectedPathsMatch = line.match(/^- Protected paths:\s*(.+)$/i);
    if (protectedPathsMatch) {
      protectedPaths = parsePathList(protectedPathsMatch[1]);
      continue;
    }

    const locationsMatch = line.match(/^- Likely locations:\s*(.+)$/i);
    if (locationsMatch) {
      likelyLocations = parsePathList(locationsMatch[1]);
      continue;
    }

    if (/^- Edge cases:\s*$/i.test(line)) {
      collectingEdgeCases = true;
      continue;
    }

    const implementationNoteMatch = line.match(/^- Implementation note:\s*(.+)$/i);
    if (implementationNoteMatch) {
      implementationNote = implementationNoteMatch[1].trim();
      continue;
    }

    throw new Error(`Unexpected line in suggestion "${blockTitle}": ${line}`);
  }

  if (!sawAddressed) {
    throw new Error(`Suggestion "${blockTitle}" is missing an Addressed checkbox.`);
  }
  if (!priority) {
    throw new Error(`Suggestion "${blockTitle}" is missing a Priority field.`);
  }
  if (!testType) {
    throw new Error(`Suggestion "${blockTitle}" is missing a Test type field.`);
  }
  if (!behavior) {
    throw new Error(`Suggestion "${blockTitle}" is missing a Behavior covered field.`);
  }
  if (!regressionRisk) {
    throw new Error(`Suggestion "${blockTitle}" is missing a Regression risk field.`);
  }
  if (!value) {
    throw new Error(`Suggestion "${blockTitle}" is missing a Why it matters field.`);
  }
  if (!implementationNote) {
    throw new Error(
      `Suggestion "${blockTitle}" is missing an Implementation note field.`
    );
  }

  return {
    suggestionId: `suggestion-${suggestionIndex + 1}`,
    area: blockTitle,
    addressed,
    priority,
    testType,
    behavior,
    regressionRisk,
    value,
    protectedPaths,
    likelyLocations,
    edgeCases,
    implementationNote,
  };
}

function parseSuggestedTestsSection(sectionLines: string[]): ChecklistTestSuggestion[] {
  const suggestions: ChecklistTestSuggestion[] = [];
  let currentTitle: string | undefined;
  let currentLines: string[] = [];

  const flushCurrent = (): void => {
    if (!currentTitle) {
      return;
    }

    suggestions.push(parseSuggestionBlock(currentTitle, currentLines, suggestions.length));
    currentTitle = undefined;
    currentLines = [];
  };

  for (const rawLine of sectionLines) {
    const line = rawLine.trimEnd();
    const headingMatch = line.trim().match(/^#### (.+)$/);
    if (headingMatch) {
      flushCurrent();
      currentTitle = headingMatch[1].trim();
      continue;
    }

    if (!currentTitle) {
      if (!line.trim()) {
        continue;
      }

      throw new Error(`Unexpected content before the first suggested test area: ${line.trim()}`);
    }

    currentLines.push(rawLine);
  }

  flushCurrent();

  if (suggestions.length === 0) {
    throw new Error("The managed comment does not include any suggested test areas.");
  }

  return suggestions;
}

export function parseChecklistCommentBody(body: string): ChecklistComment {
  const lines = stripResolvedTestSuggestionsBlocks(body)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "<!-- prs:test-suggestions -->");
  if (!lines.some((line) => line.trim() === "## AI Test Suggestions")) {
    throw new Error('The managed comment is missing the "## AI Test Suggestions" heading.');
  }

  const sections = splitCommentSections(lines);
  const suggestedTestsSection = sections.get("Suggested test areas");
  if (!suggestedTestsSection) {
    throw new Error('The managed comment is missing the "### Suggested test areas" section.');
  }

  return {
    overview: (sections.get("Overview") ?? []).join("\n").trim(),
    suggestions: parseSuggestedTestsSection(suggestedTestsSection),
  };
}

export function applyAddressedSuggestionUpdates(
  body: string,
  addressedIds: string[]
): string {
  const addressedIdSet = new Set(addressedIds);
  const lines = stripResolvedTestSuggestionsBlocks(body).split(/\r?\n/);
  let suggestionIndex = -1;

  return lines
    .map((line) => {
      if (line.trim().match(/^#### (.+)$/)) {
        suggestionIndex += 1;
        return line;
      }

      const addressedMatch = line.trim().match(/^- \[( |x|X)\] Addressed$/);
      if (!addressedMatch) {
        return line;
      }

      const suggestionId = `suggestion-${suggestionIndex + 1}`;
      const alreadyChecked = addressedMatch[1].toLowerCase() === "x";
      if (alreadyChecked || addressedIdSet.has(suggestionId)) {
        return line.replace(/^- \[( |x|X)\] Addressed$/, "- [x] Addressed");
      }

      return line;
    })
    .join("\n");
}

export function buildCommentBody(suggestions: TestSuggestionsOutputType): string {
  const lines: string[] = [
    TEST_SUGGESTIONS_COMMENT_MARKER,
    "## AI Test Suggestions",
    "",
    "### Overview",
    suggestions.summary,
    "",
  ];

  if (suggestions.suggestedTests.length > 0) {
    lines.push("### Suggested test areas");
    lines.push("");

    for (const suggestion of suggestions.suggestedTests) {
      lines.push(`#### ${suggestion.area}`);
      lines.push("- [ ] Addressed");
      lines.push(`- Priority: ${toTitleCase(suggestion.priority)}`);
      lines.push(`- Test type: ${suggestion.testType}`);
      lines.push(`- Behavior covered: ${suggestion.behavior}`);
      lines.push(`- Regression risk: ${suggestion.regressionRisk}`);
      lines.push(`- Why it matters: ${suggestion.value}`);
      if (suggestion.protectedPaths?.length) {
        lines.push(`- Protected paths: ${formatPaths(suggestion.protectedPaths)}`);
      }
      if (suggestion.likelyLocations?.length) {
        lines.push(`- Likely locations: ${formatPaths(suggestion.likelyLocations)}`);
      }
      if (suggestion.edgeCases?.length) {
        lines.push("- Edge cases:");
        lines.push(...suggestion.edgeCases.map((edgeCase) => `  - ${edgeCase}`));
      }
      lines.push(`- Implementation note: ${suggestion.implementationNote}`);
      lines.push("");
    }
  }

  if (suggestions.edgeCases?.length) {
    lines.push("### Edge cases");
    lines.push(...suggestions.edgeCases.map((edgeCase) => `- ${edgeCase}`));
    lines.push("");
  }

  const likelyLocations = collectLikelyLocations(suggestions.suggestedTests);
  if (likelyLocations.length > 0) {
    lines.push("### Likely places to add tests");
    lines.push(...likelyLocations.map((location) => `- \`${location}\``));
    lines.push("");
  }

  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}
