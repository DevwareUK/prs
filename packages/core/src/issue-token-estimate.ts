export type IssueEstimateThinkingLevel =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type IssueEstimateProfile = {
  name: string;
  role?: string;
  model: string;
  thinking: IssueEstimateThinkingLevel;
};

export type IssueEstimateFileContext = {
  path: string;
  exists: boolean;
  lineCount: number;
};

export type IssueEstimateInput = {
  planBody: string;
  profiles: IssueEstimateProfile[];
  implementerProfileName?: string;
  costEstimates?: IssueEstimateCostSettings;
  context?: {
    likelyFiles?: IssueEstimateFileContext[];
    verificationCommands?: string[][];
    scanBudget?: {
      filesConsidered: number;
      filesScanned: number;
      maxFiles: number;
      exhausted: boolean;
    };
  };
};

export type IssueTokenRange = {
  low: number;
  high: number;
};

export type IssueCostRange = {
  low: number;
  high: number;
};

export type IssueEstimateModelTokenRates = {
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
};

export type IssueEstimateCostBasis = {
  currency: "USD";
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  inputTokenRatio: number;
  outputTokenRatio: number;
  blendedRatePerMillionTokens: number;
  source: string;
};

export type IssueEstimateCostSettings = {
  currency: "USD";
  inputTokenRatio: number;
  outputTokenRatio: number;
  modelRates: Record<string, IssueEstimateModelTokenRates>;
};

export type IssueProfileTokenEstimate = IssueEstimateProfile & {
  range: IssueTokenRange;
  costBasis: IssueEstimateCostBasis;
  costRange: IssueCostRange;
  confidence: "high" | "medium" | "low";
  notes: string[];
};

export type IssueImplementationTokenEstimate = {
  status: "estimated";
  profiles: IssueProfileTokenEstimate[];
  cost: {
    currency: "USD";
    inputTokenRatio: number;
    outputTokenRatio: number;
    explanation: string;
  };
  drivers: string[];
  warnings: string[];
  recommendation: string;
  confidence: "high" | "medium" | "low";
  scanBudget: {
    status: "complete" | "exhausted";
    filesConsidered: number;
    filesScanned: number;
    maxFiles: number;
  };
};

export const DEFAULT_ISSUE_ESTIMATE_INPUT_TOKEN_RATIO = 0.8;
export const DEFAULT_ISSUE_ESTIMATE_OUTPUT_TOKEN_RATIO = 0.2;

export const DEFAULT_ISSUE_ESTIMATE_MODEL_RATES_USD_PER_MILLION = {
  "gpt-5.5": {
    inputPerMillionTokens: 5,
    outputPerMillionTokens: 30,
  },
  "gpt-5.4": {
    inputPerMillionTokens: 2.5,
    outputPerMillionTokens: 15,
  },
  "gpt-5.4-mini": {
    inputPerMillionTokens: 0.75,
    outputPerMillionTokens: 4.5,
  },
} satisfies Record<string, IssueEstimateModelTokenRates>;

export const DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION = {
  inputPerMillionTokens: 5,
  outputPerMillionTokens: 30,
} satisfies IssueEstimateModelTokenRates;

export const DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS = {
  currency: "USD",
  inputTokenRatio: DEFAULT_ISSUE_ESTIMATE_INPUT_TOKEN_RATIO,
  outputTokenRatio: DEFAULT_ISSUE_ESTIMATE_OUTPUT_TOKEN_RATIO,
  modelRates: DEFAULT_ISSUE_ESTIMATE_MODEL_RATES_USD_PER_MILLION,
} satisfies IssueEstimateCostSettings;

const MANAGED_MARKER_PATTERN = /^<!--\s*prs:issue-plan\s*-->\s*$/i;
const RISK_TERMS = [
  "auth",
  "cache",
  "command",
  "concurrency",
  "contract",
  "generated",
  "migration",
  "network",
  "runtime",
  "schema",
  "workflow",
];

function normalizePlanPath(value: string): string | undefined {
  const trimmed = value
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/^\.\//, "");
  if (!trimmed || trimmed.includes("\n")) {
    return undefined;
  }
  if (!/[/\\]/.test(trimmed) && !/\.[a-z0-9]+$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/\\/g, "/");
}

function stripManagedMarker(planBody: string): string {
  return planBody
    .split(/\r?\n/)
    .filter((line) => !MANAGED_MARKER_PATTERN.test(line.trim()))
    .join("\n")
    .trim();
}

