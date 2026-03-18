import {
  PRAssistantInput,
  PRAssistantInputType,
  PRAssistantOutput,
  PRAssistantOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import {
  buildDiffTaskPrompt,
  DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
} from "./diff-task";
import { generateStructuredOutput } from "./structured-generation";

const PR_ASSISTANT_SYSTEM_PROMPT = [
  "You are a senior software engineer writing a GitHub pull request assistant section for human reviewers.",
  "Be concise but informative.",
  ...DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
  "Focus on a reviewer-useful summary, key changes, risk areas, and reviewer guidance.",
  "Use the PR title, PR body, and commit messages only as supporting context and prefer the diff when they conflict.",
  "Only identify risks when they are supported by the diff or supporting context.",
  "Do not suggest reviewer checks that are not grounded in the change.",
].join(" ");

function buildPrompt(input: PRAssistantInputType): string {
  const contextLines: string[] = [];
  if (input.prTitle) {
    contextLines.push(`PR Title: ${input.prTitle}`);
  }
  if (input.prBody) {
    contextLines.push(`PR Body: ${input.prBody}`);
  }
  if (input.commitMessages) {
    contextLines.push("Commit Messages:");
    contextLines.push(input.commitMessages);
  }

  return buildDiffTaskPrompt({
    taskLine:
      "Generate a structured GitHub pull request assistant section from the provided diff.",
    guidanceLines: [
      'The "summary" should be a short paragraph describing the overall change and intent.',
      '"keyChanges" should list the most meaningful implementation changes for reviewers.',
      '"riskAreas" should list concrete review risks or be an empty array if none are clearly supported.',
      '"reviewerFocus" should list the specific checks a reviewer should make based on the diff.',
      "Avoid repeating the same point across multiple fields.",
    ],
    schemaLines: [
      '  "summary": string,',
      '  "keyChanges": string[],',
      '  "riskAreas": string[],',
      '  "reviewerFocus": string[]',
    ],
    contextLines:
      contextLines.length > 0
        ? ["Supporting context (optional, may be incomplete):", ...contextLines]
        : undefined,
    diff: input.diff,
  });
}

export async function generatePRAssistant(
  provider: AIProvider,
  input: PRAssistantInputType
): Promise<PRAssistantOutputType> {
  const parsedInput = PRAssistantInput.parse(input);
  const prompt = buildPrompt(parsedInput);

  return generateStructuredOutput({
    provider,
    systemPrompt: PR_ASSISTANT_SYSTEM_PROMPT,
    prompt,
    schema: PRAssistantOutput,
    validationErrorPrefix: "Model output failed PR assistant schema validation",
  });
}
