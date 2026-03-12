import { z } from "zod";
import { AIProvider } from "@git-ai/providers";

interface GenerateStructuredOutputOptions<TSchema extends z.ZodTypeAny> {
  provider: AIProvider;
  systemPrompt: string;
  prompt: string;
  schema: TSchema;
  validationErrorPrefix: string;
  normalizeParsedJson?: (value: unknown) => unknown;
  temperature?: number;
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

export async function generateStructuredOutput<TSchema extends z.ZodTypeAny>(
  options: GenerateStructuredOutputOptions<TSchema>
): Promise<z.output<TSchema>> {
  const rawResponse = await options.provider.generateText({
    systemPrompt: options.systemPrompt,
    prompt: options.prompt,
    temperature: options.temperature ?? 0.2,
  });

  const parsedJson = parseModelJson(rawResponse);
  const normalizedJson = options.normalizeParsedJson
    ? options.normalizeParsedJson(parsedJson)
    : parsedJson;
  const validated = options.schema.safeParse(normalizedJson);
  if (!validated.success) {
    throw new Error(
      `${options.validationErrorPrefix}: ${validated.error.message}`
    );
  }

  return validated.data;
}
