import type { RepositoryComment } from "../../forge";
import type {
  PullRequestTestSuggestion,
  PullRequestTestSuggestionPriority,
  PullRequestTestSuggestionsComment,
} from "./types";

export const TEST_SUGGESTIONS_COMMENT_MARKER = "<!-- git-ai-test-suggestions -->";

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
  let value: string | undefined;
  let likelyLocations: string[] = [];

  for (const rawLine of blockLines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const priorityMatch = line.match(/^- Priority:\s*(.+)$/i);
    if (priorityMatch) {
      priority = normalizePriority(priorityMatch[1]);
      continue;
    }

    const whyMatch = line.match(/^- Why it matters:\s*(.+)$/i);
    if (whyMatch) {
      value = whyMatch[1].trim();
      continue;
    }

    const locationsMatch = line.match(/^- Likely locations:\s*(.+)$/i);
    if (locationsMatch) {
      likelyLocations = parseLikelyLocations(locationsMatch[1]);
      continue;
    }

    throw new Error(`Unexpected line in suggestion "${blockTitle}": ${line}`);
  }

  if (!priority) {
    throw new Error(`Suggestion "${blockTitle}" is missing a Priority field.`);
  }

  if (!value) {
    throw new Error(`Suggestion "${blockTitle}" is missing a Why it matters field.`);
  }

  return {
    suggestionId: `suggestion-${suggestionIndex + 1}`,
    area: blockTitle,
    priority,
    value,
    likelyLocations,
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
    .filter((comment) => comment.body.includes(TEST_SUGGESTIONS_COMMENT_MARKER))
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
    .filter((line) => line.trim() !== TEST_SUGGESTIONS_COMMENT_MARKER);
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
      `  ${index + 1}. ${suggestion.area} (${toTitleCase(suggestion.priority)} priority)`
    );
    console.log(`      ${suggestion.value}`);
    if (suggestion.likelyLocations.length > 0) {
      console.log(`      Likely locations: ${suggestion.likelyLocations.join(", ")}`);
    }
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
