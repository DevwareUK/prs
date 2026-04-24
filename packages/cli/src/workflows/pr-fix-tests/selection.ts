import type { RepositoryComment } from "../../forge";
import {
  ALL_TEST_SUGGESTIONS_COMMENT_MARKERS,
  TEST_SUGGESTIONS_COMMENT_MARKER,
} from "@prs/contracts";
import type {
  PullRequestTestSuggestion,
  PullRequestTestSuggestionPriority,
  PullRequestTestSuggestionsComment,
} from "./types";

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseLikelyLocations(rawValue: string): string[] {
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

function normalizePriority(rawValue: string): PullRequestTestSuggestionPriority {
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

function parseSuggestionBlock(
  blockTitle: string,
  blockLines: string[],
  suggestionIndex: number
): PullRequestTestSuggestion {
  let priority: PullRequestTestSuggestionPriority | undefined;
  let testType: string | undefined;
  let behavior: string | undefined;
  let regressionRisk: string | undefined;
  let value: string | undefined;
  let protectedPaths: string[] = [];
  let likelyLocations: string[] = [];
  let edgeCases: string[] = [];
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
      protectedPaths = parseLikelyLocations(protectedPathsMatch[1]);
      continue;
    }

    const locationsMatch = line.match(/^- Likely locations:\s*(.+)$/i);
    if (locationsMatch) {
      likelyLocations = parseLikelyLocations(locationsMatch[1]);
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

function parseSuggestedTestsSection(sectionLines: string[]): PullRequestTestSuggestion[] {
  const suggestions: PullRequestTestSuggestion[] = [];
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

function parseBulletList(sectionLines: string[]): string[] {
  const items: string[] = [];

  for (const rawLine of sectionLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const bulletMatch = line.match(/^- (.+)$/);
    if (!bulletMatch) {
      throw new Error(`Unexpected line in bullet list section: ${line}`);
    }

    items.push(bulletMatch[1].trim().replace(/^`|`$/g, ""));
  }

  return items;
}

export function findManagedTestSuggestionsComment(
  comments: RepositoryComment[]
): RepositoryComment | undefined {
  return comments
    .filter((comment) =>
      ALL_TEST_SUGGESTIONS_COMMENT_MARKERS.some((marker) => comment.body.includes(marker))
    )
    .sort((left, right) => {
      const updatedAtComparison = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (updatedAtComparison !== 0) {
        return updatedAtComparison;
      }

      return right.id - left.id;
    })[0];
}

export function parseManagedTestSuggestionsComment(
  comment: RepositoryComment
): PullRequestTestSuggestionsComment {
  const bodyWithoutMarker = comment.body
    .split(/\r?\n/)
    .filter(
      (line) => !ALL_TEST_SUGGESTIONS_COMMENT_MARKERS.includes(line.trim() as never)
    );
  if (!bodyWithoutMarker.some((line) => line.trim() === "## AI Test Suggestions")) {
    throw new Error('The managed comment is missing the "## AI Test Suggestions" heading.');
  }

  const sections = splitCommentSections(bodyWithoutMarker);
  const overview = (sections.get("Overview") ?? [])
    .join("\n")
    .trim();
  const suggestedTestsSection = sections.get("Suggested test areas");

  if (!suggestedTestsSection) {
    throw new Error('The managed comment is missing the "### Suggested test areas" section.');
  }

  const suggestions = parseSuggestedTestsSection(suggestedTestsSection);
  const edgeCases = sections.has("Edge cases")
    ? parseBulletList(sections.get("Edge cases") ?? [])
    : [];
  const likelyLocations = sections.has("Likely places to add tests")
    ? parseBulletList(sections.get("Likely places to add tests") ?? [])
    : [...new Set(suggestions.flatMap((suggestion) => suggestion.likelyLocations))];

  return {
    sourceComment: comment,
    overview,
    suggestions,
    edgeCases,
    likelyLocations,
  };
}

export function printPullRequestTestSuggestions(
  suggestions: PullRequestTestSuggestion[]
): void {
  console.log("Available AI test suggestions:");

  for (const [index, suggestion] of suggestions.entries()) {
    console.log("");
    console.log(
      `  ${index + 1}. ${suggestion.area} (${toTitleCase(suggestion.priority)} priority, ${suggestion.testType})`
    );
    console.log(`      Behavior: ${suggestion.behavior}`);
    console.log(`      Regression risk: ${suggestion.regressionRisk}`);
    console.log(`      ${suggestion.value}`);
    if (suggestion.protectedPaths.length > 0) {
      console.log(`      Protected paths: ${suggestion.protectedPaths.join(", ")}`);
    }
    if (suggestion.likelyLocations.length > 0) {
      console.log(`      Likely locations: ${suggestion.likelyLocations.join(", ")}`);
    }
    if (suggestion.edgeCases.length > 0) {
      console.log(`      Edge cases: ${suggestion.edgeCases.join("; ")}`);
    }
    console.log(`      Implementation note: ${suggestion.implementationNote}`);
  }
}

export function parsePullRequestTestSuggestionSelection(
  selection: string,
  suggestionCount: number
): number[] {
  const normalized = selection.trim().toLowerCase();
  if (!normalized || normalized === "none") {
    return [];
  }

  if (normalized === "all") {
    return Array.from({ length: suggestionCount }, (_, index) => index);
  }

  const entries = normalized
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return [];
  }

  const selectedIndexes = new Set<number>();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      throw new Error(
        'Invalid selection. Enter `all`, `none`, or a comma-separated list like `1,2`.'
      );
    }

    const index = Number.parseInt(entry, 10) - 1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= suggestionCount) {
      throw new Error(
        `Invalid selection. Choose suggestion numbers between 1 and ${suggestionCount}.`
      );
    }

    selectedIndexes.add(index);
  }

  return [...selectedIndexes];
}
