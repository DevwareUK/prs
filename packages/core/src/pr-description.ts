import {
  PRDescriptionInput,
  PRDescriptionInputType,
  PRDescriptionOutput,
  PRDescriptionOutputType,
} from "@prs/contracts";
import { AIProvider } from "@prs/providers";
import {
  buildDiffTaskPrompt,
  DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
} from "./diff-task";
import { generateStructuredOutput } from "./structured-generation";

const PR_DESCRIPTION_SYSTEM_PROMPT =
  [
    "You are a senior software engineer writing a GitHub pull request description.",
    "Be concise but informative.",
    ...DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
    "Focus on the intent and meaningful impact of the change, not every tiny diff line.",
    "Mention testing or risk details only when the diff supports them.",
  ].join(" ");

function buildPrompt(input: PRDescriptionInputType): string {
  const contextLines: string[] = [];
  if (input.issueTitle) {
    contextLines.push(`Issue Title: ${input.issueTitle}`);
  }
  if (input.issueBody) {
    contextLines.push(`Issue Body: ${input.issueBody}`);
  }

  return buildDiffTaskPrompt({
    taskLine: "Generate a GitHub pull request title and body from the provided diff.",
    guidanceLines: [
      'The "title" should be concise and specific to the change.',
      "Use issue context only as supporting context and prefer the diff when they conflict.",
      'The "body" must be concise markdown that explains the change narrative for the pull request description.',
      "Use short paragraphs or a short bullet list when it improves readability.",
      "Do not use the four-section template with Summary, Changes, Testing, and Risk headings.",
      "Do not add dedicated testing, risk, rollout, or reviewer checklist sections.",
      "Leave reviewer-operational detail for the managed PR Assistant section.",
    ],
    schemaLines: [
      '  "title": string,',
      '  "body": string',
    ],
    contextLines:
      contextLines.length > 0
        ? ["Supporting context (optional, may be incomplete):", ...contextLines]
        : undefined,
    diff: input.diff,
  });
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
    validationErrorPrefix: "Model output failed PR description schema validation",
  });

  return modelOutput;
}
