import {
  DEFAULT_PR_IMPACT_PROFILE,
  PRImpactProfile,
  PRImpactProfileType,
} from "@prs/contracts";

export const EMPTY_PR_IMPACT_PROFILE = DEFAULT_PR_IMPACT_PROFILE;

export const PR_IMPACT_PROFILE_GUIDANCE_LINES = [
  "Use the shared impact profile for PR-level risk metadata: risk level, evidence-backed risk reasons, affected areas, rollout impact, migration impact, configuration impact, security/performance flags, and manual verification hints.",
  'Set "riskLevel" to "none" when the diff does not support a concrete PR-level risk.',
  "Keep impact profile items concise, non-duplicative, and grounded in the diff or supporting PR context.",
  "Use calm empty arrays for low-signal or empty profile fields instead of generic warnings.",
] as const;

export const PR_IMPACT_PROFILE_SCHEMA_LINES = [
  '  "impactProfile": {',
  '    "riskLevel": "none" | "low" | "medium" | "high",',
  '    "riskReasons": string[],',
  '    "affectedAreas": string[],',
  '    "rolloutImpact": string[],',
  '    "migrationImpact": string[],',
  '    "configurationImpact": string[],',
  '    "flags": {',
  '      "security": boolean,',
  '      "performance": boolean',
  "    },",
  '    "manualVerification": string[]',
  "  },",
] as const;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizePRImpactProfile(value: unknown): PRImpactProfileType {
  if (!value || typeof value !== "object") {
    return EMPTY_PR_IMPACT_PROFILE;
  }

  const profile = value as Record<string, unknown>;
  const flags =
    profile.flags && typeof profile.flags === "object"
      ? (profile.flags as Record<string, unknown>)
      : {};

  return PRImpactProfile.parse({
    riskLevel: profile.riskLevel,
    riskReasons: normalizeStringArray(profile.riskReasons),
    affectedAreas: normalizeStringArray(profile.affectedAreas),
    rolloutImpact: normalizeStringArray(profile.rolloutImpact),
    migrationImpact: normalizeStringArray(profile.migrationImpact),
    configurationImpact: normalizeStringArray(profile.configurationImpact),
    flags: {
      security: flags.security === true,
      performance: flags.performance === true,
    },
    manualVerification: normalizeStringArray(profile.manualVerification),
  });
}

export function serializePRImpactProfile(profile: PRImpactProfileType): string {
  return JSON.stringify(PRImpactProfile.parse(profile), null, 2);
}

function heading(level: number, title: string): string {
  return `${"#".repeat(level)} ${title}`;
}

function renderListSection(
  title: string,
  items: string[],
  level: number
): string[] {
  if (items.length === 0) {
    return [];
  }

  return [heading(level, title), ...items.map((item) => `- ${item}`), ""];
}

export function formatPRImpactProfileMarkdown(
  profile: PRImpactProfileType | undefined,
  options: { headingLevel?: number } = {}
): string {
  const parsedProfile = PRImpactProfile.parse(profile ?? {});
  const headingLevel = options.headingLevel ?? 2;
  const nestedHeadingLevel = headingLevel + 1;
  const flagItems = [
    ...(parsedProfile.flags.security ? ["Security-sensitive change"] : []),
    ...(parsedProfile.flags.performance ? ["Performance-sensitive change"] : []),
  ];
  const hasImpactDetails =
    parsedProfile.riskReasons.length > 0 ||
    parsedProfile.affectedAreas.length > 0 ||
    parsedProfile.rolloutImpact.length > 0 ||
    parsedProfile.migrationImpact.length > 0 ||
    parsedProfile.configurationImpact.length > 0 ||
    flagItems.length > 0 ||
    parsedProfile.manualVerification.length > 0;
  const lines: string[] = [
    heading(headingLevel, "Impact Profile"),
    `Risk level: ${parsedProfile.riskLevel}`,
    "",
  ];

  if (!hasImpactDetails) {
    lines.push("No specific impact concerns noted.");
    return lines.join("\n");
  }

  lines.push(
    ...renderListSection(
      "Risk reasons",
      parsedProfile.riskReasons,
      nestedHeadingLevel
    ),
    ...renderListSection(
      "Affected areas",
      parsedProfile.affectedAreas,
      nestedHeadingLevel
    ),
    ...renderListSection(
      "Rollout impact",
      parsedProfile.rolloutImpact,
      nestedHeadingLevel
    ),
    ...renderListSection(
      "Migration impact",
      parsedProfile.migrationImpact,
      nestedHeadingLevel
    ),
    ...renderListSection(
      "Configuration impact",
      parsedProfile.configurationImpact,
      nestedHeadingLevel
    ),
    ...renderListSection(
      "Flags",
      flagItems,
      nestedHeadingLevel
    ),
    ...renderListSection(
      "Manual verification",
      parsedProfile.manualVerification,
      nestedHeadingLevel
    )
  );

  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}
