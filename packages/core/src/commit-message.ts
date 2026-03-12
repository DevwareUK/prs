import {
  CommitMessageInput,
  CommitMessageInputType,
  CommitMessageModelOutput,
  CommitMessageModelOutputType,
  CommitMessageOutput,
  CommitMessageOutputType,
} from "@ai-actions/contracts";
import { AIProvider } from "@ai-actions/providers";

const COMMIT_MESSAGE_SYSTEM_PROMPT =
  [
    "You are a senior software engineer writing git commit messages.",
    "Write a concise one-line title in imperative mood.",
    "Prefer Conventional Commit prefixes when they fit, such as feat:, fix:, refactor:, docs:, chore:, and test:.",
    "Avoid vague titles like Update files, Fix stuff, or Misc changes.",
    "Keep the title under roughly 72 characters.",
    "Include a short body only when it adds useful context.",
    "Do not hallucinate or invent missing context.",
    "Return valid JSON only.",
  ].join(" ");

function buildPrompt(input: CommitMessageInputType): string {
  return [
    "Generate a git commit message from the provided diff.",
    "The title must be a concise single line in imperative mood.",
    "Prefer a Conventional Commit prefix when it clearly matches the change, for example feat:, fix:, refactor:, docs:, chore:, or test:.",
    "Avoid vague titles such as Update files, Fix stuff, or Misc changes.",
    "Keep the title under roughly 72 characters.",
    "Only include a body when it adds useful context beyond the title.",
    "Do not invent behavior, rationale, or scope that is not supported by the diff.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "title": string,',
    '  "body": string | null',
    "}",
    "",
    'Use "body" only if a short explanatory body is needed; otherwise return null.',
    "Do not wrap JSON in markdown fences.",
    "",
    "Diff:",
    input.diff,
  ].join("\n");
}

function stripMarkdownJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  return trimmed;
}

function parseModelJson(raw: string): unknown {
  const normalized = stripMarkdownJsonFences(raw);
  try {
    return JSON.parse(normalized);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse model output as JSON: ${message}`);
  }
}

function normalizeCommitMessageOutput(
  value: CommitMessageModelOutputType
): CommitMessageOutputType {
  return CommitMessageOutput.parse({
    title: value.title,
    body: value.body ?? undefined,
  });
}

export async function generateCommitMessage(
  provider: AIProvider,
  diff: string
): Promise<CommitMessageOutputType> {
  const parsedInput = CommitMessageInput.parse({ diff });
  const prompt = buildPrompt(parsedInput);
  const rawResponse = await provider.generateText({
    systemPrompt: COMMIT_MESSAGE_SYSTEM_PROMPT,
    prompt,
    temperature: 0.2,
  });

  const parsedJson = parseModelJson(rawResponse.trim());
  const validatedModelOutput = CommitMessageModelOutput.safeParse(parsedJson);
  if (!validatedModelOutput.success) {
    throw new Error(
      `Model output failed commit message schema validation: ${validatedModelOutput.error.message}`
    );
  }

  return normalizeCommitMessageOutput(validatedModelOutput.data);
}
