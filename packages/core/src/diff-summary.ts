import {
  DiffSummaryInput,
  DiffSummaryInputType,
  DiffSummaryOutput,
  DiffSummaryOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";

const DIFF_SUMMARY_SYSTEM_PROMPT =
  [
    "You are a senior software engineer reviewing a git diff.",
    "Summarize the intent of the changes for another developer.",
    "Focus on meaningful architectural, behavioral, and functional changes.",
    "Do not narrate the diff line by line.",
    "Group related changes together.",
    "Identify major areas affected.",
    "Mention risk areas only when the diff supports them.",
    "Do not hallucinate missing context or speculate beyond the diff.",
    "Return valid JSON only.",
  ].join(" ");

function buildPrompt(input: DiffSummaryInputType): string {
  return [
    "Summarize the provided git diff as a structured developer-friendly overview.",
    "Explain the intent of the change at a high level.",
    "Focus on meaningful functional or architectural changes instead of line-by-line narration.",
    "Group related changes together into a concise set of major areas.",
    "Only include risk areas when they are directly supported by the diff.",
    "If the diff does not support a claim, omit it.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "summary": string,',
    '  "majorAreas": string[],',
    '  "riskAreas"?: string[]',
    "}",
    "",
    'The "summary" should be a short paragraph.',
    'The "majorAreas" array should contain concise grouped themes of the change.',
    'Omit "riskAreas" entirely when there are no clear risks supported by the diff.',
    "Do not wrap JSON in markdown fences.",
    "",
    "Diff:",
    input.diff,
  ].join("\n");
}

export async function generateDiffSummary(
  provider: AIProvider,
  input: DiffSummaryInputType
): Promise<DiffSummaryOutputType> {
  const parsedInput = DiffSummaryInput.parse(input);
  const prompt = buildPrompt(parsedInput);

  return generateStructuredOutput({
    provider,
    systemPrompt: DIFF_SUMMARY_SYSTEM_PROMPT,
    prompt,
    schema: DiffSummaryOutput,
    validationErrorPrefix: "Model output failed diff summary schema validation",
    normalizeParsedJson: (value) => normalizeNullableFields(value, ["riskAreas"]),
  });
}
