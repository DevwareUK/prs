import {
  DiffSummaryInput,
  DiffSummaryInputType,
  DiffSummaryOutput,
  DiffSummaryOutputType,
} from "@prs/contracts";
import { AIProvider } from "@prs/providers";
import {
  buildDiffTaskPrompt,
  DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
} from "./diff-task";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";

const DIFF_SUMMARY_SYSTEM_PROMPT =
  [
    "You are a senior software engineer reviewing a git diff.",
    "Summarize the intent of the changes for another developer.",
    "Identify major areas affected.",
    "Mention risk areas only when the diff supports them.",
    ...DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
  ].join(" ");

function buildPrompt(input: DiffSummaryInputType): string {
  return buildDiffTaskPrompt({
    taskLine:
      "Summarize the provided git diff as a structured developer-friendly overview.",
    guidanceLines: [
      "Only include risk areas when they are directly supported by the diff.",
      'The "summary" should be a short paragraph.',
      'The "majorAreas" array should contain concise grouped themes of the change.',
      'Omit "riskAreas" entirely when there are no clear risks supported by the diff.',
    ],
    schemaLines: [
      '  "summary": string,',
      '  "majorAreas": string[],',
      '  "riskAreas"?: string[]',
    ],
    diff: input.diff,
  });
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
