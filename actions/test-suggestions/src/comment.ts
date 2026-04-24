import type { TestSuggestionsOutputType } from "@prs/contracts";

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

export function buildCommentBody(suggestions: TestSuggestionsOutputType): string {
  const lines: string[] = [
    "## AI Test Suggestions",
    "",
    "### Overview",
    suggestions.summary,
    "",
    "### Suggested test areas",
    "",
  ];

  for (const suggestion of suggestions.suggestedTests) {
    lines.push(`#### ${suggestion.area}`);
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
