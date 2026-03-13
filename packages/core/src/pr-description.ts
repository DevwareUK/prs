import {
  PRDescriptionInput,
  PRDescriptionInputType,
  PRDescriptionOutput,
  PRDescriptionOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";

const PR_DESCRIPTION_SYSTEM_PROMPT =
  [
    "You are a senior software engineer writing a GitHub pull request description.",
    "Be concise but informative.",
    "Focus on the intent and meaningful impact of the change, not every tiny diff line.",
    "Mention testing or risk details only when the diff supports them.",
    "Do not hallucinate or invent missing context.",
    "If uncertain, omit claims rather than guessing.",
    "Return valid JSON only.",
  ].join(" ");

function buildPrompt(input: PRDescriptionInputType): string {
  const contextLines: string[] = [];
  if (input.issueTitle) {
    contextLines.push(`Issue Title: ${input.issueTitle}`);
  }
  if (input.issueBody) {
    contextLines.push(`Issue Body: ${input.issueBody}`);
  }

  return [
    "Generate a GitHub pull request title and body from the provided diff.",
    "Explain the intent of the change at a high level.",
    'The "title" should be concise and specific to the change.',
    "Use issue context only as supporting context and prefer the diff when they conflict.",
    "If the diff does not support a claim, omit it.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "title": string,',
    '  "body": string,',
    '  "testingNotes"?: string,',
    '  "riskNotes"?: string',
    "}",
    "",
    'The "body" must be markdown using these section headings:',
    "## Summary",
    "High-level explanation of what changed.",
    "",
    "## Changes",
    "Bullet list of important changes.",
    "",
    "## Testing",
    "How a reviewer could validate the change.",
    "",
    "## Risk",
    "Potential risks, rollout notes, or migration concerns.",
    "",
    'Omit "testingNotes" when there are no concrete validation steps supported by the diff.',
    'Omit "riskNotes" when there are no clear risks, rollout notes, or migration concerns supported by the diff.',
    "",
    "Do not wrap JSON in markdown fences.",
    "",
    ...(contextLines.length > 0
      ? ["Supporting context (optional, may be incomplete):", ...contextLines, ""]
      : []),
    "Diff:",
    input.diff,
  ].join("\n");
}

export async function generatePRDescription(
  provider: AIProvider,
  input: PRDescriptionInputType
): Promise<PRDescriptionOutputType> {
  const parsedInput = PRDescriptionInput.parse(input);
  const prompt = buildPrompt(parsedInput);
  const modelOutput = await generateStructuredOutput({
    provider,
    systemPrompt: PR_DESCRIPTION_SYSTEM_PROMPT,
    prompt,
    schema: PRDescriptionOutput,
    validationErrorPrefix:
      "Model output failed PR description schema validation",
    normalizeParsedJson: (value) =>
      normalizeNullableFields(value, ["testingNotes", "riskNotes"]),
  });

  return modelOutput;
}
