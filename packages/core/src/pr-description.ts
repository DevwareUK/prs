import {
  PRDescriptionInput,
  PRDescriptionInputType,
  PRDescriptionOutput,
  PRDescriptionOutputType,
} from "@ai-actions/contracts";
import { AIProvider } from "@ai-actions/providers";

function buildPrompt(input: PRDescriptionInputType): string {
  return [
    "Generate a GitHub pull request title and body from the diff.",
    "Return strictly valid JSON with keys: title, body, testingNotes, riskNotes.",
    "title and body are required strings. testingNotes and riskNotes are optional strings.",
    "Do not include markdown code fences.",
    "",
    `Issue Title: ${input.issueTitle ?? ""}`,
    `Issue Body: ${input.issueBody ?? ""}`,
    "",
    "Diff:",
    input.diff,
  ].join("\n");
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match?.[1]) {
      return JSON.parse(match[1]);
    }
    throw new Error("Model output was not valid JSON");
  }
}

export async function generatePRDescription(
  provider: AIProvider,
  input: PRDescriptionInputType
): Promise<PRDescriptionOutputType> {
  const parsedInput = PRDescriptionInput.parse(input);
  const prompt = buildPrompt(parsedInput);
  const rawResponse = await provider.generate(prompt);
  const parsedOutput = extractJson(rawResponse);

  return PRDescriptionOutput.parse(parsedOutput);
}
