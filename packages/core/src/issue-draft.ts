import {
  IssueDraftGuidanceInput,
  IssueDraftGuidanceInputType,
  IssueDraftGuidanceOutput,
  IssueDraftGuidanceOutputType,
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

const ISSUE_DRAFT_GUIDANCE_SYSTEM_PROMPT =
  [
    "You are a senior software engineer guiding a repository-aware issue specification workflow.",
    "You will receive a rough idea, repository context, and any prior clarifying answers.",
    "Decide whether the issue is specific enough to draft now.",
    "If important details are still missing, ask only the next one to three highest-value questions.",
    "Questions must be concrete, repository-aware, and focused on implementation scope, user impact, constraints, or acceptance criteria.",
    "Avoid generic checklists and avoid repeating questions already answered.",
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

  if (input.repositoryContext) {
    sections.push("", "Repository context:", input.repositoryContext);
  }

  if (input.clarificationTranscript) {
    sections.push("", "Clarification transcript:", input.clarificationTranscript);
  }

  return sections.join("\n");
}

function buildGuidancePrompt(input: IssueDraftGuidanceInputType): string {
  const sections = [
    "Review the rough issue idea and repository context below.",
    "Decide whether the issue is ready to draft or whether targeted clarification is still needed.",
    "Return strictly valid JSON in one of these exact shapes:",
    "{",
    '  "status": "clarify",',
    '  "assistantSummary": string,',
    '  "missingInformation": string[],',
    '  "questions": string[]',
    "}",
    "or",
    "{",
    '  "status": "ready",',
    '  "assistantSummary": string',
    "}",
    "",
    'Use "clarify" only when genuinely important implementation details are still missing.',
    'Use "ready" when the issue is sufficiently specified for a strong implementation-ready draft.',
    "Do not wrap JSON in markdown fences.",
    "",
    "Rough idea:",
    input.featureIdea,
  ];

  if (input.additionalContext) {
    sections.push("", "Additional context:", input.additionalContext);
  }

  sections.push("", "Repository context:", input.repositoryContext);

  if (input.answers && input.answers.length > 0) {
    sections.push("", "Clarifying answers:");
    for (const answer of input.answers) {
      sections.push(`Q: ${answer.question}`, `A: ${answer.answer}`, "");
    }
    sections.pop();
  } else {
    sections.push("", "Clarifying answers:", "(none yet)");
  }

  return sections.join("\n");
}

function normalizeIssueDraftOutput(value: unknown): IssueDraftOutputType {
  return IssueDraftOutput.parse(value);
}

function normalizeIssueDraftGuidanceOutput(
  value: unknown
): IssueDraftGuidanceOutputType {
  return IssueDraftGuidanceOutput.parse(value);
}

export async function generateIssueDraftGuidance(
  provider: AIProvider,
  input: IssueDraftGuidanceInputType
): Promise<IssueDraftGuidanceOutputType> {
  const parsedInput = IssueDraftGuidanceInput.parse(input);
  const prompt = buildGuidancePrompt(parsedInput);
  const modelOutput = await generateStructuredOutput({
    provider,
    systemPrompt: ISSUE_DRAFT_GUIDANCE_SYSTEM_PROMPT,
    prompt,
    schema: IssueDraftGuidanceOutput,
    validationErrorPrefix:
      "Model output failed issue draft guidance schema validation",
    temperature: 0.1,
  });

  return normalizeIssueDraftGuidanceOutput(modelOutput);
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
