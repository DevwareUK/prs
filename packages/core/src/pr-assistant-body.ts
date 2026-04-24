import {
  ALL_PR_ASSISTANT_END_MARKERS,
  ALL_PR_ASSISTANT_START_MARKERS,
  PRAssistantOutputType,
} from "@prs/contracts";
export {
  PR_ASSISTANT_END_MARKER,
  PR_ASSISTANT_START_MARKER,
} from "@prs/contracts";
import {
  PR_ASSISTANT_END_MARKER,
  PR_ASSISTANT_START_MARKER,
} from "@prs/contracts";

const PR_ASSISTANT_SECTION_PATTERN = new RegExp(
  `${buildMarkerGroup(ALL_PR_ASSISTANT_START_MARKERS)}[\\s\\S]*?${buildMarkerGroup(ALL_PR_ASSISTANT_END_MARKERS)}`,
  "m"
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMarkerGroup(markers: readonly string[]): string {
  return `(?:${markers.map((marker) => escapeRegExp(marker)).join("|")})`;
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
  assistant: PRAssistantOutputType
): string {
  const lines: string[] = ["## PR Assistant", "", "### Summary", assistant.summary, ""];

  lines.push(
    ...renderBulletSection(
      "Risk areas",
      assistant.riskAreas,
      "None noted."
    )
  );
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
  lines.push(
    ...renderBulletSection(
      "Rollout concerns",
      assistant.rolloutConcerns,
      "None noted."
    )
  );
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
