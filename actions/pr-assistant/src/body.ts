import { PRAssistantOutputType } from "@git-ai/contracts";

export const PR_ASSISTANT_START_MARKER = "<!-- git-ai:pr-assistant:start -->";
export const PR_ASSISTANT_END_MARKER = "<!-- git-ai:pr-assistant:end -->";

const PR_ASSISTANT_SECTION_PATTERN = new RegExp(
  `${escapeRegExp(PR_ASSISTANT_START_MARKER)}[\\s\\S]*?${escapeRegExp(PR_ASSISTANT_END_MARKER)}`,
  "m"
);

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
  summary: PRAssistantOutputType
): string {
  const lines: string[] = ["## PR Assistant", "", "### Summary", summary.summary, ""];

  lines.push(...renderBulletSection("Key changes", summary.keyChanges, "No key changes identified."));
  lines.push(
    ...renderBulletSection(
      "Risk areas",
      summary.riskAreas,
      "No additional diff-grounded risk areas identified."
    )
  );
  lines.push(
    ...renderBulletSection(
      "Reviewer focus",
      summary.reviewerFocus,
      "No additional reviewer focus areas identified."
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
