import {
  ReviewSummaryInput,
  ReviewSummaryInputType,
  ReviewSummaryOutput,
  ReviewSummaryOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";

const REVIEW_SUMMARY_SYSTEM_PROMPT = [
  "You are a senior software engineer reviewing a GitHub pull request.",
  "Write a concise PR-level review summary for another human reviewer.",
  "Focus on correctness, architecture, maintainability, and testing concerns.",
  "Do not produce inline code review comments.",
  "Avoid style nits, formatting feedback, and trivial suggestions.",
  "Only identify risk areas when supported by the diff or provided PR context.",
  "Suggest reviewer focus areas that would help a human review this change.",
  "Suggest missing tests only when the diff reasonably supports that concern.",
  "Do not claim bugs unless they are strongly supported by the diff.",
  "Avoid hallucinating certainty or missing context.",
  "Return valid JSON only.",
].join(" ");

function buildPrompt(input: ReviewSummaryInputType): string {
  const contextLines: string[] = [];
  if (input.prTitle) {
    contextLines.push(`PR Title: ${input.prTitle}`);
  }
  if (input.prBody) {
    contextLines.push(`PR Body: ${input.prBody}`);
  }

  return [
    "Generate a concise pull request review summary from the provided diff.",
    "Act like a senior software engineer reviewing the pull request at a high level.",
    "Summarize the meaningful changes rather than narrating the diff line by line.",
    "Focus on correctness, architecture, maintainability, and testing concerns.",
    "Avoid style nits and trivial formatting comments.",
    "Use the PR title/body only as supporting context and prefer the diff when they conflict.",
    "Only include risk areas when they are supported by the diff or PR context.",
    "Only suggest missing tests when the diff reasonably supports that concern.",
    "Do not claim bugs or certainty unless the evidence is strong.",
    "If the diff does not support a claim, omit it.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "summary": string,',
    '  "riskAreas": string[],',
    '  "reviewerFocus": string[],',
    '  "missingTests"?: string[]',
    "}",
    "",
    'The "summary" should be a short paragraph describing the meaningful change.',
    '"riskAreas" should contain concise review risks or be an empty array if none are clearly supported.',
    '"reviewerFocus" should contain concise reviewer checkpoints grounded in the diff.',
    'Omit "missingTests" when there are no reasonably supported testing gaps to call out.',
    "Do not wrap JSON in markdown fences.",
    "",
    ...(contextLines.length > 0
      ? ["Supporting context (optional, may be incomplete):", ...contextLines, ""]
      : []),
    "Diff:",
    input.diff,
  ].join("\n");
}

export async function generateReviewSummary(
  provider: AIProvider,
  input: ReviewSummaryInputType
): Promise<ReviewSummaryOutputType> {
  const parsedInput = ReviewSummaryInput.parse(input);
  const prompt = buildPrompt(parsedInput);

  return generateStructuredOutput({
    provider,
    systemPrompt: REVIEW_SUMMARY_SYSTEM_PROMPT,
    prompt,
    schema: ReviewSummaryOutput,
    validationErrorPrefix:
      "Model output failed review summary schema validation",
    normalizeParsedJson: (value) => normalizeNullableFields(value, ["missingTests"]),
  });
}
