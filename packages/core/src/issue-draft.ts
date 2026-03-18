import {
  IssueDraftInput,
  IssueDraftInputType,
  IssueDraftModelOutput,
  IssueDraftOutput,
  IssueDraftOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";

const ISSUE_DRAFT_SYSTEM_PROMPT =
  [
    "You are a senior software engineer drafting implementation-ready GitHub issues.",
    "Turn rough feature ideas into clear, concrete work briefs for another engineer or coding agent.",
    "Make reasonable inferences from the provided idea and context, but do not invent repository-specific facts that were not supplied.",
    "Prefer actionable requirements and acceptance criteria over vague aspirations.",
    "Return valid JSON only.",
  ].join(" ");

function buildPrompt(input: IssueDraftInputType): string {
  const sections = [
    "Generate a structured GitHub issue draft from the feature idea below.",
    "The result should be detailed enough for a human contributor or coding agent to implement.",
    "Use concise but specific language.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "motivation": string,',
    '  "goal": string,',
    '  "proposedBehavior": string[],',
    '  "requirements": string[],',
    '  "constraints": string[] | null,',
    '  "acceptanceCriteria": string[]',
    "}",
    "",
    'Use "constraints" only when the idea or context implies real implementation boundaries; otherwise return null.',
    "Do not wrap JSON in markdown fences.",
    "",
    "Feature idea:",
    input.featureIdea,
  ];

  if (input.additionalContext) {
    sections.push("", "Additional context:", input.additionalContext);
  }

  return sections.join("\n");
}

function normalizeIssueDraftOutput(value: unknown): IssueDraftOutputType {
  return IssueDraftOutput.parse(value);
}

export async function generateIssueDraft(
  provider: AIProvider,
  input: IssueDraftInputType
): Promise<IssueDraftOutputType> {
  const parsedInput = IssueDraftInput.parse(input);
  const prompt = buildPrompt(parsedInput);
  const modelOutput = await generateStructuredOutput({
    provider,
    systemPrompt: ISSUE_DRAFT_SYSTEM_PROMPT,
    prompt,
    schema: IssueDraftModelOutput,
    validationErrorPrefix: "Model output failed issue draft schema validation",
    normalizeParsedJson: (value) => normalizeNullableFields(value, ["constraints"]),
  });

  return normalizeIssueDraftOutput(modelOutput);
}
