import {
  TestSuggestionsInput,
  TestSuggestionsInputType,
  TestSuggestionsOutput,
  TestSuggestionsOutputType,
} from "@prs/contracts";
import { AIProvider } from "@prs/providers";
import { DIFF_GROUNDED_SYSTEM_PROMPT_LINES } from "./diff-task";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";

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
    "Prefer practical, implementation-ready test tasks over exhaustive or trivial checks.",
    "Use the PR title/body only as supporting context and prefer the diff when they conflict.",
    "Each suggestion should be self-contained enough to copy into an implementation task or issue.",
    "Only include likely test locations when the diff supports a plausible place to add or extend tests.",
    "Only include protected paths or changed code paths when the diff supports a concrete mapping.",
    "Attach edge cases directly to the relevant suggestion whenever possible; reserve the top-level edgeCases list for shared or cross-cutting cases.",
    "If the diff is small or low risk, still suggest the most valuable test coverage gap you can support from the change.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "summary": string,',
    '  "suggestedTests": [',
    "    {",
    '      "area": string,',
    '      "priority": "high" | "medium" | "low",',
    '      "testType": string,',
    '      "behavior": string,',
    '      "regressionRisk": string,',
    '      "value": string,',
    '      "protectedPaths"?: string[],',
    '      "likelyLocations"?: string[],',
    '      "edgeCases"?: string[],',
    '      "implementationNote": string',
    "    }",
    "  ],",
    '  "edgeCases"?: string[]',
    "}",
    "",
    'The "summary" should be a short paragraph describing the main testing opportunities created by the change.',
    '"suggestedTests" should contain 1 to 5 concrete, implementation-focused test areas grounded in the diff.',
    'Use "priority" to communicate relative value, where "high" means the test would meaningfully reduce risk.',
    '"testType" should be a short label such as unit, integration, component, end-to-end, workflow, or regression.',
    '"behavior" should describe the user flow or behavior under test.',
    '"regressionRisk" should describe the likely breakage this test would help prevent.',
    '"value" should explain why the test is worth adding.',
    '"protectedPaths" should list the changed files or code paths this test would protect when the diff makes them clear.',
    'Omit "edgeCases" when there are no concrete edge cases reasonably supported by the diff.',
    '"implementationNote" should read like a short issue-ready instruction for whoever adds the test.',
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
  const normalizedRoot = normalizeNullableFields(value, ["edgeCases"]);
  if (!normalizedRoot || typeof normalizedRoot !== "object") {
    return normalizedRoot;
  }

  const result = { ...(normalizedRoot as Record<string, unknown>) };
  if (Array.isArray(result.suggestedTests)) {
    result.suggestedTests = result.suggestedTests.map((item) =>
      normalizeNullableFields(item, ["protectedPaths", "likelyLocations", "edgeCases"])
    );
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
