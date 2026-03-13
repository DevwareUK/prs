import {
  TestSuggestionsInput,
  TestSuggestionsInputType,
  TestSuggestionsOutput,
  TestSuggestionsOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import { DIFF_GROUNDED_SYSTEM_PROMPT_LINES } from "./diff-task";
import { generateStructuredOutput } from "./structured-generation";

const TEST_SUGGESTIONS_SYSTEM_PROMPT = [
  "You are a senior software engineer planning automated tests for a GitHub pull request.",
  "Suggest practical, implementation-focused tests that would add meaningful coverage.",
  ...DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
  "Prefer high-value tests and edge cases over exhaustive low-signal lists.",
  "Only suggest tests, locations, or edge cases supported by the diff or provided PR context.",
  "Do not generate inline review comments or full test code.",
].join(" ");

function buildPrompt(input: TestSuggestionsInputType): string {
  const contextLines: string[] = [];
  if (input.prTitle) {
    contextLines.push(`PR Title: ${input.prTitle}`);
  }
  if (input.prBody) {
    contextLines.push(`PR Body: ${input.prBody}`);
  }

  return [
    "Generate pull request test suggestions from the provided diff.",
    "Focus on high-value automated tests that would improve confidence in the changed behavior.",
    "Prefer practical test backlog items over exhaustive or trivial checks.",
    "Use the PR title/body only as supporting context and prefer the diff when they conflict.",
    "Only include likely test locations when the diff supports a plausible place to add or extend tests.",
    "Only include edge cases when the diff supports a concrete behavior worth testing.",
    "If the diff is small or low risk, still suggest the most valuable test coverage gap you can support from the change.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "summary": string,',
    '  "suggestedTests": [',
    "    {",
    '      "area": string,',
    '      "priority": "high" | "medium" | "low",',
    '      "value": string,',
    '      "likelyLocations"?: string[]',
    "    }",
    "  ],",
    '  "edgeCases"?: string[]',
    "}",
    "",
    'The "summary" should be a short paragraph describing the main testing opportunities created by the change.',
    '"suggestedTests" should contain 1 to 5 concrete, implementation-focused test areas grounded in the diff.',
    'Use "priority" to communicate relative value, where "high" means the test would meaningfully reduce risk.',
    '"value" should explain why the test is worth adding.',
    'Omit "edgeCases" when there are no concrete edge cases reasonably supported by the diff.',
    "Do not wrap JSON in markdown fences.",
    "",
    ...(contextLines.length > 0
      ? ["Supporting context (optional, may be incomplete):", ...contextLines, ""]
      : []),
    "Diff:",
    input.diff,
  ].join("\n");
}

function normalizeModelOutput(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const result = { ...(value as Record<string, unknown>) };
  if (result.edgeCases === null) {
    result.edgeCases = undefined;
  }

  if (Array.isArray(result.suggestedTests)) {
    result.suggestedTests = result.suggestedTests.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      const normalizedItem = { ...(item as Record<string, unknown>) };
      if (normalizedItem.likelyLocations === null) {
        normalizedItem.likelyLocations = undefined;
      }

      return normalizedItem;
    });
  }

  return result;
}

export async function generateTestSuggestions(
  provider: AIProvider,
  input: TestSuggestionsInputType
): Promise<TestSuggestionsOutputType> {
  const parsedInput = TestSuggestionsInput.parse(input);
  const prompt = buildPrompt(parsedInput);

  return generateStructuredOutput({
    provider,
    systemPrompt: TEST_SUGGESTIONS_SYSTEM_PROMPT,
    prompt,
    schema: TestSuggestionsOutput,
    validationErrorPrefix:
      "Model output failed test suggestions schema validation",
    normalizeParsedJson: normalizeModelOutput,
  });
}
