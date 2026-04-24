import { z } from "zod";
import { AIProvider } from "@prs/providers";
import {
  StructuredGenerationError,
  type StructuredGenerationValidationIssue,
} from "./structured-generation-error";

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
    throw new Error(message);
  }
}

function inferStructuredOutputLabel(
  validationErrorPrefix: string
): string | undefined {
  const match = validationErrorPrefix.match(
    /^Model output failed (.+) schema validation$/
  );
  return match?.[1];
}

function formatJsonParseFailureMessage(
  validationErrorPrefix: string,
  parseErrorMessage: string
): string {
  const outputLabel = inferStructuredOutputLabel(validationErrorPrefix);
  if (!outputLabel) {
    return `Failed to parse model output as JSON: ${parseErrorMessage}`;
  }

  return `Failed to parse ${outputLabel} model output as JSON: ${parseErrorMessage}`;
}

function formatValidationIssuePath(path: (string | number)[]): string {
  if (path.length === 0) {
    return "(root)";
  }

  let formattedPath = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      formattedPath += `[${segment}]`;
      continue;
    }

    formattedPath += formattedPath ? `.${segment}` : segment;
  }

  return formattedPath;
}

function toValidationIssue(
  issue: z.ZodIssue
): StructuredGenerationValidationIssue {
  return {
    path: formatValidationIssuePath(issue.path),
    message: issue.message,
    code: issue.code,
  };
}

function formatValidationIssues(
  issues: StructuredGenerationValidationIssue[]
): string {
  return issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n");
}

export function normalizeNullableFields(
  value: unknown,
  fieldNames: string[]
): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const result = { ...(value as Record<string, unknown>) };
  for (const fieldName of fieldNames) {
    if (result[fieldName] === null) {
      result[fieldName] = undefined;
    }
  }

  return result;
}

export async function generateStructuredOutput<TSchema extends z.ZodTypeAny>(
  options: GenerateStructuredOutputOptions<TSchema>
): Promise<z.output<TSchema>> {
  const rawResponse = await options.provider.generateText({
    systemPrompt: options.systemPrompt,
    prompt: options.prompt,
    temperature: options.temperature ?? 0.2,
  });

  let parsedJson: unknown;
  try {
    parsedJson = parseModelJson(rawResponse);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StructuredGenerationError({
      kind: "json_parse",
      message: formatJsonParseFailureMessage(
        options.validationErrorPrefix,
        message
      ),
      rawResponse,
    });
  }

  const normalizedJson = options.normalizeParsedJson
    ? options.normalizeParsedJson(parsedJson)
    : parsedJson;
  const validated = options.schema.safeParse(normalizedJson);
  if (!validated.success) {
    const validationIssues = validated.error.issues.map(toValidationIssue);
    throw new StructuredGenerationError({
      kind: "schema_validation",
      message: `${options.validationErrorPrefix}:\n${formatValidationIssues(validationIssues)}`,
      rawResponse,
      parsedJson,
      normalizedJson,
      validationIssues,
    });
  }

  return validated.data;
}
