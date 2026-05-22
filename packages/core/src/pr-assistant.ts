import {
  PRAssistantInput,
  PRAssistantInputType,
  PRAssistantOutput,
  PRAssistantOutputType,
  PRImpactProfile,
} from "@prs/contracts";
import { AIProvider } from "@prs/providers";
import { z } from "zod";
import {
  buildDiffTaskPrompt,
  DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
} from "./diff-task";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";
import {
  EMPTY_PR_IMPACT_PROFILE,
  normalizePRImpactProfile,
  PR_IMPACT_PROFILE_GUIDANCE_LINES,
  PR_IMPACT_PROFILE_SCHEMA_LINES,
} from "./pr-impact-profile";

const PR_ASSISTANT_SYSTEM_PROMPT = [
  "You are a senior software engineer writing a GitHub pull request assistant section for human reviewers.",
  "Be concise, repetitive, and predictable.",
  ...DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
  "Focus on a reviewer-useful summary, risk areas, testing notes, rollout concerns, and reviewer checklist items.",
  "Use the PR title, PR body, and commit messages only as supporting context and prefer the diff when they conflict.",
  "Only identify risks when they are supported by the diff or supporting context.",
  "Do not suggest reviewer checks that are not grounded in the change.",
  "Use calm empty states and avoid novelty or marketing language.",
].join(" ");

const PRAssistantModelItem = z.string().trim().min(1);

const PRAssistantModelOutput = z.object({
  summary: z.string().trim().min(1, "summary must be non-empty"),
  impactProfile: PRImpactProfile.default(EMPTY_PR_IMPACT_PROFILE),
  testingNotes: z.array(PRAssistantModelItem).default([]),
  reviewerChecklist: z.array(PRAssistantModelItem).default([]),
});

function collectChangedFiles(diff: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const line of diff.split("\n")) {
    if (!line.startsWith("diff --git ")) {
      continue;
    }

    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) {
      continue;
    }

    const [, fromPath, toPath] = match;
    const resolvedPath =
      toPath === "dev/null" ? fromPath : fromPath === "dev/null" ? toPath : toPath;
    if (!seen.has(resolvedPath)) {
      seen.add(resolvedPath);
      files.push(resolvedPath);
    }
  }

  return files;
}

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
      ...PR_IMPACT_PROFILE_GUIDANCE_LINES,
      '"testingNotes" should list testing evidence, gaps, or notable verification context grounded in the diff or supporting context.',
      '"reviewerChecklist" should list the specific checks a reviewer should make based on the diff.',
      "Do not include a files list in the JSON. File paths are derived from the diff separately.",
      "Avoid repeating the same point across multiple fields.",
    ],
    schemaLines: [
      '  "summary": string,',
      ...PR_IMPACT_PROFILE_SCHEMA_LINES,
      '  "testingNotes": string[],',
      '  "reviewerChecklist": string[]',
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
  const modelOutput = await generateStructuredOutput({
    provider,
    systemPrompt: PR_ASSISTANT_SYSTEM_PROMPT,
    prompt,
    schema: PRAssistantModelOutput,
    validationErrorPrefix: "Model output failed PR assistant schema validation",
    normalizeParsedJson: (value) => {
      const normalized = normalizeNullableFields(value, [
        "testingNotes",
        "reviewerChecklist",
      ]);
      if (!normalized || typeof normalized !== "object") {
        return normalized;
      }

      return {
        ...(normalized as Record<string, unknown>),
        impactProfile: normalizePRImpactProfile(
          (normalized as Record<string, unknown>).impactProfile
        ),
      };
    },
  });
  const impactProfile = normalizePRImpactProfile(modelOutput.impactProfile);

  return PRAssistantOutput.parse({
    ...modelOutput,
    impactProfile,
    riskAreas: impactProfile.riskReasons,
    filesChanged: collectChangedFiles(parsedInput.diff),
    rolloutConcerns: impactProfile.rolloutImpact,
  });
}