export function extractIssueImplementationPlanFiles(planBody: string): string[] {
  const lines = stripManagedMarker(planBody).split(/\r?\n/);
  const start = lines.findIndex((line) =>
    /^#{2,3}\s+Likely files\s*$/i.test(line.trim())
  );
  if (start === -1) {
    return [];
  }

  const files: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3}\s+/.test(line.trim())) {
      break;
    }

    const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }

    const path = normalizePlanPath(match[1] ?? "");
    if (path) {
      files.push(path);
    }
  }

  return [...new Set(files)];
}

function countImplementationSteps(planBody: string): number {
  const lines = stripManagedMarker(planBody).split(/\r?\n/);
  const numberedSteps = lines.filter((line) => /^\s*\d+\.\s+\S/.test(line)).length;
  if (numberedSteps > 0) {
    return numberedSteps;
  }

  const stepsStart = lines.findIndex((line) =>
    /^#{2,3}\s+(Steps|Implementation steps|Plan)\s*$/i.test(line.trim())
  );
  if (stepsStart === -1) {
    return 0;
  }

  return lines
    .slice(stepsStart + 1)
    .filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
}

function countRiskTerms(planBody: string): number {
  const normalized = planBody.toLowerCase();
  return RISK_TERMS.filter((term) => normalized.includes(term)).length;
}

function roundToThousand(value: number): number {
  return Math.max(1000, Math.round(value / 1000) * 1000);
}

function calculateBlendedRate(
  rates: IssueEstimateModelTokenRates,
  costSettings: IssueEstimateCostSettings
): number {
  return Number(
    (
      rates.inputPerMillionTokens * costSettings.inputTokenRatio +
      rates.outputPerMillionTokens * costSettings.outputTokenRatio
    ).toFixed(4)
  );
}

function estimateCostRange(
  range: IssueTokenRange,
  blendedRatePerMillionTokens: number
): IssueCostRange {
  return {
    low: Number(((range.low / 1_000_000) * blendedRatePerMillionTokens).toFixed(2)),
    high: Number(((range.high / 1_000_000) * blendedRatePerMillionTokens).toFixed(2)),
  };
}

