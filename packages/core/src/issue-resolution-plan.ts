import {
  IssueResolutionPlanInput,
  IssueResolutionPlanInputType,
  IssueResolutionPlanModelOutput,
  IssueResolutionPlanOutput,
  IssueResolutionPlanOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";

const ISSUE_RESOLUTION_PLAN_SYSTEM_PROMPT =
  [
    "You are a senior software engineer planning implementation work for a GitHub issue.",
    "Generate a concrete, editable resolution plan that another engineer or coding agent can follow.",
    "Use only the supplied issue context and reasonable engineering inferences.",
    "Do not invent repository-specific facts that were not provided.",
    "Return valid JSON only.",
  ].join(" ");

function buildPrompt(input: IssueResolutionPlanInputType): string {
  const sections = [
    "Generate a structured resolution plan for the GitHub issue below.",
    "The plan should be practical, sequenced, and easy for a collaborator to edit.",
    "Return strictly valid JSON in this exact shape:",
    "{",
    '  "summary": string,',
    '  "acceptanceCriteria": string[],',
    '  "likelyFiles": string[],',
    '  "implementationSteps": string[],',
    '  "testPlan": string[],',
    '  "risks": string[],',
    '  "doneDefinition": string[],',
    '  "openQuestions": string[] | null',
    "}",
    "",
    'Make "acceptanceCriteria" concrete and checkable against the issue goal.',
    'Make "likelyFiles" a list of likely repository-relative paths or code areas to inspect; use the most plausible targets from the issue context rather than placeholders.',
    'Make "risks" explicit. If no major risk is evident, return a single item stating that no concrete delivery risks were identified from the current issue context.',
    'Make "testPlan" the validation steps a contributor should run or perform before considering the work complete.',
    'Make "doneDefinition" the conditions that should be true when the issue is actually finished.',
    'Use "openQuestions" only when the issue leaves important decisions unresolved; otherwise return null.',
    "Do not wrap JSON in markdown fences.",
    "",
    `Issue title: ${input.issueTitle}`,
  ];

  if (input.issueNumber) {
    sections.push(`Issue number: ${input.issueNumber}`);
  }

  if (input.issueUrl) {
    sections.push(`Issue URL: ${input.issueUrl}`);
  }

  sections.push(
    "",
    "Issue body:",
    input.issueBody?.trim() || "(No issue body provided.)"
  );

  sections.push(
    "",
    "Every plan must cover acceptance criteria, likely files, test plan, risks, and a done definition."
  );

  return sections.join("\n");
}

function normalizeIssueResolutionPlanOutput(
  value: unknown
): IssueResolutionPlanOutputType {
  return IssueResolutionPlanOutput.parse(value);
}

export async function generateIssueResolutionPlan(
  provider: AIProvider,
  input: IssueResolutionPlanInputType
): Promise<IssueResolutionPlanOutputType> {
  const parsedInput = IssueResolutionPlanInput.parse(input);
  const prompt = buildPrompt(parsedInput);
  const modelOutput = await generateStructuredOutput({
    provider,
    systemPrompt: ISSUE_RESOLUTION_PLAN_SYSTEM_PROMPT,
    prompt,
    schema: IssueResolutionPlanModelOutput,
    validationErrorPrefix:
      "Model output failed issue resolution plan schema validation",
    normalizeParsedJson: (value) =>
      normalizeNullableFields(value, ["openQuestions"]),
  });

  return normalizeIssueResolutionPlanOutput(modelOutput);
}
