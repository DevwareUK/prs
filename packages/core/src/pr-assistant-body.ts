import {
  PRAssistantOutputType,
  PR_ASSISTANT_END_MARKER,
  PR_ASSISTANT_START_MARKER,
} from "@prs/contracts";
import { formatPRImpactProfileMarkdown } from "./pr-impact-profile";
export {
  PR_ASSISTANT_END_MARKER,
  PR_ASSISTANT_START_MARKER,
} from "@prs/contracts";

const PR_ASSISTANT_SECTION_PATTERN = new RegExp(
  `${escapeRegExp(PR_ASSISTANT_START_MARKER)}[\\s\\S]*?${escapeRegExp(PR_ASSISTANT_END_MARKER)}`,
  "m"
);

type PRAssistantSectionInput =
  | PRAssistantOutputType
  | Omit<PRAssistantOutputType, "impactProfile">;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderBulletSection(
  title: string,
  items: string[],
  emptyState: string
): string[] {
  return [
    `### ${title}`,
    ...(items.length > 0 ? items.map((item) => `- ${item}`) : [emptyState]),
    "",
  ];
}

function hasImpactProfile(
  assistant: PRAssistantSectionInput
): assistant is PRAssistantOutputType {
  return "impactProfile" in assistant;
}

export function stripManagedPRAssistantSection(
  body: string | undefined
): string | undefined {
  if (!body) {
    return undefined;
  }

  const stripped = body
    .replace(PR_ASSISTANT_SECTION_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped ? stripped : undefined;
}

export function buildPRAssistantSection(
  assistant: PRAssistantSectionInput
): string {
  const lines: string[] = ["## PR Assistant", "", "### Summary", assistant.summary, ""];

  if (hasImpactProfile(assistant)) {
    lines.push(
      ...formatPRImpactProfileMarkdown(assistant.impactProfile, {
        headingLevel: 3,
      }).split("\n"),
      ""
    );
  } else {
    lines.push(
      ...renderBulletSection(
        "Risk areas",
        assistant.riskAreas,
        "None noted."
      )
    );
  }
  lines.push(
    ...renderBulletSection(
      "Files changed",
      assistant.filesChanged,
      "No changed files detected from the diff."
    )
  );
  lines.push(
    ...renderBulletSection(
      "Testing notes",
      assistant.testingNotes,
      "None noted."
    )
  );
  if (!hasImpactProfile(assistant)) {
    lines.push(
      ...renderBulletSection(
        "Rollout concerns",
        assistant.rolloutConcerns,
        "None noted."
      )
    );
  }
  lines.push(
    ...renderBulletSection(
      "Reviewer checklist",
      assistant.reviewerChecklist,
      "None noted."
    )
  );

  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

export function mergePRAssistantSection(
  existingBody: string | undefined,
  section: string
): string {
  const managedSection = [
    PR_ASSISTANT_START_MARKER,
    section,
    PR_ASSISTANT_END_MARKER,
  ].join("\n");

  if (!existingBody?.trim()) {
    return managedSection;
  }

  const trimmedBody = existingBody.trim();
  if (PR_ASSISTANT_SECTION_PATTERN.test(trimmedBody)) {
    return trimmedBody.replace(PR_ASSISTANT_SECTION_PATTERN, managedSection).trim();
  }

  return `${trimmedBody}\n\n${managedSection}`;
}