function createCostBasis(
  profile: IssueEstimateProfile,
  costSettings: IssueEstimateCostSettings
): IssueEstimateCostBasis {
  const normalizedModel = profile.model.toLowerCase();
  const rates =
    costSettings.modelRates[profile.model] ??
    costSettings.modelRates[normalizedModel] ??
    DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION;
  const source =
    costSettings.modelRates[profile.model] || costSettings.modelRates[normalizedModel]
      ? `model-rate:${profile.model}`
      : "fallback-model-rate";

  return {
    currency: costSettings.currency,
    inputPerMillionTokens: rates.inputPerMillionTokens,
    outputPerMillionTokens: rates.outputPerMillionTokens,
    inputTokenRatio: costSettings.inputTokenRatio,
    outputTokenRatio: costSettings.outputTokenRatio,
    blendedRatePerMillionTokens: calculateBlendedRate(rates, costSettings),
    source,
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function profileMultiplier(profile: IssueEstimateProfile): number {
  const model = profile.model.toLowerCase();
  let multiplier = 1;
  if (model.includes("mini")) {
    multiplier += 0.35;
  }
  if (model.includes("spark")) {
    multiplier += 0.45;
  }
  if (profile.thinking === "none" || profile.thinking === "minimal") {
    multiplier -= 0.08;
  }
  if (profile.thinking === "high" || profile.thinking === "xhigh") {
    multiplier += 0.08;
  }
  return Math.max(0.8, multiplier);
}

function confidenceFor(input: {
  likelyFiles: string[];
  missingFiles: number;
  stepCount: number;
  riskTermCount: number;
  scanExhausted: boolean;
}): "high" | "medium" | "low" {
  if (
    input.scanExhausted ||
    input.stepCount === 0 ||
    input.likelyFiles.length === 0 ||
    input.missingFiles > 3
  ) {
    return "low";
  }
  if (input.riskTermCount > 4 || input.missingFiles > 0) {
    return "medium";
  }
  return "high";
}

export function estimateIssueImplementationTokens(
  input: IssueEstimateInput
): IssueImplementationTokenEstimate {
  const planBody = stripManagedMarker(input.planBody);
  const likelyFilesFromPlan = extractIssueImplementationPlanFiles(input.planBody);
  const fileContext = input.context?.likelyFiles ?? [];
  const likelyFiles =
    fileContext.length > 0 ? fileContext.map((file) => file.path) : likelyFilesFromPlan;
  const stepCount = countImplementationSteps(planBody);
  const riskTermCount = countRiskTerms(planBody);
  const missingFiles = fileContext.filter((file) => !file.exists).length;
  const largeFiles = fileContext.filter((file) => file.lineCount > 1000).length;
  const verificationCommandCount = input.context?.verificationCommands?.length ?? 0;
  const scanBudget = input.context?.scanBudget ?? {
    filesConsidered: likelyFiles.length,
    filesScanned: fileContext.filter((file) => file.exists).length,
    maxFiles: Math.max(likelyFiles.length, fileContext.length),
    exhausted: false,
  };
  const confidence = confidenceFor({
    likelyFiles,
    missingFiles,
    stepCount,
    riskTermCount,
    scanExhausted: scanBudget.exhausted,
  });

  const planTokens = Math.ceil(planBody.length / 4);
  const baseTokens =
    planTokens +
    Math.max(stepCount, 1) * 2500 +
    Math.max(likelyFiles.length, 1) * 900 +
    largeFiles * 2500 +
    missingFiles * 700 +
    riskTermCount * 1200 +
    Math.max(verificationCommandCount, 1) * 1800;

  const costSettings = input.costEstimates ?? DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS;
  const profiles = input.profiles.map((profile) => {
    const multiplier = profileMultiplier(profile);
    const range = {
      low: roundToThousand(baseTokens * multiplier * 0.75),
      high: roundToThousand(baseTokens * multiplier * (confidence === "low" ? 1.75 : 1.35)),
    };
    const costBasis = createCostBasis(profile, costSettings);
    const notes = [
      profile.name === input.implementerProfileName
        ? "Configured implementer profile."
        : "Comparison profile.",
      profile.model.toLowerCase().includes("mini")
        ? "Mini-class models may spend more turns on implementation/debug loops."
        : "Premium-class model estimate assumes fewer implementation/debug loops.",
    ];

    return {
      ...profile,
      range,
      costBasis,
      costRange: estimateCostRange(range, costBasis.blendedRatePerMillionTokens),
      confidence,
      notes,
    };
  });

  const implementerProfile = profiles.find(
    (profile) => profile.name === input.implementerProfileName
  );
  const recommendation = implementerProfile
    ? `Start with ${implementerProfile.name} (${implementerProfile.model}) unless the estimate drivers point to high-risk runtime, workflow, or command-surface work.`
    : "Use the configured implementer profile unless the estimate drivers point to high-risk runtime, workflow, or command-surface work.";

  const drivers = [
    `${stepCount || "No explicit"} implementation steps detected.`,
    `${likelyFiles.length} likely files detected.`,
    `${verificationCommandCount || 1} verification command group${
      (verificationCommandCount || 1) === 1 ? "" : "s"
    } considered.`,
    ...(largeFiles > 0 ? [`${pluralize(largeFiles, "large likely file")}.`] : []),
    ...(riskTermCount > 0
      ? [`${pluralize(riskTermCount, "risk signal")} in the plan.`]
      : []),
  ];
  const warnings = [
    ...(missingFiles > 0
      ? [
          `${pluralize(missingFiles, "likely file")} ${
            missingFiles === 1 ? "was" : "were"
          } not found locally.`,
        ]
      : []),
    ...(scanBudget.exhausted
      ? ["Repository context scan budget was exhausted; estimate confidence is reduced."]
      : []),
    ...(confidence === "low"
      ? ["Estimate confidence is low; refine or split the plan before relying on the range."]
      : []),
  ];

  return {
    status: "estimated",
    profiles,
    cost: {
      currency: costSettings.currency,
      inputTokenRatio: costSettings.inputTokenRatio,
      outputTokenRatio: costSettings.outputTokenRatio,
      explanation:
        `Approximate planning cost = tokens / 1,000,000 * blended model rate. Blended model rate = input rate * ${costSettings.inputTokenRatio} + output rate * ${costSettings.outputTokenRatio}.`,
    },
    drivers,
    warnings,
    recommendation,
    confidence,
    scanBudget: {
      status: scanBudget.exhausted ? "exhausted" : "complete",
      filesConsidered: scanBudget.filesConsidered,
      filesScanned: scanBudget.filesScanned,
      maxFiles: scanBudget.maxFiles,
    },
  };
}
