import {
  PRDescriptionInput,
  PRDescriptionInputType,
  PRDescriptionOutput,
  PRDescriptionOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import { generateStructuredOutput } from "./structured-generation";

const PR_DESCRIPTION_SYSTEM_PROMPT =
  [
    "You are a senior software engineer writing a GitHub pull request description.",
    "Be concise but informative.",
    "Focus on the intent and meaningful impact of the change, not every tiny diff line.",
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
    "Use issue context only as supporting context and prefer the diff when they conflict.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "title": string,',
    '  "body": string,',
    '  "testingNotes": string | null,',
    '  "riskNotes": string | null',
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
    "Do not wrap JSON in markdown fences.",
    "",
    ...(contextLines.length > 0
      ? ["Supporting context (optional, may be incomplete):", ...contextLines, ""]
      : []),
    "Diff:",
    input.diff,
  ].join("\n");
}

function normalizeNullableNotes(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const result = { ...(value as Record<string, unknown>) };
  if (result.testingNotes === null) {
    result.testingNotes = undefined;
  }
  if (result.riskNotes === null) {
    result.riskNotes = undefined;
  }

  return result;
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
    normalizeParsedJson: normalizeNullableNotes,
  });

  return modelOutput;
}
