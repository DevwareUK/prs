import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterRepositoryPaths } from "../../core/src/path-filter";
import { DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS } from "../../core/src/repository-config";

const REPO_ROOT = resolve(__dirname, "../../..");
const ORIGINAL_ARGV = [...process.argv];
const cleanupTargets = new Set<string>();

function createTestBacklogAnalysis() {
  return {
    summary: "CLI and issue orchestration need direct integration coverage.",
    currentTestingSetup: {
      status: "partial" as const,
      hasTests: true,
      testFileCount: 4,
      frameworks: ["Vitest"],
      evidence: ["Vitest dependency in package.json"],
      testDirectories: ["packages/core/src", "packages/cli/src"],
      notes: ["CLI entrypoint coverage is still missing."],
      ciIntegration: {
        status: "partial" as const,
        hasGitHubActions: true,
        workflows: [".github/workflows/ci.yml"],
        evidence: ["GitHub Actions workflow runs pnpm test"],
        notes: ["Issue orchestration paths are not covered yet."],
      },
    },
    notableCoverageGaps: [
      "No integration coverage for git-ai issue prepare/finalize.",
      "No command-level coverage for test-backlog issue creation.",
    ],
    findings: [
      {
        id: "cli-issue-prepare",
        title: "Missing CLI integration coverage for issue prepare",
        priority: "high" as const,
        rationale: "Preparing issue runs creates downstream automation artifacts.",
        suggestedTestTypes: ["integration", "cli"] as const,
        relatedPaths: ["packages/cli/src/index.ts"],
        existingCoverage: "Argument parsing is covered, but command execution is not.",
        issueTitle: "Add CLI integration coverage for git-ai issue prepare",
        issueBody: "Exercise issue prepare against mocked git and GitHub boundaries.",
      },
      {
        id: "cli-test-backlog",
        title: "Missing CLI integration coverage for test-backlog output",
        priority: "high" as const,
        rationale: "The CLI needs stable output formatting and issue reuse behavior.",
        suggestedTestTypes: ["integration", "cli"] as const,
        relatedPaths: ["packages/cli/src/index.ts", "package.json"],
        existingCoverage: "Core backlog analysis is covered separately.",
        issueTitle: "Add CLI integration coverage for git-ai test-backlog",
        issueBody: "Verify JSON and markdown output plus duplicate issue reuse logic.",
      },
      {
        id: "cli-issue-finalize",
        title: "Missing failure coverage for issue finalize",
        priority: "medium" as const,
        rationale: "Finalize should fail clearly when Codex has not produced changes.",
        suggestedTestTypes: ["integration", "cli"] as const,
        relatedPaths: ["packages/cli/src/index.ts"],
        issueTitle: "Add failure coverage for git-ai issue finalize",
        issueBody: "Assert finalize surfaces incomplete run state clearly.",
      },
    ],
  };
}

function createFeatureBacklogAnalysis() {
  return {
    summary: "The product surface is growing faster than onboarding and release ergonomics.",
    repositorySignals: {
      hasCli: true,
      hasGitHubActions: true,
      hasTests: true,
      hasIssueTemplates: false,
      hasReleaseAutomation: false,
      hasExamples: false,
      packageCount: 5,
      workflowCount: 3,
      providerCount: 1,
      evidence: [
        "CLI entrypoint or CLI-oriented scripts detected in package.json",
        "3 GitHub Actions workflows detected",
      ],
      notes: [
        "No GitHub issue templates were detected.",
        "Only one concrete provider adapter appears to be implemented.",
      ],
    },
    notableOpportunities: [
      "Add guided issue templates for feature requests and bug reports (high)",
      "Add release automation and changelog publishing (high)",
    ],
    suggestions: [
      {
        id: "feedback-intake",
        title: "Add guided issue templates for feature requests and bug reports",
        category: "feedback" as const,
        priority: "high" as const,
        rationale: "Structured intake will turn raw feedback into actionable backlog items.",
        evidence: [
          "CLI entrypoint or CLI-oriented scripts detected in package.json",
          "No .github/ISSUE_TEMPLATE files were found",
        ],
        relatedPaths: [
          ".github/ISSUE_TEMPLATE/feature_request.md",
          ".github/ISSUE_TEMPLATE/bug_report.md",
        ],
        implementationHighlights: [
          "Add a feature request template.",
          "Add a bug report template.",
        ],
        acceptanceCriteria: [
          "GitHub shows structured issue templates.",
        ],
        issueTitle: "Add guided issue templates for feature requests and bug reports",
        issueBody: "Introduce feature request and bug report issue templates.",
      },
      {
        id: "release-automation",
        title: "Add release automation and changelog publishing",
        category: "automation" as const,
        priority: "high" as const,
        rationale: "Manual releases do not scale once the CLI is public.",
        evidence: [
          "5 package.json files detected",
          "No release automation signal was found in GitHub workflows or changeset metadata",
        ],
        relatedPaths: [".github/workflows/release.yml", ".changeset", "README.md"],
        implementationHighlights: [
          "Choose a release strategy.",
          "Generate changelog entries.",
        ],
        acceptanceCriteria: [
          "Releases can be cut from automation.",
        ],
        issueTitle: "Add release automation and changelog publishing",
        issueBody: "Automate releases and changelog generation.",
      },
    ],
  };
}

function createIssueDraftResult() {
  return {
    title: "Merge PR description and review summary into one PR assistant action",
    summary:
      "Draft a single implementation path for combining the repository's PR description and review summary generation flows.",
    motivation:
      "The current workflow spreads related pull request authoring guidance across separate outputs, which adds friction and inconsistency.",
    goal:
      "Provide one shared PR assistant action that produces a cohesive, implementation-ready pull request body update.",
    proposedBehavior: [
      "Generate one managed PR assistant output instead of separate PR description and review summary artifacts.",
      "Update the existing PR body in place rather than replacing unrelated user-authored sections.",
    ],
    requirements: [
      "Reuse the existing PR assistant and body-merging patterns where possible.",
      "Preserve manual pull request body content outside the managed section.",
    ],
    constraints: [
      "Do not overwrite non-managed PR body content.",
    ],
    acceptanceCriteria: [
      "Running the action updates a single managed PR assistant section.",
      "Existing non-managed PR body content is preserved.",
    ],
  };
}

function createIssueDraftGuidanceReadyResult() {
  return {
    status: "ready" as const,
    assistantSummary:
      "The issue is specific enough to draft with the current repository context.",
  };
}

function createIssueDraftGuidanceClarifyResult() {
  return {
    status: "clarify" as const,
    assistantSummary:
      "The rough idea is clear, but the workflow boundaries still need one concrete decision.",
    missingInformation: [
      "Whether the first version should update the existing issue markdown structure or introduce new sections.",
    ],
    questions: [
      "Should the guided flow keep the current markdown sections, or should it add sections like out of scope and technical considerations?",
    ],
  };
}

function createIssueResolutionPlanResult() {
  return {
    summary: "Create an editable plan comment and reuse it during issue runs.",
    implementationSteps: [
      "Generate a structured plan from the GitHub issue title and body.",
      "Post the plan as a managed comment that collaborators can edit.",
    ],
    validationSteps: [
      "Verify the plan comment is created on the issue.",
      "Ensure later issue runs load the edited plan into the issue snapshot.",
    ],
    risks: [
      "Regenerating the plan should not overwrite a manually edited comment by default.",
    ],
    openQuestions: [
      "Whether future flows should support explicit plan regeneration.",
    ],
  };
}

function createPRReviewResult() {
  return {
    summary:
      "The change largely matches the requested behavior, but one new branch still needs a guard.",
    findings: [
      {
        title: "Quick start still leaves setup and daily usage mixed together",
        severity: "medium" as const,
        category: "usability" as const,
        body: "The onboarding path is better, but a new user still has to infer which commands are one-time setup versus normal operation.",
        suggestion: "Split install/configuration from the first successful run in the README flow.",
        relatedPaths: ["README.md"],
      },
    ],
    comments: [
      {
        path: "packages/cli/src/index.ts",
        line: 412,
        severity: "high" as const,
        category: "correctness" as const,
        body: "This path assumes the issue number flag was populated and will blow up on malformed input.",
        suggestion: "Validate the flag before using it so the CLI fails with a clear error.",
      },
    ],
  };
}

function createFetchResponse(
  payload: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {}
): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function parseMockRepositoryConfig(value?: unknown): Record<string, unknown> {
  const config = (value ?? {}) as {
    ai?: {
      runtime?: { type?: unknown };
      provider?: {
        type?: unknown;
        model?: unknown;
        baseUrl?: unknown;
        region?: unknown;
      };
    };
    aiContext?: { excludePaths?: unknown };
    baseBranch?: unknown;
    buildCommand?: unknown;
    forge?: { type?: unknown };
  };

  if (config.ai?.runtime !== undefined) {
    if (
      typeof config.ai.runtime !== "object" ||
      config.ai.runtime === null ||
      (config.ai.runtime.type !== "codex" && config.ai.runtime.type !== "claude-code")
    ) {
      throw new Error("ai.runtime.type must be codex or claude-code");
    }
  }

  if (config.ai?.provider !== undefined) {
    if (typeof config.ai.provider !== "object" || config.ai.provider === null) {
      throw new Error("ai.provider must be an object");
    }

    if (
      config.ai.provider.type !== "openai" &&
      config.ai.provider.type !== "bedrock-claude"
    ) {
      throw new Error("ai.provider.type must be openai or bedrock-claude");
    }

    if (
      config.ai.provider.model !== undefined &&
      (typeof config.ai.provider.model !== "string" ||
        config.ai.provider.model.trim().length === 0)
    ) {
      throw new Error("ai.provider.model must be a non-empty string");
    }

    if (
      config.ai.provider.baseUrl !== undefined &&
      (typeof config.ai.provider.baseUrl !== "string" ||
        config.ai.provider.baseUrl.trim().length === 0)
    ) {
      throw new Error("ai.provider.baseUrl must be a non-empty string");
    }

    if (
      config.ai.provider.region !== undefined &&
      (typeof config.ai.provider.region !== "string" ||
        config.ai.provider.region.trim().length === 0)
    ) {
      throw new Error("ai.provider.region must be a non-empty string");
    }

    if (
      config.ai.provider.type === "bedrock-claude" &&
      (typeof config.ai.provider.model !== "string" ||
        config.ai.provider.model.trim().length === 0)
    ) {
      throw new Error("ai.provider.model is required for bedrock-claude");
    }
  }

  if (config.aiContext?.excludePaths !== undefined) {
    if (
      !Array.isArray(config.aiContext.excludePaths) ||
      config.aiContext.excludePaths.some(
        (pattern) => typeof pattern !== "string" || pattern.trim().length === 0
      )
    ) {
      throw new Error("aiContext.excludePaths must be a string array");
    }
  }

  if (config.baseBranch !== undefined) {
    if (typeof config.baseBranch !== "string" || config.baseBranch.trim().length === 0) {
      throw new Error("baseBranch must be a non-empty string");
    }
  }

  if (config.buildCommand !== undefined) {
    if (
      !Array.isArray(config.buildCommand) ||
      config.buildCommand.length === 0 ||
      config.buildCommand.some(
        (segment) => typeof segment !== "string" || segment.trim().length === 0
      )
    ) {
      throw new Error("buildCommand must be a non-empty string array");
    }
  }

  if (config.forge?.type !== undefined) {
    if (config.forge.type !== "github" && config.forge.type !== "none") {
      throw new Error("forge.type must be github or none");
    }
  }

  return config as Record<string, unknown>;
}

function captureStdout(): { output: () => string } {
  const chunks: string[] = [];

  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  return {
    output: () => chunks.join(""),
  };
}

function listIssueDraftFiles(): string[] {
  try {
    return readdirSync(resolve(REPO_ROOT, ".git-ai", "issues"))
      .filter((entry) => entry.startsWith("issue-draft-") && entry.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

function listRunDirectories(): string[] {
  try {
    return readdirSync(resolve(REPO_ROOT, ".git-ai", "runs")).sort();
  } catch {
    return [];
  }
}

function readIssueBatchState(issueNumbers: number[]): {
  key: string;
  latestRunDir: string;
  stoppedIssueNumber?: number;
  issues: Array<{
    issueNumber: number;
    status: string;
    runDir?: string;
    branchName?: string;
    prUrl?: string;
    error?: string;
    attempts: Array<{
      status: string;
      runDir?: string;
      branchName?: string;
      prUrl?: string;
      error?: string;
    }>;
  }>;
} {
  const statePath = resolve(
    REPO_ROOT,
    ".git-ai",
    "batches",
    `issues-${issueNumbers.join("-")}.json`
  );

  return JSON.parse(readFileSync(statePath, "utf8")) as {
    key: string;
    latestRunDir: string;
    stoppedIssueNumber?: number;
    issues: Array<{
      issueNumber: number;
      status: string;
      runDir?: string;
      branchName?: string;
      prUrl?: string;
      error?: string;
      attempts: Array<{
        status: string;
        runDir?: string;
        branchName?: string;
        prUrl?: string;
        error?: string;
      }>;
    }>;
  };
}

function readLatestRunMetadata(): {
  runDir: string;
  metadata: {
    draftFile?: string;
    promptFile?: string;
    outputLog?: string;
    runDir?: string;
  };
} {
  const runDir = [...listRunDirectories()]
    .reverse()
    .find((entry) =>
      existsSync(resolve(REPO_ROOT, ".git-ai", "runs", entry, "metadata.json"))
    );
  if (!runDir) {
    throw new Error("Expected a run directory.");
  }

  const metadataPath = resolve(REPO_ROOT, ".git-ai", "runs", runDir, "metadata.json");
  return {
    runDir,
    metadata: JSON.parse(readFileSync(metadataPath, "utf8")) as {
      draftFile?: string;
      promptFile?: string;
      outputLog?: string;
      runDir?: string;
    },
  };
}

function createMockCodexHome(): string {
  const codexHome = mkdtempSync(resolve(tmpdir(), "git-ai-codex-home-"));
  mkdirSync(resolve(codexHome, "sessions"), { recursive: true });
  cleanupTargets.add(codexHome);
  process.env.CODEX_HOME = codexHome;
  return codexHome;
}

function writeMockCodexSession(
  codexHome: string,
  sessionId: string,
  cwd: string,
  timestamp = "2026-04-01T09:00:00.000Z"
): string {
  const [datePart, timePartWithMillis] = timestamp.split("T");
  const [year, month, day] = datePart.split("-");
  const timePart = (timePartWithMillis ?? "00:00:00.000Z")
    .replace(/\.\d+Z$/, "")
    .replace(/:/g, "-");
  const sessionDir = resolve(codexHome, "sessions", year, month, day);
  const filePath = resolve(
    sessionDir,
    `rollout-${datePart}T${timePart}-${sessionId}.jsonl`
  );

  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify({
      timestamp,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp,
        cwd,
      },
    })}\n`,
    "utf8"
  );

  return filePath;
}

function withRepositoryConfig(
  contents: string,
  callback: () => Promise<void>
): Promise<void> {
  const configPath = resolve(REPO_ROOT, ".git-ai", "config.json");
  const hadOriginalConfig = existsSync(configPath);
  const originalConfig = hadOriginalConfig ? readFileSync(configPath, "utf8") : undefined;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, contents);

  return callback().finally(() => {
    if (hadOriginalConfig && originalConfig !== undefined) {
      writeFileSync(configPath, originalConfig);
    } else {
      rmSync(configPath, { force: true });
    }
  });
}

async function loadCli(options: {
  analysisResult?: ReturnType<typeof createTestBacklogAnalysis>;
  commitMessageResult?: { title: string; body?: string };
  diffSummaryResult?: { summary: string; filesChanged?: string[]; notableChanges?: string[] };
  featureAnalysisResult?: ReturnType<typeof createFeatureBacklogAnalysis>;
  issueDraftResult?: ReturnType<typeof createIssueDraftResult>;
  issueDraftGuidanceResults?: Array<
    ReturnType<typeof createIssueDraftGuidanceReadyResult> |
    ReturnType<typeof createIssueDraftGuidanceClarifyResult>
  >;
  issueResolutionPlanResult?: ReturnType<typeof createIssueResolutionPlanResult>;
  prAssistantResult?: {
    summary: string;
    keyChanges: string[];
    riskAreas: string[];
    reviewerFocus: string[];
  };
  prDescriptionResult?: {
    title: string;
    body: string;
    testingNotes?: string;
    riskNotes?: string;
  };
  prReviewResult?: ReturnType<typeof createPRReviewResult>;
  readlineAnswers?: string[];
  runtimeRepoRoot?: string;
  execFileSyncImpl?: (command: string, args: string[]) => string;
  spawnSyncImpl?: (
    command: string,
    args: string[],
    rawSecondArg?: unknown
  ) => { status: number; error?: Error; stdout?: string; stderr?: string };
} = {}) {
  vi.resetModules();
  process.env.GIT_AI_DISABLE_AUTO_RUN = "1";

  const analyzeFeatureBacklog = vi.fn();
  if (options.featureAnalysisResult) {
    analyzeFeatureBacklog.mockResolvedValue(options.featureAnalysisResult);
  }
  const analyzeTestBacklog = vi.fn();
  if (options.analysisResult) {
    analyzeTestBacklog.mockResolvedValue(options.analysisResult);
  }
  const generateIssueDraft = vi.fn();
  if (options.issueDraftResult) {
    generateIssueDraft.mockResolvedValue(options.issueDraftResult);
  }
  const generateIssueDraftGuidance = vi.fn();
  for (const result of options.issueDraftGuidanceResults ?? []) {
    generateIssueDraftGuidance.mockResolvedValueOnce(result);
  }
  const generateIssueResolutionPlan = vi.fn();
  if (options.issueResolutionPlanResult) {
    generateIssueResolutionPlan.mockResolvedValue(options.issueResolutionPlanResult);
  }
  const generateCommitMessage = vi.fn();
  generateCommitMessage.mockResolvedValue(
    options.commitMessageResult ?? {
      title: "feat: update generated changes",
    }
  );
  const generateDiffSummary = vi.fn();
  if (options.diffSummaryResult) {
    generateDiffSummary.mockResolvedValue(options.diffSummaryResult);
  }
  const generatePRAssistant = vi.fn();
  generatePRAssistant.mockResolvedValue(
    options.prAssistantResult ?? {
      summary: "Adds reviewer-ready PR assistant content to issue-created pull requests.",
      keyChanges: ["Generates a managed PR assistant section from the completed diff."],
      riskAreas: [],
      reviewerFocus: ["Confirm the generated PR body and assistant section match the diff."],
    }
  );
  const generatePRDescription = vi.fn();
  generatePRDescription.mockResolvedValue(
    options.prDescriptionResult ?? {
      title: "feat: improve issue workflow authoring",
      body: [
        "## Summary",
        "Generate commit and PR authoring from the completed issue diff.",
        "",
        "## Changes",
        "- Reuse the AI-backed commit message path for issue finalization.",
        "- Generate a reviewer-ready PR body before opening the pull request.",
        "",
        "## Testing",
        "- pnpm build",
      ].join("\n"),
    }
  );
  class StructuredGenerationError extends Error {
    readonly kind: "json_parse" | "schema_validation";
    readonly rawResponse: string;
    readonly parsedJson?: unknown;
    readonly normalizedJson?: unknown;
    readonly validationIssues?: Array<{
      path: string;
      message: string;
      code: string;
    }>;

    constructor(init: {
      kind: "json_parse" | "schema_validation";
      message: string;
      rawResponse: string;
      parsedJson?: unknown;
      normalizedJson?: unknown;
      validationIssues?: Array<{
        path: string;
        message: string;
        code: string;
      }>;
    }) {
      super(init.message);
      this.name = "StructuredGenerationError";
      this.kind = init.kind;
      this.rawResponse = init.rawResponse;
      this.parsedJson = init.parsedJson;
      this.normalizedJson = init.normalizedJson;
      this.validationIssues = init.validationIssues;
    }
  }
  const generatePRReview = vi.fn();
  if (options.prReviewResult) {
    generatePRReview.mockResolvedValue(options.prReviewResult);
  }
  const runtimeRepoRoot = options.runtimeRepoRoot ?? REPO_ROOT;

  const execFileSync = vi.fn((command: string, args: string[]) => {
    if (
      command === "git" &&
      args[0] === "-C" &&
      args[2] === "rev-parse" &&
      args[3] === "--show-toplevel"
    ) {
      return `${runtimeRepoRoot}\n`;
    }

    if (options.execFileSyncImpl) {
      if (command === "git" && args[0] === "-C") {
        return options.execFileSyncImpl(command, args.slice(2));
      }
      return options.execFileSyncImpl(command, args);
    }

    throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
  });
  const spawnSync = vi.fn((command: string, rawSecondArg?: unknown) => {
    const args = Array.isArray(rawSecondArg) ? rawSecondArg : [];
    if (options.spawnSyncImpl) {
      if (command === "git" && args[0] === "-C") {
        return options.spawnSyncImpl(command, args.slice(2), rawSecondArg);
      }
      return options.spawnSyncImpl(command, args, rawSecondArg);
    }

    return { status: 0 };
  });
  const readlineAnswers = [...(options.readlineAnswers ?? [])];
  const createInterface = vi.fn(() => ({
    question: vi.fn(async () => readlineAnswers.shift() ?? ""),
    close: vi.fn(),
  }));

  vi.doMock("@git-ai/core", async () => {
    const prAssistantBody = await import("../../core/src/pr-assistant-body");

    return {
    DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
    DEFAULT_REPOSITORY_BASE_BRANCH: "main",
    DEFAULT_REPOSITORY_BUILD_COMMAND: ["pnpm", "build"],
    analyzeFeatureBacklog,
    analyzeTestBacklog,
    buildPRAssistantSection: prAssistantBody.buildPRAssistantSection,
    filterRepositoryPaths,
    generateCommitMessage,
    generateDiffSummary,
    generateIssueDraft,
    generateIssueDraftGuidance,
    generatePRReview,
    generatePRAssistant,
    generatePRDescription,
    generateIssueResolutionPlan,
    mergePRAssistantSection: prAssistantBody.mergePRAssistantSection,
    PR_ASSISTANT_END_MARKER: prAssistantBody.PR_ASSISTANT_END_MARKER,
    PR_ASSISTANT_START_MARKER: prAssistantBody.PR_ASSISTANT_START_MARKER,
    StructuredGenerationError,
    stripManagedPRAssistantSection: prAssistantBody.stripManagedPRAssistantSection,
    resolveRepositoryConfig: vi.fn((config?: {
      ai?: {
        runtime?: { type?: "codex" | "claude-code" };
        provider?:
          | { type?: "openai"; model?: string; baseUrl?: string }
          | { type?: "bedrock-claude"; model?: string; region?: string };
      };
      aiContext?: { excludePaths?: string[] };
      baseBranch?: string;
      buildCommand?: string[];
      forge?: { type?: "github" | "none" };
    }) => ({
      ai: {
        runtime: config?.ai?.runtime ?? {
          type: "codex",
        },
        provider: config?.ai?.provider ?? {
          type: "openai",
        },
      },
      aiContext: {
        excludePaths: [
          ...new Set([
            ...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
            ...(config?.aiContext?.excludePaths ?? []),
          ]),
        ],
      },
      baseBranch: config?.baseBranch ?? "main",
      buildCommand: config?.buildCommand ?? ["pnpm", "build"],
      forge: {
        type: config?.forge?.type ?? "github",
      },
    })),
  };
  });
  vi.doMock("@git-ai/contracts", () => ({
    RepositoryConfig: {
      parse: vi.fn((value?: unknown) => parseMockRepositoryConfig(value)),
    },
  }));
  vi.doMock("@git-ai/providers", () => ({
    createProviderFromConfig: vi.fn(async (config: { type: string }, environment: {
      openaiApiKey?: string;
      openaiModel?: string;
      openaiBaseUrl?: string;
      awsRegion?: string;
      awsDefaultRegion?: string;
    }) => {
      if (config.type === "openai") {
        if (!environment.openaiApiKey) {
          throw new Error(
            "OpenAI provider requires OPENAI_API_KEY. Set it in your environment or in a .env file."
          );
        }

        return {
          providerType: "openai",
        };
      }

      const region = environment.awsRegion ?? environment.awsDefaultRegion;
      if (!("model" in config) || typeof config.model !== "string" || !config.model.trim()) {
        throw new Error(
          "Bedrock Claude provider requires an explicit model in `.git-ai/config.json` under `ai.provider.model`."
        );
      }

      if (!region && !("region" in config && typeof config.region === "string")) {
        throw new Error(
          "Bedrock Claude provider requires a region. Set `ai.provider.region`, `AWS_REGION`, or `AWS_DEFAULT_REGION`."
        );
      }

      if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
        throw new Error(
          "Bedrock Claude provider could not resolve AWS credentials using the standard AWS provider chain. credentials missing"
        );
      }

      return {
        providerType: "bedrock-claude",
      };
    }),
    readProviderEnvironment: vi.fn(() => ({
      openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
      openaiModel: process.env.OPENAI_MODEL?.trim() || undefined,
      openaiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || undefined,
      awsRegion: process.env.AWS_REGION?.trim() || undefined,
      awsDefaultRegion: process.env.AWS_DEFAULT_REGION?.trim() || undefined,
    })),
  }));
  vi.doMock("node:child_process", () => ({
    execFileSync,
    spawnSync,
  }));
  vi.doMock("node:readline/promises", () => ({
    createInterface,
  }));

  const module = await import("./index");

  return {
    readReviewDiffForAutomation: module.readReviewDiffForAutomation,
    run: module.run,
    parseFeatureBacklogCommandArgs: module.parseFeatureBacklogCommandArgs,
    parseIssueCommandArgs: module.parseIssueCommandArgs,
    parsePrCommandArgs: module.parsePrCommandArgs,
    parseReviewCommandArgs: module.parseReviewCommandArgs,
    parseSetupCommandArgs: module.parseSetupCommandArgs,
    analyzeFeatureBacklog,
    analyzeTestBacklog,
    generateCommitMessage,
    generateDiffSummary,
    generateIssueDraft,
    generateIssueDraftGuidance,
    generatePRAssistant,
    generatePRDescription,
    generatePRReview,
    generateIssueResolutionPlan,
    StructuredGenerationError,
    execFileSync,
    spawnSync,
    createInterface,
  };
}

afterEach(() => {
  process.argv = [...ORIGINAL_ARGV];
  delete process.env.GIT_AI_DISABLE_AUTO_RUN;
  delete process.env.GITHUB_OUTPUT;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.OPENAI_API_KEY;
  delete process.env.CODEX_HOME;

  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("CLI integration", () => {
  it("parses issue draft as a dedicated issue subcommand", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(parseIssueCommandArgs(["issue", "draft"])).toEqual({
      action: "draft",
    });
  });

  it("parses issue plan as a dedicated issue subcommand", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(parseIssueCommandArgs(["issue", "plan", "42"])).toEqual({
      action: "plan",
      issueNumber: 42,
      mode: "local",
    });
  });

  it("parses issue batch as an unattended issue subcommand", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(
      parseIssueCommandArgs(["issue", "batch", "123", "124", "--mode", "unattended"])
    ).toEqual({
      action: "batch",
      issueNumbers: [123, 124],
      mode: "unattended",
    });
  });

  it("rejects interactive batch issue mode", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(() =>
      parseIssueCommandArgs(["issue", "batch", "123", "124", "--mode", "interactive"])
    ).toThrow(
      "Batch issue runs only support `--mode unattended`. Interactive batch mode is not supported."
    );
  });

  it("parses pr fix-comments as a dedicated pr subcommand", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parsePrCommandArgs } = await loadCli();

    expect(parsePrCommandArgs(["pr", "fix-comments", "73"])).toEqual({
      action: "fix-comments",
      prNumber: 73,
    });
  });

  it("parses pr fix-tests as a dedicated pr subcommand", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parsePrCommandArgs } = await loadCli();

    expect(parsePrCommandArgs(["pr", "fix-tests", "74"])).toEqual({
      action: "fix-tests",
      prNumber: 74,
    });
  });

  it("parses pr prepare-review as a dedicated pr subcommand", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parsePrCommandArgs } = await loadCli();

    expect(parsePrCommandArgs(["pr", "prepare-review", "75"])).toEqual({
      action: "prepare-review",
      prNumber: 75,
    });
  });

  it("parses repo-level test-backlog flags for the CLI", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseTestBacklogCommandArgs } = await import("./index");

    const options = parseTestBacklogCommandArgs([
      "test-backlog",
      "--format",
      "json",
      "--top",
      "4",
      "--create-issues",
      "--max-issues",
      "8",
      "--label",
      "tests",
      "--labels",
      "cli, smoke",
      "--repo-root",
      "packages/core",
    ]);

    expect(options.format).toBe("json");
    expect(options.top).toBe(4);
    expect(options.createIssues).toBe(true);
    expect(options.maxIssues).toBe(4);
    expect(options.labels).toEqual(["tests", "cli", "smoke"]);
    expect(options.repoRoot).toMatch(/packages\/core$/);
  });

  it("parses feature-backlog flags with an explicit repository path", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseFeatureBacklogCommandArgs } = await loadCli();

    const options = parseFeatureBacklogCommandArgs([
      "feature-backlog",
      "packages/cli",
      "--format=json",
      "--top=4",
      "--create-issues",
      "--max-issues=9",
      "--label",
      "product",
      "--labels",
      "backlog, discovery",
    ]);

    expect(options.format).toBe("json");
    expect(options.top).toBe(4);
    expect(options.createIssues).toBe(true);
    expect(options.maxIssues).toBe(4);
    expect(options.labels).toEqual(["product", "backlog", "discovery"]);
    expect(options.repoRoot).toMatch(/packages\/cli$/);
  });

  it("parses review flags for local PR review", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseReviewCommandArgs } = await import("./index");

    const options = parseReviewCommandArgs([
      "review",
      "--base",
      "origin/main",
      "--head",
      "HEAD",
      "--format=json",
      "--issue-number",
      "50",
    ]);

    expect(options).toEqual({
      base: "origin/main",
      head: "HEAD",
      format: "json",
      issueNumber: 50,
    });
  });

  it("rejects unexpected setup arguments", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseSetupCommandArgs } = await loadCli();

    expect(() => parseSetupCommandArgs(["setup", "--force"])).toThrow(
      'Unknown setup option "--force". Usage:\n  git-ai setup'
    );
  });

  it("filters excluded paths from commit diffs", async () => {
    await withRepositoryConfig(
      JSON.stringify(
        {
          aiContext: {
            excludePaths: ["generated/**"],
          },
        },
        null,
        2
      ),
      async () => {
        const { run, execFileSync, generateCommitMessage } = await loadCli({
          commitMessageResult: {
            title: "feat: keep source diff only",
          },
          execFileSyncImpl: (command, args) => {
            if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
              return "src/index.ts\ngenerated/app.js\n";
            }

            if (
              command === "git" &&
              args[0] === "diff" &&
              args[1] === "--cached" &&
              args[2] === "--" &&
              args[3] === "src/index.ts"
            ) {
              return [
                "diff --git a/src/index.ts b/src/index.ts",
                "+++ b/src/index.ts",
                "@@ -0,0 +1 @@",
                "+export const value = 1;",
              ].join("\n");
            }

            throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
          },
        });

        process.env.OPENAI_API_KEY = "test-key";
        process.argv = ["node", "git-ai", "commit"];

        const stdout = captureStdout();
        await run();

        expect(execFileSync).toHaveBeenCalledWith(
          "git",
          ["-C", REPO_ROOT, "diff", "--name-only", "--cached"],
          expect.any(Object)
        );
        expect(execFileSync).toHaveBeenCalledWith(
          "git",
          ["-C", REPO_ROOT, "diff", "--cached", "--", "src/index.ts"],
          expect.any(Object)
        );
        expect(generateCommitMessage).toHaveBeenCalledWith(
          expect.any(Object),
          expect.stringContaining("src/index.ts")
        );
        expect(generateCommitMessage).toHaveBeenCalledWith(
          expect.any(Object),
          expect.not.stringContaining("generated/app.js")
        );
        expect(stdout.output()).toContain("feat: keep source diff only");
      }
    );
  });

  it("reads review diffs for automation with repo exclusions applied", async () => {
    await withRepositoryConfig(
      JSON.stringify(
        {
          aiContext: {
            excludePaths: ["generated/**"],
          },
        },
        null,
        2
      ),
      async () => {
        const { readReviewDiffForAutomation, execFileSync } = await loadCli({
          execFileSyncImpl: (command, args) => {
            if (
              command === "git" &&
              args[0] === "diff" &&
              args[1] === "--name-only" &&
              args[2] === "--unified=3" &&
              args[3] === "origin/main...HEAD"
            ) {
              return "src/index.ts\ngenerated/app.js\n";
            }

            if (
              command === "git" &&
              args[0] === "diff" &&
              args[1] === "--unified=3" &&
              args[2] === "origin/main...HEAD" &&
              args[3] === "--" &&
              args[4] === "src/index.ts"
            ) {
              return [
                "diff --git a/src/index.ts b/src/index.ts",
                "+++ b/src/index.ts",
                "@@ -0,0 +1 @@",
                "+export const value = 1;",
              ].join("\n");
            }

            throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
          },
        });

        const diff = readReviewDiffForAutomation("origin/main", "HEAD");

        expect(diff).toContain("src/index.ts");
        expect(diff).not.toContain("generated/app.js");
        expect(execFileSync).toHaveBeenCalledWith(
          "git",
          ["-C", REPO_ROOT, "diff", "--name-only", "--unified=3", "origin/main...HEAD"],
          expect.any(Object)
        );
      }
    );
  });

  it("runs test-backlog in JSON mode and reuses duplicate GitHub issues", async () => {
    const analysis = createTestBacklogAnalysis();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 41,
            title: analysis.findings[0].issueTitle,
            html_url: "https://github.com/DevwareUK/git-ai/issues/41",
          },
        ])
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 42,
          title: analysis.findings[1].issueTitle,
          html_url: "https://github.com/DevwareUK/git-ai/issues/42",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 43,
          title: analysis.findings[2].issueTitle,
          html_url: "https://github.com/DevwareUK/git-ai/issues/43",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, analyzeTestBacklog } = await loadCli({
      analysisResult: analysis,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = [
      "node",
      "git-ai",
      "test-backlog",
      "--format",
      "json",
      "--top",
      "3",
      "--create-issues",
      "--max-issues",
      "3",
      "--label",
      "tests",
    ];

    const stdout = captureStdout();
    await run();

    expect(analyzeTestBacklog).toHaveBeenCalledWith({
      excludePaths: [
        "**/node_modules/**",
        "**/vendor/**",
        "**/dist/**",
        "**/build/**",
        "*.map",
      ],
      repoRoot: REPO_ROOT,
      maxFindings: 3,
    });

    const output = JSON.parse(stdout.output()) as {
      findings: Array<{ issueTitle: string }>;
      createdIssues: Array<{ number: number; title: string; status: string }>;
    };

    expect(output.findings.map((finding) => finding.issueTitle)).toEqual(
      analysis.findings.map((finding) => finding.issueTitle)
    );
    expect(output.createdIssues).toEqual([
      {
        number: 41,
        title: analysis.findings[0].issueTitle,
        url: "https://github.com/DevwareUK/git-ai/issues/41",
        status: "existing",
      },
      {
        number: 42,
        title: analysis.findings[1].issueTitle,
        url: "https://github.com/DevwareUK/git-ai/issues/42",
        status: "created",
      },
      {
        number: 43,
        title: analysis.findings[2].issueTitle,
        url: "https://github.com/DevwareUK/git-ai/issues/43",
        status: "created",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("renders test-backlog markdown output", async () => {
    const analysis = createTestBacklogAnalysis();
    const { run, analyzeTestBacklog } = await loadCli({
      analysisResult: analysis,
    });

    process.argv = ["node", "git-ai", "test-backlog", "--top", "2"];

    const stdout = captureStdout();
    await run();

    expect(analyzeTestBacklog).toHaveBeenCalledWith({
      excludePaths: [
        "**/node_modules/**",
        "**/vendor/**",
        "**/dist/**",
        "**/build/**",
        "*.map",
      ],
      repoRoot: REPO_ROOT,
      maxFindings: 2,
    });
    expect(stdout.output()).toContain("# AI Test Backlog");
    expect(stdout.output()).toContain("## Summary");
    expect(stdout.output()).toContain("### Missing CLI integration coverage for issue prepare");
    expect(stdout.output()).toContain(
      "- Draft issue title: Add CLI integration coverage for git-ai issue prepare"
    );
  });

  it("runs review in markdown mode with linked issue context", async () => {
    const review = createPRReviewResult();
    const { run, generatePRReview } = await loadCli({
      prReviewResult: review,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "diff") {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -410,0 +412,1 @@",
            "+const issueNumber = rawValue;",
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Implement AI-Powered Pull Request Review Functionality",
          body: "Review pull requests line by line and use the linked issue as context.",
          html_url: "https://github.com/DevwareUK/git-ai/issues/50",
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "review", "--issue-number", "50"];

    const stdout = captureStdout();
    await run();

    expect(generatePRReview).toHaveBeenCalledWith(expect.any(Object), {
      diff: expect.stringContaining("packages/cli/src/index.ts"),
      issueNumber: 50,
      issueTitle: "Implement AI-Powered Pull Request Review Functionality",
      issueBody: "Review pull requests line by line and use the linked issue as context.",
      issueUrl: "https://github.com/DevwareUK/git-ai/issues/50",
    });
    expect(stdout.output()).toContain("# AI PR Review");
    expect(stdout.output()).toContain("## Higher-level findings");
    expect(stdout.output()).toContain("README.md");
    expect(stdout.output()).toContain("## Linked issue");
    expect(stdout.output()).toContain("packages/cli/src/index.ts:412");
  });

  it("fails pr prepare-review clearly when repository forge support is disabled", async () => {
    await withRepositoryConfig(
      JSON.stringify(
        {
          forge: {
            type: "none",
          },
        },
        null,
        2
      ),
      async () => {
        const { run } = await loadCli();

        process.argv = ["node", "git-ai", "pr", "prepare-review", "87"];

        await expect(run()).rejects.toThrow(
          "Repository forge support is disabled by .git-ai/config.json. Configure `forge.type` to enable pull request workflows."
        );
      }
    );
  });

  it("runs pr prepare-review, reuses the linked issue branch, and exits cleanly when follow-up makes no changes", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 211;
    const branchName = "feat/issue-211-review-setup";
    const sessionId = "019d9001-aaaa-7bbb-8ccc-ddddeeeeffff";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));

    writeMockCodexSession(codexHome, sessionId, REPO_ROOT, "2026-04-10T08:15:00.000Z");
    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      resolve(sessionStateDir, "session.json"),
      `${JSON.stringify(
        {
          issueNumber,
          runtimeType: "codex",
          branchName,
          issueDir: `.git-ai/issues/${issueNumber}-review-setup`,
          runDir: ".git-ai/runs/20260410T081500000Z-issue-211",
          promptFile: ".git-ai/runs/20260410T081500000Z-issue-211/prompt.md",
          outputLog: ".git-ai/runs/20260410T081500000Z-issue-211/output.log",
          sessionId,
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-10T08:15:00.000Z",
          updatedAt: "2026-04-10T08:15:00.000Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 87,
          title: "Prepare a review workspace",
          body: [
            "Fixes #211",
            "",
            "Set up a reviewer-ready local workspace for this pull request.",
            "",
            "<!-- git-ai:pr-assistant:start -->",
            "## PR Assistant",
            "",
            "### Summary",
            "Reuse linked issue state when available.",
            "",
            "### Reviewer focus",
            "- Confirm the saved branch and session are reused when safe.",
            "<!-- git-ai:pr-assistant:end -->",
          ].join("\n"),
          html_url: "https://github.com/DevwareUK/git-ai/pull/87",
          base: { ref: "main" },
          head: { ref: "feat/pr-review-workspace" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Add PR review workspace setup",
          body: "Reuse saved issue state when preparing a local PR review.",
          html_url: "https://github.com/DevwareUK/git-ai/issues/211",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync, generateCommitMessage } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === branchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") {
          return { status: 0, stdout: "base-tip-87\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-87" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "resume") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before Codex resume.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir, "review-brief.md"),
            [
              "# Review Brief",
              "",
              "## Reviewer Commands",
              "- `pnpm build`",
              "",
              "## Focus Areas",
              "- Confirm the linked issue branch and session were reused.",
            ].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "resume" && args[1] === sessionId) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "pr", "prepare-review", "87"];
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const promptFilePath = resolve(runDirPath, "prompt.md");
    const interactivePromptFilePath = resolve(runDirPath, "interactive-prompt.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    const reviewBriefPath = resolve(runDirPath, "review-brief.md");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "# Pull Request Review Preparation Snapshot"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "## Managed PR Assistant Section"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Reuse saved issue state when preparing a local PR review."
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "Write the final Markdown review brief"
    );
    expect(readFileSync(interactivePromptFilePath, "utf8")).toContain(
      "stay in this interactive session so the user can ask follow-up review questions or request fixes"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "do not modify tracked repository files"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain("pnpm build");
    expect(readFileSync(outputLogPath, "utf8")).toContain("# git-ai pr prepare-review run log");
    expect(readFileSync(outputLogPath, "utf8")).toContain("git fetch origin main");
    expect(readFileSync(outputLogPath, "utf8")).toContain(`git checkout ${branchName}`);
    expect(readFileSync(reviewBriefPath, "utf8")).toContain("## Reviewer Commands");
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Already contained the latest origin/main tip base-tip-87"
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      flow: "pr-prepare-review",
      prNumber: 87,
      checkout: {
        source: "issue-branch",
        branchName,
        linkedIssueNumber: 211,
      },
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-87",
        status: "up-to-date",
        conflictResolution: "not-needed",
      },
      runtime: {
        type: "codex",
        invocation: "resume",
        sessionId,
        linkedIssueNumber: 211,
        warnings: [],
      },
      linkedIssues: [
        {
          number: 211,
          savedBranch: branchName,
          savedRuntimeType: "codex",
          savedSessionId: sessionId,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "resume", "--full-auto", sessionId]),
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", sessionId, "--sandbox", "workspace-write"]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
    expect(messages.join("\n")).toContain(
      "Codex exited without producing any file changes to review or commit."
    );
    expect(generateCommitMessage).not.toHaveBeenCalled();
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "pnpm" ||
          (command === "git" &&
            Array.isArray(args) &&
            (args[0] === "commit" || args[0] === "push"))
      )
    ).toBe(false);
  });

  it("falls back to a fresh Codex run when the linked issue session is stale", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 212;
    const branchName = "feat/issue-212-review-setup";
    const staleSessionId = "019d9002-0000-7111-8222-933344445555";
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));

    createMockCodexHome();
    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      resolve(sessionStateDir, "session.json"),
      `${JSON.stringify(
        {
          issueNumber,
          runtimeType: "codex",
          branchName,
          issueDir: `.git-ai/issues/${issueNumber}-review-setup`,
          runDir: ".git-ai/runs/20260410T091500000Z-issue-212",
          promptFile: ".git-ai/runs/20260410T091500000Z-issue-212/prompt.md",
          outputLog: ".git-ai/runs/20260410T091500000Z-issue-212/output.log",
          sessionId: staleSessionId,
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-10T09:15:00.000Z",
          updatedAt: "2026-04-10T09:15:00.000Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 88,
          title: "Prepare another review workspace",
          body: "Fixes #212\n\nRegenerate the reviewer brief when the old session is gone.",
          html_url: "https://github.com/DevwareUK/git-ai/pull/88",
          base: { ref: "main" },
          head: { ref: "feat/pr-review-workspace-stale" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Handle stale saved Codex sessions",
          body: "Warn and fall back instead of failing the reviewer workflow.",
          html_url: "https://github.com/DevwareUK/git-ai/issues/212",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === branchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") {
          return { status: 0, stdout: "base-tip-88\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-88" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir, "review-brief.md"),
            [
              "# Review Brief",
              "",
              "## Reviewer Commands",
              "- `pnpm build`",
            ].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "pr", "prepare-review", "88"];

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const interactivePromptFilePath = resolve(runDirPath, "interactive-prompt.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain("## Runtime Warnings");
    expect(readFileSync(interactivePromptFilePath, "utf8")).toContain(
      "Read the generated review brief"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      `Warning: Saved Codex session ${staleSessionId} for linked issue #212 is no longer available. Falling back to a fresh review brief generation run.`
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Already contained the latest origin/main tip base-tip-88"
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      checkout: {
        source: "issue-branch",
        branchName,
        linkedIssueNumber: 212,
      },
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-88",
        status: "up-to-date",
        conflictResolution: "not-needed",
      },
      runtime: {
        invocation: "new",
        linkedIssueNumber: 212,
        warnings: [
          `Saved Codex session ${staleSessionId} for linked issue #212 is no longer available. Falling back to a fresh review brief generation run.`,
        ],
      },
    });
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "resume", "--full-auto", staleSessionId]),
      expect.any(Object)
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "--full-auto", "--cd", REPO_ROOT]),
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--cd",
        REPO_ROOT,
      ]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
  });

  it("runs pr prepare-review follow-up fixes through build verification and reviewed commit flow", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-follow-up";
    let gitStatusCallCount = 0;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 206,
        title: "Tighten prepare-review follow-up fixes",
        body: "Keep the reviewer workflow open for follow-up fixes and commit review.",
        html_url: "https://github.com/DevwareUK/git-ai/pull/206",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPENAI_API_KEY = "test-key";
    const { run, spawnSync, generateCommitMessage } = await loadCli({
      commitMessageResult: {
        title: "fix: review follow-up fixes for PR #206",
        body: "Generated after the interactive prepare-review session.",
      },
      readlineAnswers: ["y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1
            ? ""
            : " M packages/cli/src/workflows/pr-prepare-review/run.ts\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/workflows/pr-prepare-review/run.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/workflows/pr-prepare-review/run.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/workflows/pr-prepare-review/run.ts b/packages/cli/src/workflows/pr-prepare-review/run.ts",
            "--- a/packages/cli/src/workflows/pr-prepare-review/run.ts",
            "+++ b/packages/cli/src/workflows/pr-prepare-review/run.ts",
            "@@ -1,1 +1,2 @@",
            '-console.log(\"before\");',
            '+console.log(\"after\");',
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") {
          return { status: 0, stdout: "base-tip-206\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-206" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir, "review-brief.md"),
            ["# Review Brief", "", "## Reviewer Commands", "- `pnpm build`"].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "build ok\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === `origin/${headBranchName}`) {
          return { status: 0, stdout: "head-tip-206\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === `origin/${headBranchName}...HEAD`
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === `HEAD:${headBranchName}`
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "pr", "prepare-review", "206"];
    const stdout = captureStdout();
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string);
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    const commitCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "commit"
    );
    expect(commitCall).toBeDefined();
    const commitArgs = commitCall?.[1] as string[];
    expect(commitArgs).toEqual(["commit", "-F", expect.stringContaining("commit-message.txt")]);
    expect(readFileSync(commitArgs[2], "utf8")).toContain(
      "fix: review follow-up fixes for PR #206"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain("$ pnpm build");
    expect(readFileSync(outputLogPath, "utf8")).toContain(`$ git push origin HEAD:${headBranchName}`);
    expect(stdout.output()).toContain("Proposed commit message");
    expect(messages.join("\n")).toContain(
      `Pushing reviewed updates to origin/${headBranchName}...`
    );
    expect(generateCommitMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining(
        "diff --git a/packages/cli/src/workflows/pr-prepare-review/run.ts b/packages/cli/src/workflows/pr-prepare-review/run.ts"
      )
    );
  });

  it("leaves pr prepare-review follow-up changes uncommitted when the reviewed message is declined", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-skip-commit";
    let gitStatusCallCount = 0;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 207,
        title: "Skip prepare-review follow-up commit",
        body: "Offer commit review after the follow-up session.",
        html_url: "https://github.com/DevwareUK/git-ai/pull/207",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPENAI_API_KEY = "test-key";
    const { run, spawnSync } = await loadCli({
      commitMessageResult: {
        title: "fix: stage follow-up prepare-review changes",
      },
      readlineAnswers: ["n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M README.md\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "README.md\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "README.md"
        ) {
          return [
            "diff --git a/README.md b/README.md",
            "--- a/README.md",
            "+++ b/README.md",
            "@@ -1,1 +1,2 @@",
            "-old",
            "+new",
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") {
          return { status: 0, stdout: "base-tip-207\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-207" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir, "review-brief.md"),
            ["# Review Brief", "", "## Reviewer Commands", "- `pnpm build`"].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "build ok\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "head-tip-88\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === "origin/feat/pr-fix-comments...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === "HEAD:feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "pr", "prepare-review", "207"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    expect(messages.join("\n")).toContain("Leaving the generated changes uncommitted.");
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          args[0] === "commit"
      )
    ).toBe(false);
  });

  it("stops pr prepare-review before commit review when the follow-up build fails", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-build-failure";
    let gitStatusCallCount = 0;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 208,
        title: "Fail prepare-review follow-up build",
        body: "Build verification must stop before commit creation.",
        html_url: "https://github.com/DevwareUK/git-ai/pull/208",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync, generateCommitMessage } = await loadCli({
      readlineAnswers: ["y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M README.md\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") {
          return { status: 0, stdout: "base-tip-208\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-208" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir, "review-brief.md"),
            ["# Review Brief", "", "## Reviewer Commands", "- `pnpm build`"].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 1, stdout: "", stderr: "build failed\n" };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "head-tip-88\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === "origin/feat/pr-fix-comments...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === "HEAD:feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "pr", "prepare-review", "208"];

    await expect(run()).rejects.toThrow("Build failed. Changes were not committed.");
    expect(generateCommitMessage).not.toHaveBeenCalled();
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          (args[0] === "commit" || args[0] === "push")
      )
    ).toBe(false);
  });

  it("fetches a dedicated local review branch and merges the latest base branch when no saved issue state or local head branch exists", async () => {
    const beforeRuns = listRunDirectories();
    const reviewBranchName = "review/pr-205-prepare-a-review-workspace";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 205,
        title: "Prepare a review workspace",
        body: "Generate a local reviewer brief for this pull request.",
        html_url: "https://github.com/DevwareUK/git-ai/pull/205",
        base: { ref: "main" },
        head: { ref: "feat/prepare-review-workspace" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") {
          return { status: 0, stdout: "base-tip-205\n", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
          return { status: 1, error: new Error("missing") };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === `pull/205/head:${reviewBranchName}`
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === reviewBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-205" &&
          args[3] === "HEAD"
        ) {
          return { status: 1, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge" &&
          args[1] === "--no-edit" &&
          args[2] === "--no-ff" &&
          args[3] === "origin/main"
        ) {
          return { status: 0, stdout: "Merge made by the 'ort' strategy.\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir, "review-brief.md"),
            [
              "# Review Brief",
              "",
              "## Reviewer Commands",
              "- `pnpm build`",
              "",
              "## Focus Areas",
              "- Review the fetched branch diff against `main`.",
            ].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "feat/prepare-review-workspace"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/prepare-review-workspace"
        ) {
          return { status: 0, stdout: "head-tip-205\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === "origin/feat/prepare-review-workspace...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === "HEAD:feat/prepare-review-workspace"
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "pr", "prepare-review", "205"];
    const stdout = captureStdout();
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const interactivePromptFilePath = resolve(runDirPath, "interactive-prompt.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Fetched PR head into dedicated local review branch"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      'Merged the latest origin/main tip base-tip-205 into the checked-out branch'
    );
    expect(readFileSync(interactivePromptFilePath, "utf8")).toContain(
      "Remain available for follow-up questions and requested fixes"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      `git fetch origin pull/205/head:${reviewBranchName}`
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      `git checkout ${reviewBranchName}`
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain("git fetch origin main");
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      "git merge --no-edit --no-ff origin/main"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      "git push origin HEAD:feat/prepare-review-workspace"
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      prNumber: 205,
      checkout: {
        source: "fetched-review",
        branchName: reviewBranchName,
        headRefName: "feat/prepare-review-workspace",
      },
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-205",
        status: "merged",
        conflictResolution: "not-needed",
      },
      runtime: {
        invocation: "new",
        warnings: [],
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin", `pull/205/head:${reviewBranchName}`],
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["merge", "--no-edit", "--no-ff", "origin/main"],
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:feat/prepare-review-workspace"],
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
    expect(messages.join("\n")).toContain(
      "Pushing reviewed updates to origin/feat/prepare-review-workspace..."
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--cd",
        REPO_ROOT,
      ]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
  });

  it("resolves base-branch merge conflicts before generating the review brief", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-conflicts-resolved";
    let mergeBaseCallCount = 0;
    let mergeHeadCheckCount = 0;
    let unmergedPathsCheckCount = 0;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 209,
        title: "Resolve prepare-review merge conflicts",
        body: "Sync the reviewer branch with main before brief generation.",
        html_url: "https://github.com/DevwareUK/git-ai/pull/209",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") {
          return { status: 0, stdout: "base-tip-209\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-209" &&
          args[3] === "HEAD"
        ) {
          mergeBaseCallCount += 1;
          return { status: mergeBaseCallCount === 1 ? 1 : 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge" &&
          args[1] === "--no-edit" &&
          args[2] === "--no-ff" &&
          args[3] === "origin/main"
        ) {
          return {
            status: 1,
            stdout: "Auto-merging README.md\n",
            stderr: "CONFLICT (content): Merge conflict in README.md\n",
          };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "-q" &&
          args[2] === "--verify" &&
          args[3] === "MERGE_HEAD"
        ) {
          mergeHeadCheckCount += 1;
          return {
            status: mergeHeadCheckCount === 1 ? 0 : 1,
            stdout: mergeHeadCheckCount === 1 ? "merge-head\n" : "",
            stderr: "",
          };
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "--name-only" &&
          args[2] === "--diff-filter=U"
        ) {
          unmergedPathsCheckCount += 1;
          return {
            status: 0,
            stdout: unmergedPathsCheckCount === 1 ? "README.md\n" : "",
            stderr: "",
          };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === headBranchName
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === `origin/${headBranchName}`
        ) {
          return { status: 0, stdout: "head-tip-209\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === `origin/${headBranchName}...HEAD`
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === `HEAD:${headBranchName}`
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "exec" && args[1] === "--full-auto") {
          const createdRunDir = listRunDirectories().find(
            (entry) => !beforeRuns.includes(entry)
          );
          if (!createdRunDir) {
            throw new Error("Expected a prepare-review run directory before fresh Codex run.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir, "review-brief.md"),
            [
              "# Review Brief",
              "",
              "## Reviewer Commands",
              "- `pnpm build`",
              "",
              "## Focus Areas",
              "- Inspect the conflict resolution and merged base branch changes.",
            ].join("\n"),
            "utf8"
          );

          return { status: 0, stdout: "brief generated\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "pr", "prepare-review", "209"];

    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string);
    const conflictPromptFilePath = resolve(runDirPath, "base-sync-conflict-prompt.md");
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(conflictPromptFilePath, "utf8")).toContain(
      "Resolve the merge conflicts created while merging `origin/main`"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "after Codex resolved merge conflicts"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      'Warning: Merging origin/main into "feat/prepare-review-conflicts-resolved" produced conflicts.'
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      'Warning: Codex resolved the merge conflicts while merging origin/main into "feat/prepare-review-conflicts-resolved".'
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      `git push origin HEAD:${headBranchName}`
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-209",
        status: "merged",
        conflictResolution: "required",
      },
    });
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "codex" &&
          Array.isArray(args) &&
          args[0] === "--sandbox" &&
          args.some(
            (value) =>
              typeof value === "string" && value.includes("base-sync-conflict-prompt.md")
          )
      )
    ).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", `HEAD:${headBranchName}`],
      expect.objectContaining({
        cwd: REPO_ROOT,
      })
    );
  });

  it("fails clearly when base-branch merge conflicts remain unresolved", async () => {
    const beforeRuns = listRunDirectories();
    const headBranchName = "feat/prepare-review-conflicts-unresolved";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 210,
        title: "Fail unresolved prepare-review merge conflicts",
        body: "Stop review preparation until the base-branch merge is clean.",
        html_url: "https://github.com/DevwareUK/git-ai/pull/210",
        base: { ref: "main" },
        head: { ref: headBranchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse" && args[2] === headBranchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === headBranchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "rev-parse" && args[1] === "origin/main") {
          return { status: 0, stdout: "base-tip-210\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-210" &&
          args[3] === "HEAD"
        ) {
          return { status: 1, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge" &&
          args[1] === "--no-edit" &&
          args[2] === "--no-ff" &&
          args[3] === "origin/main"
        ) {
          return {
            status: 1,
            stdout: "Auto-merging README.md\n",
            stderr: "CONFLICT (content): Merge conflict in README.md\n",
          };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "-q" &&
          args[2] === "--verify" &&
          args[3] === "MERGE_HEAD"
        ) {
          return { status: 0, stdout: "merge-head\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "--name-only" &&
          args[2] === "--diff-filter=U"
        ) {
          return { status: 0, stdout: "README.md\n", stderr: "" };
        }

        if (command === "codex" && args[0] === "--sandbox") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "pr", "prepare-review", "210"];

    await expect(run()).rejects.toThrow(
      'Base-branch sync is still incomplete for "feat/prepare-review-conflicts-unresolved".'
    );

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-prepare.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain("## Base Branch Sync Recovery");
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      'Warning: Base-branch sync is still incomplete for "feat/prepare-review-conflicts-unresolved".'
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      baseSync: {
        remoteRef: "origin/main",
        baseTip: "base-tip-210",
        status: "blocked",
        conflictResolution: "unresolved",
      },
    });
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "--full-auto", "--cd", REPO_ROOT]),
      expect.any(Object)
    );
  });

  it("runs pr fix-comments, writes run artifacts, verifies the build, and commits the result", async () => {
    const beforeRuns = listRunDirectories();
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 88,
          title: "Tighten PR review comment fixing flow",
          body: "Apply selected review feedback with Codex and keep the workflow auditable.",
          html_url: "https://github.com/DevwareUK/git-ai/pull/88",
          base: { ref: "main" },
          head: { ref: "feat/pr-fix-comments" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 501,
            body: "Guard against an empty comment selection before starting Codex.",
            path: "packages/cli/src/index.ts",
            line: 1900,
            side: "RIGHT",
            diff_hunk: "@@ -1890,0 +1900,4 @@",
            html_url:
              "https://github.com/DevwareUK/git-ai/pull/88#discussion_r501",
            user: { login: "reviewer-a" },
            created_at: "2026-03-18T08:00:00Z",
            updated_at: "2026-03-18T08:05:00Z",
          },
          {
            id: 502,
            body: "Thanks!",
            path: "packages/cli/src/index.ts",
            line: 1904,
            side: "RIGHT",
            html_url:
              "https://github.com/DevwareUK/git-ai/pull/88#discussion_r502",
            user: { login: "reviewer-b" },
            created_at: "2026-03-18T08:06:00Z",
            updated_at: "2026-03-18T08:06:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["all", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "head-tip-88\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === "origin/feat/pr-fix-comments...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === "HEAD:feat/pr-fix-comments"
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "pr", "fix-comments", "88"];

    await run();

    const createdRun = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRun).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRun as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-comments.md");
    const promptFilePath = resolve(runDirPath, "prompt.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain("# Pull Request Review Fix Snapshot");
    expect(readFileSync(snapshotFilePath, "utf8")).toContain("Guard against an empty comment selection");
    expect(readFileSync(snapshotFilePath, "utf8")).not.toContain("Thanks!");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "Read the pull request review fix snapshot"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain("keep code changes focused");
    expect(readFileSync(promptFilePath, "utf8")).toContain("✅ Implementation complete");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "continue by giving further instruction or type `/exit`"
    );
    expect(readFileSync(promptFilePath, "utf8")).not.toContain("[2] Commit changes");
    expect(readFileSync(promptFilePath, "utf8")).not.toContain("/commit");
    expect(readFileSync(outputLogPath, "utf8")).toContain("# git-ai pr fix-comments run log");
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      "$ git fetch origin feat/pr-fix-comments"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      "$ git push origin HEAD:feat/pr-fix-comments"
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      prNumber: 88,
      prTitle: "Tighten PR review comment fixing flow",
      baseRefName: "main",
      headRefName: "feat/pr-fix-comments",
      selectedComments: [
        {
          id: 501,
          path: "packages/cli/src/index.ts",
          line: 1900,
          url: "https://github.com/DevwareUK/git-ai/pull/88#discussion_r501",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-F", expect.stringContaining("commit-message.txt")],
      expect.any(Object)
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:feat/pr-fix-comments"],
      expect.any(Object)
    );
  });

  it("groups nearby PR review threads, keeps reply context, and snapshots linked issue details", async () => {
    const beforeRuns = listRunDirectories();
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 66,
          title: "Improve fix-comments task handoff",
          body: "Closes #42\n\nImprove the prompt quality for Codex handoff.",
          html_url: "https://github.com/DevwareUK/git-ai/pull/66",
          base: { ref: "main" },
          head: { ref: "feat/fix-comment-task-handoff" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Improve PR comment selection and context quality",
          body: "Make the review-fix snapshot more coherent for Codex.",
          html_url: "https://github.com/DevwareUK/git-ai/issues/42",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 701,
            body: "Group nearby review comments into one selectable task.",
            path: "packages/cli/src/index.ts",
            line: 1200,
            side: "RIGHT",
            diff_hunk: "@@ -1196,0 +1200,4 @@",
            html_url:
              "https://github.com/DevwareUK/git-ai/pull/66#discussion_r701",
            user: { login: "reviewer-a" },
            created_at: "2026-03-18T08:00:00Z",
            updated_at: "2026-03-18T08:05:00Z",
          },
          {
            id: 702,
            body: "The replies here explain that `all` should still mean every individual thread.",
            path: "packages/cli/src/index.ts",
            line: 1200,
            side: "RIGHT",
            diff_hunk: "@@ -1196,0 +1200,4 @@",
            html_url:
              "https://github.com/DevwareUK/git-ai/pull/66#discussion_r702",
            user: { login: "reviewer-b" },
            created_at: "2026-03-18T08:06:00Z",
            updated_at: "2026-03-18T08:08:00Z",
            in_reply_to_id: 701,
          },
          {
            id: 703,
            body: "Include the local file excerpt in the Codex snapshot for nearby comments.",
            path: "packages/cli/src/index.ts",
            line: 1208,
            side: "RIGHT",
            diff_hunk: "@@ -1204,0 +1208,4 @@",
            html_url:
              "https://github.com/DevwareUK/git-ai/pull/66#discussion_r703",
            user: { login: "reviewer-c" },
            created_at: "2026-03-18T08:09:00Z",
            updated_at: "2026-03-18T08:10:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      readlineAnswers: ["g1", "n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "pr", "fix-comments", "66"];

    await run();

    const createdRun = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRun).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRun as string);
    const snapshotFilePath = resolve(runDirPath, "pr-review-comments.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    cleanupTargets.add(runDirPath);

    const snapshot = readFileSync(snapshotFilePath, "utf8");
    expect(snapshot).toContain("## Linked issues");
    expect(snapshot).toContain("Issue #42: Improve PR comment selection and context quality");
    expect(snapshot).toContain("### Task 1");
    expect(snapshot).toContain("Selection type: Grouped review task");
    expect(snapshot).toContain("reviewer-b (2026-03-18T08:08:00Z)");
    expect(snapshot).toContain("##### Local file excerpt");

    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      prNumber: 66,
      linkedIssues: [
        {
          number: 42,
          title: "Improve PR comment selection and context quality",
          url: "https://github.com/DevwareUK/git-ai/issues/42",
        },
      ],
      selectedTasks: [
        {
          kind: "group",
          path: "packages/cli/src/index.ts",
          commentIds: [701, 702, 703],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("runs pr fix-tests, writes run artifacts, verifies the build, and commits the result", async () => {
    const beforeRuns = listRunDirectories();
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 91,
          title: "Close the AI test suggestions implementation loop",
          body: "Apply selected AI-generated test suggestions with Codex.",
          html_url: "https://github.com/DevwareUK/git-ai/pull/91",
          base: { ref: "main" },
          head: { ref: "feat/pr-fix-tests" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 801,
            body: [
              "<!-- git-ai-test-suggestions -->",
              "## AI Test Suggestions",
              "",
              "### Overview",
              "The PR changes the CLI flow and needs focused integration coverage.",
              "",
              "### Suggested test areas",
              "",
              "#### Verify prompt generation for selected test suggestions",
              "- Priority: High",
              "- Why it matters: The Codex handoff should preserve the selected test context.",
              "- Likely locations: `packages/cli/src/index.test.ts`, `packages/cli/src/workflows/pr-fix-tests/workspace.ts`",
              "",
              "#### Verify managed comment parsing failure cases",
              "- Priority: Medium",
              "- Why it matters: The command should fail clearly when the managed comment is malformed.",
              "- Likely locations: `packages/cli/src/index.test.ts`",
              "",
              "### Edge cases",
              "- The marker exists but the suggested test areas section is missing.",
              "",
              "### Likely places to add tests",
              "- `packages/cli/src/index.test.ts`",
            ].join("\n"),
            html_url: "https://github.com/DevwareUK/git-ai/issues/91#issuecomment-801",
            updated_at: "2026-03-19T10:00:00Z",
            user: { login: "github-actions[bot]", type: "Bot" },
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["2", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.test.ts\n";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (
          command === "git" &&
          args[0] === "fetch" &&
          args[1] === "origin" &&
          args[2] === "feat/pr-fix-tests"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "origin/feat/pr-fix-tests"
        ) {
          return { status: 0, stdout: "head-tip-91\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right" &&
          args[2] === "--count" &&
          args[3] === "origin/feat/pr-fix-tests...HEAD"
        ) {
          return { status: 0, stdout: "0 1\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "push" &&
          args[1] === "origin" &&
          args[2] === "HEAD:feat/pr-fix-tests"
        ) {
          return { status: 0, stdout: "pushed\n", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "pr", "fix-tests", "91"];

    await run();

    const createdRun = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRun).toBeDefined();

    const runDirPath = resolve(REPO_ROOT, ".git-ai", "runs", createdRun as string);
    const snapshotFilePath = resolve(runDirPath, "pr-test-suggestions.md");
    const promptFilePath = resolve(runDirPath, "prompt.md");
    const metadataFilePath = resolve(runDirPath, "metadata.json");
    const outputLogPath = resolve(runDirPath, "output.log");
    cleanupTargets.add(runDirPath);

    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "# Pull Request Test Suggestions Fix Snapshot"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).toContain(
      "Suggestion 1: Verify managed comment parsing failure cases"
    );
    expect(readFileSync(snapshotFilePath, "utf8")).not.toContain(
      "Verify prompt generation for selected test suggestions"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "Read the pull request test suggestions fix snapshot"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "implementing automated tests for the selected areas"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain("✅ Implementation complete");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "continue by giving further instruction or type `/exit`"
    );
    expect(readFileSync(promptFilePath, "utf8")).not.toContain("[2] Commit changes");
    expect(readFileSync(promptFilePath, "utf8")).not.toContain("/commit");
    expect(readFileSync(outputLogPath, "utf8")).toContain("# git-ai pr fix-tests run log");
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      "$ git fetch origin feat/pr-fix-tests"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain(
      "$ git push origin HEAD:feat/pr-fix-tests"
    );
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      prNumber: 91,
      prTitle: "Close the AI test suggestions implementation loop",
      sourceComment: {
        id: 801,
        url: "https://github.com/DevwareUK/git-ai/issues/91#issuecomment-801",
      },
      selectedSuggestions: [
        {
          area: "Verify managed comment parsing failure cases",
          priority: "medium",
          likelyLocations: ["packages/cli/src/index.test.ts"],
        },
      ],
      edgeCases: ["The marker exists but the suggested test areas section is missing."],
      likelyLocations: ["packages/cli/src/index.test.ts"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-F", expect.stringContaining("commit-message.txt")],
      expect.any(Object)
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["push", "origin", "HEAD:feat/pr-fix-tests"],
      expect.any(Object)
    );
  });

  it("exits pr fix-tests cleanly when no test suggestions are selected", async () => {
    const beforeRuns = listRunDirectories();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 94,
          title: "Allow skipping selected AI test suggestions",
          body: "",
          html_url: "https://github.com/DevwareUK/git-ai/pull/94",
          base: { ref: "main" },
          head: { ref: "feat/skip-test-suggestions" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 804,
            body: [
              "<!-- git-ai-test-suggestions -->",
              "## AI Test Suggestions",
              "",
              "### Suggested test areas",
              "",
              "#### Verify selection can exit without changes",
              "- Priority: Medium",
              "- Why it matters: Users should be able to back out cleanly.",
            ].join("\n"),
            html_url: "https://github.com/DevwareUK/git-ai/issues/94#issuecomment-804",
            updated_at: "2026-03-19T11:30:00Z",
            user: { login: "github-actions[bot]", type: "Bot" },
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["none"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "pr", "fix-tests", "94"];

    await run();

    expect(listRunDirectories()).toEqual(beforeRuns);
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.any(Array),
      expect.any(Object)
    );
    expect(spawnSync).not.toHaveBeenCalledWith(
      "pnpm",
      ["build"],
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails pr fix-tests clearly when no managed AI test suggestions comment exists", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 92,
          title: "No managed AI test suggestions comment",
          body: "",
          html_url: "https://github.com/DevwareUK/git-ai/pull/92",
          base: { ref: "main" },
          head: { ref: "feat/no-managed-test-comment" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 802,
            body: "Human discussion without the managed marker.",
            html_url: "https://github.com/DevwareUK/git-ai/issues/92#issuecomment-802",
            updated_at: "2026-03-19T10:30:00Z",
            user: { login: "reviewer-a", type: "User" },
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "pr", "fix-tests", "92"];

    await expect(run()).rejects.toThrow(
      "No managed AI test suggestions comment was found for PR #92."
    );
  });

  it("fails pr fix-tests clearly when the managed AI test suggestions comment cannot be parsed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 93,
          title: "Malformed managed AI test suggestions comment",
          body: "",
          html_url: "https://github.com/DevwareUK/git-ai/pull/93",
          base: { ref: "main" },
          head: { ref: "feat/malformed-managed-test-comment" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 803,
            body: [
              "<!-- git-ai-test-suggestions -->",
              "## AI Test Suggestions",
              "",
              "### Suggested test areas",
              "",
              "#### Missing Why Field",
              "- Priority: High",
            ].join("\n"),
            html_url: "https://github.com/DevwareUK/git-ai/issues/93#issuecomment-803",
            updated_at: "2026-03-19T11:00:00Z",
            user: { login: "github-actions[bot]", type: "Bot" },
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "pr", "fix-tests", "93"];

    await expect(run()).rejects.toThrow(
      'Failed to parse the managed AI test suggestions comment for PR #93. Suggestion "Missing Why Field" is missing a Why it matters field.'
    );
  });

  it("fails pr fix-comments clearly when no actionable review comments remain after filtering", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 89,
          title: "No actionable review comments",
          body: "",
          html_url: "https://github.com/DevwareUK/git-ai/pull/89",
          base: { ref: "main" },
          head: { ref: "feat/no-actionable-comments" },
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 601,
            body: "Thanks!",
            path: "packages/cli/src/index.ts",
            line: 10,
            side: "RIGHT",
            html_url:
              "https://github.com/DevwareUK/git-ai/pull/89#discussion_r601",
            user: { login: "reviewer-a" },
            created_at: "2026-03-18T09:00:00Z",
            updated_at: "2026-03-18T09:01:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "pr", "fix-comments", "89"];

    await expect(run()).rejects.toThrow(
      "No actionable pull request review comments were found for PR #89."
    );
  });

  it("passes configured excludePaths into test-backlog analysis", async () => {
    await withRepositoryConfig(
      JSON.stringify(
        {
          aiContext: {
            excludePaths: ["web/themes/**/css/**"],
          },
        },
        null,
        2
      ),
      async () => {
        const analysis = createTestBacklogAnalysis();
        const { run, analyzeTestBacklog } = await loadCli({
          analysisResult: analysis,
        });

        process.argv = ["node", "git-ai", "test-backlog", "--top", "1"];

        const stdout = captureStdout();
        await run();

        expect(analyzeTestBacklog).toHaveBeenCalledWith({
          excludePaths: [
            "**/node_modules/**",
            "**/vendor/**",
            "**/dist/**",
            "**/build/**",
            "*.map",
            "web/themes/**/css/**",
          ],
          repoRoot: REPO_ROOT,
          maxFindings: 1,
        });
        expect(stdout.output()).toContain("# AI Test Backlog");
      }
    );
  });

  it("fails test-backlog issue creation clearly when no GitHub token is configured", async () => {
    const { run } = await loadCli({
      analysisResult: createTestBacklogAnalysis(),
    });

    process.env.GITHUB_TOKEN = "";
    process.env.GH_TOKEN = "";
    process.argv = ["node", "git-ai", "test-backlog", "--create-issues"];

    await expect(run()).rejects.toThrow(
      "Creating GitHub issues requires GH_TOKEN or GITHUB_TOKEN to be set."
    );
  });

  it("runs feature-backlog in JSON mode and prompts for issue details before creating issues", async () => {
    const analysis = createFeatureBacklogAnalysis();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 51,
            title: analysis.suggestions[0].issueTitle,
            html_url: "https://github.com/DevwareUK/git-ai/issues/51",
          },
        ])
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 52,
          title: "Custom release automation title",
          html_url: "https://github.com/DevwareUK/git-ai/issues/52",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, analyzeFeatureBacklog } = await loadCli({
      featureAnalysisResult: analysis,
      readlineAnswers: [
        "1,2",
        "",
        "",
        "",
        "Custom release automation title",
        "Prioritize npm package publishing and changelog generation.",
        "release,automation",
      ],
      execFileSyncImpl: (command, args) => {
        if (
          command === "git" &&
          (args[0] === "-C" || args[0] === "remote")
        ) {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = [
      "node",
      "git-ai",
      "feature-backlog",
      ".",
      "--format",
      "json",
      "--create-issues",
      "--max-issues",
      "2",
      "--label",
      "product",
    ];

    const stdout = captureStdout();
    await run();

    expect(analyzeFeatureBacklog).toHaveBeenCalledWith({
      excludePaths: [
        "**/node_modules/**",
        "**/vendor/**",
        "**/dist/**",
        "**/build/**",
        "*.map",
      ],
      repoRoot: REPO_ROOT,
      maxSuggestions: 5,
    });

    const output = JSON.parse(stdout.output()) as {
      suggestions: Array<{ issueTitle: string }>;
      createdIssues: Array<{ number: number; title: string; status: string }>;
    };

    expect(output.suggestions.map((suggestion) => suggestion.issueTitle)).toEqual(
      analysis.suggestions.map((suggestion) => suggestion.issueTitle)
    );
    expect(output.createdIssues).toEqual([
      {
        number: 51,
        title: analysis.suggestions[0].issueTitle,
        url: "https://github.com/DevwareUK/git-ai/issues/51",
        status: "existing",
      },
      {
        number: 52,
        title: "Custom release automation title",
        url: "https://github.com/DevwareUK/git-ai/issues/52",
        status: "created",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders feature-backlog markdown output", async () => {
    const analysis = createFeatureBacklogAnalysis();
    const { run, analyzeFeatureBacklog } = await loadCli({
      featureAnalysisResult: analysis,
    });

    process.argv = ["node", "git-ai", "feature-backlog", ".", "--top", "2"];

    const stdout = captureStdout();
    await run();

    expect(analyzeFeatureBacklog).toHaveBeenCalledWith({
      excludePaths: [
        "**/node_modules/**",
        "**/vendor/**",
        "**/dist/**",
        "**/build/**",
        "*.map",
      ],
      repoRoot: REPO_ROOT,
      maxSuggestions: 2,
    });
    expect(stdout.output()).toContain("# AI Feature Backlog");
    expect(stdout.output()).toContain("## Repository signals");
    expect(stdout.output()).toContain(
      "### Add guided issue templates for feature requests and bug reports"
    );
    expect(stdout.output()).toContain(
      "- Draft issue title: Add guided issue templates for feature requests and bug reports"
    );
  });

  it("runs setup with repo-aware defaults and writes config, gitignore, and AGENTS guidance", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-setup-node-"));
    cleanupTargets.add(repoRoot);
    mkdirSync(resolve(repoRoot, ".github", "workflows"), { recursive: true });
    mkdirSync(resolve(repoRoot, "coverage"), { recursive: true });
    writeFileSync(resolve(repoRoot, "package.json"), JSON.stringify({
      name: "fixture-node-repo",
      scripts: {
        build: "tsup",
        test: "vitest",
      },
    }, null, 2));
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");
    writeFileSync(resolve(repoRoot, "tsconfig.json"), "{}\n");
    writeFileSync(resolve(repoRoot, ".gitignore"), "node_modules/\n");

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      readlineAnswers: ["", "", "", "", ""],
      execFileSyncImpl: (command, args) => {
        if (
          command === "git" &&
          args[0] === "symbolic-ref" &&
          args[1] === "refs/remotes/origin/HEAD"
        ) {
          return "refs/remotes/origin/main\n";
        }

        if (
          command === "git" &&
          args[0] === "remote" &&
          args[1] === "get-url" &&
          args[2] === "origin"
        ) {
          return "git@github.com:acme/fixture-node-repo.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "setup"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await run();

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".git-ai", "config.json"), "utf8"))
    ).toEqual({
      aiContext: {
        excludePaths: ["**/coverage/**"],
      },
      baseBranch: "main",
      buildCommand: ["pnpm", "build"],
      forge: {
        type: "github",
      },
    });
    expect(readFileSync(resolve(repoRoot, ".gitignore"), "utf8")).toContain(".git-ai/\n");

    const agentsContent = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("<!-- git-ai:setup:start -->");
    expect(agentsContent).toContain("Detected stack: TypeScript repository.");
    expect(agentsContent).toContain("`pnpm build`");
    expect(agentsContent).toContain("`github`");
    expect(messages.join("\n")).toContain("Next step: create `.env`");
  });

  it("updates an existing AGENTS managed section during setup and keeps manual guidance", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "git-ai-setup-drupal-"));
    cleanupTargets.add(repoRoot);
    mkdirSync(resolve(repoRoot, "web", "themes", "custom", "site", "css"), {
      recursive: true,
    });
    mkdirSync(resolve(repoRoot, "web", "themes", "custom", "site", "js"), {
      recursive: true,
    });
    mkdirSync(resolve(repoRoot, "web", "sites", "default", "files"), {
      recursive: true,
    });
    writeFileSync(resolve(repoRoot, "composer.json"), JSON.stringify({
      name: "acme/drupal-site",
      scripts: {
        test: ["phpunit"],
      },
    }, null, 2));
    writeFileSync(resolve(repoRoot, ".gitignore"), ".git-ai/\n");
    writeFileSync(
      resolve(repoRoot, "AGENTS.md"),
      [
        "# Repository Notes",
        "",
        "Keep this manual guidance.",
        "",
        "<!-- git-ai:setup:start -->",
        "Old managed setup guidance.",
        "<!-- git-ai:setup:end -->",
        "",
      ].join("\n")
    );

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      readlineAnswers: ["develop", "none", "", "", ""],
      execFileSyncImpl: (command, args) => {
        if (
          command === "git" &&
          args[0] === "symbolic-ref" &&
          args[1] === "refs/remotes/origin/HEAD"
        ) {
          return "refs/remotes/origin/main\n";
        }

        if (
          command === "git" &&
          args[0] === "remote" &&
          args[1] === "get-url" &&
          args[2] === "origin"
        ) {
          return "git@gitlab.com:acme/drupal-site.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "setup"];
    await run();

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".git-ai", "config.json"), "utf8"))
    ).toEqual({
      aiContext: {
        excludePaths: [
          "web/sites/default/files/**",
          "web/themes/**/css/**",
          "web/themes/**/js/**",
        ],
      },
      baseBranch: "develop",
      buildCommand: ["composer", "test"],
      forge: {
        type: "none",
      },
    });

    const gitignoreContent = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
    expect(gitignoreContent.match(/\.git-ai\//g) ?? []).toHaveLength(1);

    const agentsContent = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("# Repository Notes");
    expect(agentsContent).toContain("Keep this manual guidance.");
    expect(agentsContent).not.toContain("Old managed setup guidance.");
    expect(agentsContent).toContain("Detected stack: Drupal/PHP repository.");
    expect(agentsContent).toContain("`composer test`");
    expect(agentsContent).toContain("`none`");
  });

  it("launches the default issue draft runtime workflow and saves the draft under .git-ai/issues", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    let runtimePrompt = "";

    const { run } = await loadCli({
      readlineAnswers: [
        "Combine PR description and review summary into a single PR assistant action.",
      ],
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          runtimePrompt = readFileSync(
            resolve(REPO_ROOT, metadata.promptFile as string),
            "utf8"
          );
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            [
              "# Merge PR description and review summary into one PR assistant action",
              "",
              "## Summary",
              "Draft a single implementation path for combining the repository's PR description and review summary generation flows.",
              "",
              "## Requirements",
              "- Reuse the existing PR assistant and body-merging patterns where possible.",
              "- Preserve manual pull request body content outside the managed section.",
              "",
              "## Acceptance criteria",
              "- Running the action updates a single managed PR assistant section.",
              "- Existing non-managed PR body content is preserved.",
              "",
            ].join("\n"),
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command.startsWith("vim ")) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "draft"];
    await run();

    expect(runtimePrompt).toContain(
      "Combine PR description and review summary into a single PR assistant action."
    );
    expect(runtimePrompt).toContain("ask the user targeted clarifying questions");
    expect(runtimePrompt).toContain(
      "avoid asking questions that are already answerable from the codebase"
    );
    expect(runtimePrompt).toContain("Write the final Markdown issue draft");

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      flow: string;
      featureIdea: string;
      draftFile: string;
      promptFile: string;
      runDir: string;
      runtime?: {
        type: string;
      };
    };
    expect(metadata).toMatchObject({
      flow: "issue-draft",
      featureIdea:
        "Combine PR description and review summary into a single PR assistant action.",
      draftFile: `.git-ai/issues/${createdDraft}`,
      promptFile: `.git-ai/runs/${createdRunDir}/prompt.md`,
      runDir: `.git-ai/runs/${createdRunDir}`,
      runtime: {
        type: "codex",
      },
    });

    const content = readFileSync(
      resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string),
      "utf8"
    );
    expect(content).toContain("# Merge PR description and review summary into one PR assistant action");
    expect(content).toContain("## Acceptance criteria");
  });

  it("uses the configured Claude Code runtime for issue draft workflows", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    let runtimePrompt = "";

    await withRepositoryConfig(
      JSON.stringify(
        {
          ai: {
            runtime: {
              type: "claude-code",
            },
          },
        },
        null,
        2
      ),
      async () => {
        const { run } = await loadCli({
          readlineAnswers: ["Draft the Claude Code runtime support issue."],
          spawnSyncImpl: (command, args) => {
            if (command === "claude" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "claude") {
              const { metadata } = readLatestRunMetadata();
              runtimePrompt = readFileSync(
                resolve(REPO_ROOT, metadata.promptFile as string),
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.draftFile as string),
                "# Add Claude Code runtime support\n\n## Summary\nLaunch Claude Code for local issue drafting.\n",
                "utf8"
              );
              return { status: 0 };
            }

            if (command === "gh" && args[0] === "--version") {
              return { status: 1, error: new Error("gh is unavailable") };
            }

            throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
          },
        });

        process.argv = ["node", "git-ai", "issue", "draft"];
        await run();
      }
    );

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    expect(runtimePrompt).toContain("Draft the Claude Code runtime support issue.");

    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      runtime?: {
        type?: string;
        command?: string;
      };
    };
    expect(metadata).toMatchObject({
      runtime: {
        type: "claude-code",
        command: "claude",
      },
    });
  });

  it("requires the codex CLI for issue draft workflows", async () => {
    const { run } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs."],
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 1, error: new Error("codex is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "draft"];

    await expect(run()).rejects.toThrow(
      'Configured runtime "Codex" is unavailable because the `codex` CLI is not available on PATH. Install the missing dependency before running interactive git-ai workflows.'
    );
  });

  it("previews the generated issue draft and creates it without opening an editor by default", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const issueTitle = "Merge PR description and review summary into one PR assistant action";
    const { run, execFileSync, spawnSync } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "create") {
          return "https://github.com/DevwareUK/git-ai/issues/99\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${issueTitle}\n\n## Summary\nUnify the managed PR assistant outputs into one reviewed draft.\n`,
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "draft"];
    const stdout = captureStdout();
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        "DevwareUK/git-ai",
        "--title",
        issueTitle,
        "--body",
        expect.stringContaining("## Summary"),
      ],
      expect.any(Object)
    );
    expect(stdout.output()).toContain("Generated issue draft");
    expect(stdout.output()).toContain(`# ${issueTitle}`);
    expect(
      spawnSync.mock.calls.some(([command]) => String(command).startsWith("vim "))
    ).toBe(false);
  });

  it("opens the issue draft in an editor only when modify is selected", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const initialTitle = "Merge PR description and review summary into one PR assistant action";
    const updatedTitle = "Unify the PR assistant draft creation flow";
    const { run, execFileSync, spawnSync } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "m", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "create") {
          return "https://github.com/DevwareUK/git-ai/issues/100\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${initialTitle}\n\n## Summary\nUnify the managed PR assistant outputs into one reviewed draft.\n`,
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command.startsWith("vim ")) {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${updatedTitle}\n\n## Summary\nCreate one managed PR assistant artifact.\n`,
            "utf8"
          );
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "draft"];
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        "DevwareUK/git-ai",
        "--title",
        updatedTitle,
        "--body",
        expect.stringContaining("## Summary"),
      ],
      expect.any(Object)
    );
    expect(
      spawnSync.mock.calls.filter(([command]) => String(command).startsWith("vim "))
    ).toHaveLength(1);
  });

  it("keeps the reviewed issue draft on disk when creation is declined", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const issueTitle = "Merge PR description and review summary into one PR assistant action";
    const { run, execFileSync } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${issueTitle}\n\n## Summary\nUnify the managed PR assistant outputs into one reviewed draft.\n`,
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "draft"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    const createdDraftPath = resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string);
    cleanupTargets.add(createdDraftPath);

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    expect(readFileSync(createdDraftPath, "utf8")).toContain(issueTitle);
    expect(messages.join("\n")).toContain(`Draft kept at .git-ai/issues/${createdDraft}`);
    expect(execFileSync).not.toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["issue", "create"]),
      expect.anything()
    );
  });

  it("rejects empty modified issue drafts and lets the user cancel safely", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const { run, execFileSync } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "m", "n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Valid title\n\n## Summary\nStart with a valid draft.\n",
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command.startsWith("vim ")) {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(resolve(REPO_ROOT, metadata.draftFile as string), "", "utf8");
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "draft"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    expect(messages.join("\n")).toContain("Issue draft cannot be empty.");
    expect(execFileSync).not.toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["issue", "create"]),
      expect.anything()
    );
  });

  it("creates a draft issue with a GitHub token when gh is unavailable", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const issueTitle = "Merge PR description and review summary into one PR assistant action";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 109,
        title: issueTitle,
        html_url: "https://github.com/DevwareUK/git-ai/issues/109",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${issueTitle}\n\n## Summary\nUnify the managed PR assistant outputs into one reviewed draft.\n`,
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command.startsWith("vim ")) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "issue", "draft"];

    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/DevwareUK/git-ai/issues",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      title: issueTitle,
      body: expect.stringContaining("## Summary"),
      labels: [],
    });
  });

  it("generates an issue resolution plan comment when none exists", async () => {
    const issueNumber = 42;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Add Command to Generate and Modify Issue Resolution Plan",
          body: "Create a plan comment and reuse it in later issue runs.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 501,
          body: "<!-- git-ai:issue-plan -->\n## Issue Resolution Plan",
          html_url:
            `https://github.com/DevwareUK/git-ai/issues/${issueNumber}#issuecomment-501`,
          updated_at: "2026-03-18T11:11:41Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const issuePlan = createIssueResolutionPlanResult();
    const { run, generateIssueResolutionPlan } = await loadCli({
      issueResolutionPlanResult: issuePlan,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "issue", "plan", String(issueNumber)];

    await run();

    expect(generateIssueResolutionPlan).toHaveBeenCalledWith(expect.any(Object), {
      issueNumber,
      issueTitle: "Add Command to Generate and Modify Issue Resolution Plan",
      issueBody: "Create a plan comment and reuse it in later issue runs.",
      issueUrl: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `https://api.github.com/repos/DevwareUK/git-ai/issues/${issueNumber}/comments`
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: expect.stringMatching(/^Bearer /),
      }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining("<!-- git-ai:issue-plan -->"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining(issuePlan.summary),
    });
  });

  it("reuses an existing edited issue resolution plan comment", async () => {
    const issueNumber = 42;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Add Command to Generate and Modify Issue Resolution Plan",
          body: "Create a plan comment and reuse it in later issue runs.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 777,
            body: [
              "<!-- git-ai:issue-plan -->",
              "## Issue Resolution Plan",
              "",
              "Edited on GitHub by a collaborator.",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/git-ai/issues/${issueNumber}#issuecomment-777`,
            updated_at: "2026-03-18T12:00:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, generateIssueResolutionPlan } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "plan", String(issueNumber)];

    await run();

    expect(generateIssueResolutionPlan).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prepares an issue run and writes automation artifacts", async () => {
    const issueNumber = 91234;
    const issueTitle = "CLI issue prepare integration fixture";
    const outputDir = mkdtempSync(resolve(tmpdir(), "git-ai-cli-issue-prepare-"));
    const githubOutputPath = resolve(outputDir, "github-output.txt");
    writeFileSync(githubOutputPath, "");
    cleanupTargets.add(outputDir);
    const gitCommands: string[][] = [];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: issueTitle,
          body: "Ensure issue prepare writes the expected workspace files.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 613,
            body: [
              "<!-- git-ai:issue-plan -->",
              "## Issue Resolution Plan",
              "",
              "Edited plan from GitHub.",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/git-ai/issues/${issueNumber}#issuecomment-613`,
            updated_at: "2026-03-18T11:30:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "git" && args[0] === "rev-parse") {
          gitCommands.push(args);
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          gitCommands.push(args);
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          gitCommands.push(args);
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          gitCommands.push(args);
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_OUTPUT = githubOutputPath;
    process.argv = [
      "node",
      "git-ai",
      "issue",
      "prepare",
      String(issueNumber),
      "--mode",
      "github-action",
    ];

    const stdout = captureStdout();
    await run();

    const output = JSON.parse(stdout.output()) as {
      branchName: string;
      issueFile: string;
      promptFile: string;
      metadataFile: string;
      outputLog: string;
      runDir: string;
      mode: string;
    };
    const issueFilePath = resolve(REPO_ROOT, output.issueFile);
    const promptFilePath = resolve(REPO_ROOT, output.promptFile);
    const metadataFilePath = resolve(REPO_ROOT, output.metadataFile);
    const outputLogPath = resolve(REPO_ROOT, output.outputLog);
    const runDirPath = resolve(REPO_ROOT, output.runDir);

    cleanupTargets.add(dirname(issueFilePath));
    cleanupTargets.add(runDirPath);

    expect(gitCommands).toEqual([
      ["rev-parse", "--verify", "feat/issue-91234-cli-issue-prepare-integration-fixture"],
      ["checkout", "main"],
      ["pull"],
      ["checkout", "-b", "feat/issue-91234-cli-issue-prepare-integration-fixture"],
    ]);
    expect(output.branchName).toBe("feat/issue-91234-cli-issue-prepare-integration-fixture");
    expect(output.mode).toBe("github-action");
    expect(readFileSync(issueFilePath, "utf8")).toContain(`- Issue number: ${issueNumber}`);
    expect(readFileSync(issueFilePath, "utf8")).toContain(`- Title: ${issueTitle}`);
    expect(readFileSync(issueFilePath, "utf8")).toContain("## Resolution Plan");
    expect(readFileSync(issueFilePath, "utf8")).toContain("Edited plan from GitHub.");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "You are running inside a GitHub Actions workflow via the configured interactive coding runtime."
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "if the issue snapshot includes a resolution plan, treat it as the latest plan of record"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      `Read the issue snapshot at \`${output.issueFile}\` before making changes.`
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain("✅ Implementation complete");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "Ready for the next automation step"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "do not ask for input or wait for a reply after printing the done state"
    );
    expect(readFileSync(outputLogPath, "utf8")).toContain("# git-ai issue run log");
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      issueNumber,
      issueTitle,
      branchName: output.branchName,
      issueFile: output.issueFile,
      promptFile: output.promptFile,
      outputLog: output.outputLog,
      issuePlanCommentUrl:
        `https://github.com/DevwareUK/git-ai/issues/${issueNumber}#issuecomment-613`,
      mode: "github-action",
    });
    expect(readFileSync(githubOutputPath, "utf8")).toContain("branch_name<<");
    expect(readFileSync(githubOutputPath, "utf8")).toContain(output.branchName);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("writes local issue prompts with plain-language next steps", async () => {
    const issueNumber = 91235;
    const issueTitle = "Local issue prompt uses conversational completion guidance";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: issueTitle,
          body: "Ensure the local issue prompt does not require a separate /exit.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "prepare", String(issueNumber)];

    const stdout = captureStdout();
    await run();

    const output = JSON.parse(stdout.output()) as {
      promptFile: string;
      runDir: string;
      mode: string;
    };
    const promptFilePath = resolve(REPO_ROOT, output.promptFile);
    const runDirPath = resolve(REPO_ROOT, output.runDir);

    cleanupTargets.add(dirname(promptFilePath));
    cleanupTargets.add(runDirPath);

    expect(output.mode).toBe("local");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "add a short explanation of how to see the change in action"
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "continue by giving further instruction or type `/exit` when they are satisfied and want to hand control back to `git-ai`"
    );
    expect(readFileSync(promptFilePath, "utf8")).not.toContain("[1] Continue refining");
    expect(readFileSync(promptFilePath, "utf8")).not.toContain("/commit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("runs issue batches sequentially, records batch progress, and resumes from the first incomplete issue", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumbers = [123, 124];
    const issueTitles = new Map([
      [123, "Batch queue first issue"],
      [124, "Batch queue second issue"],
    ]);
    const branchByIssue = new Map([
      [123, "feat/issue-123-batch-queue-first-issue"],
      [124, "feat/issue-124-batch-queue-second-issue"],
    ]);
    const batchStatePath = resolve(
      REPO_ROOT,
      ".git-ai",
      "batches",
      `issues-${issueNumbers.join("-")}.json`
    );

    for (const target of [
      resolve(REPO_ROOT, ".git-ai", "issues", "123"),
      resolve(REPO_ROOT, ".git-ai", "issues", "124"),
      resolve(REPO_ROOT, ".git-ai", "issues", "123-batch-queue-first-issue"),
      resolve(REPO_ROOT, ".git-ai", "issues", "124-batch-queue-second-issue"),
      batchStatePath,
    ]) {
      rmSync(target, { recursive: true, force: true });
      cleanupTargets.add(target);
    }

    const statusResponses = [
      "",
      " M packages/cli/src/index.ts\n",
      "",
      "",
      " M packages/cli/src/index.ts\n",
    ];
    const branches = new Set<string>();
    const codexIssues: number[] = [];
    const codexAttempts = new Map<number, number>();
    let activeIssueNumber: number | undefined;

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const issueMatch = url.match(/\/issues\/(\d+)$/);
      if (issueMatch) {
        const issueNumber = Number.parseInt(issueMatch[1] ?? "", 10);
        return createFetchResponse({
          title: issueTitles.get(issueNumber),
          body: `Implement issue ${issueNumber} through unattended batch orchestration.`,
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        });
      }

      if (url.includes("/comments?")) {
        return createFetchResponse([]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return statusResponses.shift() ?? "";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const flow = "before";',
            '+const flow = "after";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: branches.has(args[2] as string) ? 0 : 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          const branchName = args[2] as string;
          branches.add(branchName);
          activeIssueNumber = Number.parseInt(branchName.match(/issue-(\d+)/)?.[1] ?? "", 10);
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && typeof args[1] === "string") {
          activeIssueNumber = Number.parseInt(args[1].match(/issue-(\d+)/)?.[1] ?? "", 10);
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "exec") {
          const prompt = String(args.at(-1) ?? "");
          const issueNumber = Number.parseInt(prompt.match(/issue-(\d+)/)?.[1] ?? "", 10);
          codexIssues.push(issueNumber);
          activeIssueNumber = issueNumber;
          const attemptNumber = (codexAttempts.get(issueNumber) ?? 0) + 1;
          codexAttempts.set(issueNumber, attemptNumber);

          if (issueNumber === 124 && attemptNumber === 1) {
            return { status: 1, error: new Error("agent failed") };
          }

          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && (args[0] === "add" || args[0] === "commit" || args[0] === "push")) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: `https://github.com/DevwareUK/git-ai/pull/${activeIssueNumber === 123 ? 701 : 702}\n`,
            stderr: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "issue", "batch", "123", "124"];

    await expect(run()).rejects.toThrow(
      "The unattended Codex session did not complete successfully."
    );

    const failedBatchState = readIssueBatchState(issueNumbers);
    cleanupTargets.add(batchStatePath);
    cleanupTargets.add(resolve(REPO_ROOT, failedBatchState.latestRunDir));

    expect(failedBatchState.stoppedIssueNumber).toBe(124);
    expect(failedBatchState.issues).toMatchObject([
      {
        issueNumber: 123,
        status: "completed",
        branchName: branchByIssue.get(123),
        prUrl: "https://github.com/DevwareUK/git-ai/pull/701",
      },
      {
        issueNumber: 124,
        status: "failed",
        branchName: branchByIssue.get(124),
        error: "The unattended Codex session did not complete successfully. agent failed",
      },
    ]);
    expect(
      readFileSync(resolve(REPO_ROOT, failedBatchState.latestRunDir, "summary.md"), "utf8")
    ).toContain("Stopped at issue: #124");

    process.argv = ["node", "git-ai", "issue", "batch", "123", "124"];
    await run();

    const completedBatchState = readIssueBatchState(issueNumbers);
    cleanupTargets.add(resolve(REPO_ROOT, completedBatchState.latestRunDir));
    for (const runDir of listRunDirectories().filter((entry) => !beforeRuns.includes(entry))) {
      cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", runDir));
    }

    expect(completedBatchState.stoppedIssueNumber).toBeUndefined();
    expect(completedBatchState.issues).toMatchObject([
      {
        issueNumber: 123,
        status: "completed",
        prUrl: "https://github.com/DevwareUK/git-ai/pull/701",
      },
      {
        issueNumber: 124,
        status: "completed",
        prUrl: "https://github.com/DevwareUK/git-ai/pull/702",
      },
    ]);
    expect(codexIssues).toEqual([123, 124, 124]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("lets a batch-started unattended issue continue independently through the single-issue command", async () => {
    const beforeRuns = listRunDirectories();
    const issueTitles = new Map([
      [223, "Independent batch queue first issue"],
      [224, "Independent batch queue second issue"],
    ]);
    const branch224 = "feat/issue-224-independent-batch-queue-second-issue";
    const batchStatePath = resolve(
      REPO_ROOT,
      ".git-ai",
      "batches",
      "issues-223-224.json"
    );

    for (const target of [
      resolve(REPO_ROOT, ".git-ai", "issues", "223"),
      resolve(REPO_ROOT, ".git-ai", "issues", "224"),
      resolve(REPO_ROOT, ".git-ai", "issues", "223-independent-batch-queue-first-issue"),
      resolve(REPO_ROOT, ".git-ai", "issues", "224-independent-batch-queue-second-issue"),
      batchStatePath,
    ]) {
      rmSync(target, { recursive: true, force: true });
      cleanupTargets.add(target);
    }

    const statusResponses = [
      "",
      " M packages/cli/src/index.ts\n",
      "",
      "",
      " M packages/cli/src/index.ts\n",
    ];
    const branches = new Set<string>();
    const gitCommands: string[][] = [];
    const codexAttempts = new Map<number, number>();

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const issueMatch = url.match(/\/issues\/(\d+)$/);
      if (issueMatch) {
        const issueNumber = Number.parseInt(issueMatch[1] ?? "", 10);
        return createFetchResponse({
          title: issueTitles.get(issueNumber),
          body: `Implement issue ${issueNumber} through unattended orchestration.`,
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        });
      }

      if (url.includes("/comments?")) {
        return createFetchResponse([]);
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return statusResponses.shift() ?? "";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const state = "before";',
            '+const state = "after";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git") {
          gitCommands.push(args as string[]);
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: branches.has(args[2] as string) ? 0 : 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          branches.add(args[2] as string);
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "exec") {
          const prompt = String(args.at(-1) ?? "");
          const issueNumber = Number.parseInt(prompt.match(/issue-(\d+)/)?.[1] ?? "", 10);
          const attemptNumber = (codexAttempts.get(issueNumber) ?? 0) + 1;
          codexAttempts.set(issueNumber, attemptNumber);

          if (issueNumber === 224 && attemptNumber === 1) {
            return { status: 1, error: new Error("agent failed") };
          }

          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && (args[0] === "add" || args[0] === "commit" || args[0] === "push")) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: `https://github.com/DevwareUK/git-ai/pull/${codexAttempts.get(224) === 2 ? 804 : 803}\n`,
            stderr: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "issue", "batch", "223", "224"];

    await expect(run()).rejects.toThrow(
      "The unattended Codex session did not complete successfully."
    );

    const sessionStatePath = resolve(REPO_ROOT, ".git-ai", "issues", "224", "session.json");
    cleanupTargets.add(sessionStatePath);
    expect(existsSync(sessionStatePath)).toBe(true);

    const rerunGitCommandIndex = gitCommands.length;
    process.argv = ["node", "git-ai", "issue", "224", "--mode", "unattended"];
    await run();

    const rerunGitCommands = gitCommands.slice(rerunGitCommandIndex);
    expect(rerunGitCommands).toContainEqual(["rev-parse", "--verify", branch224]);
    expect(rerunGitCommands).toContainEqual(["checkout", branch224]);
    expect(rerunGitCommands).not.toContainEqual(["checkout", "main"]);
    expect(rerunGitCommands).not.toContainEqual(["pull"]);
    expect(rerunGitCommands).not.toContainEqual(["checkout", "-b", branch224]);
    expect(codexAttempts.get(224)).toBe(2);
    for (const runDir of listRunDirectories().filter((entry) => !beforeRuns.includes(entry))) {
      cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", runDir));
    }
  });

  it("tracks the Codex session for a first full issue run", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 148;
    const issueTitle = "Track resumable Codex issue sessions";
    const branchName = "feat/issue-148-track-resumable-codex-issue-sessions";
    const sessionId = "019d5000-1111-7222-8333-444455556666";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".git-ai",
      "issues",
      `${issueNumber}-track-resumable-codex-issue-sessions`
    );
    let gitStatusCallCount = 0;

    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: issueTitle,
          body: "Persist the session id after the first full issue run.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "";

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const flow = "before";',
            '+const flow = "after";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex") {
          writeMockCodexSession(
            codexHome,
            sessionId,
            REPO_ROOT,
            "2026-04-01T09:15:00.000Z"
          );
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();

    const sessionStatePath = resolve(sessionStateDir, "session.json");
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    const sessionState = JSON.parse(readFileSync(sessionStatePath, "utf8")) as {
      runtimeType: string;
      branchName: string;
      sessionId: string;
      runDir: string;
      promptFile: string;
      outputLog: string;
      issueDir: string;
    };
    expect(sessionState).toMatchObject({
      issueNumber,
      runtimeType: "codex",
      branchName,
      sessionId,
      runDir: `.git-ai/runs/${createdRunDir}`,
      promptFile: `.git-ai/runs/${createdRunDir}/prompt.md`,
      outputLog: `.git-ai/runs/${createdRunDir}/output.log`,
      issueDir: `.git-ai/issues/${issueNumber}-track-resumable-codex-issue-sessions`,
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });

    const metadata = JSON.parse(
      readFileSync(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string, "metadata.json"), "utf8")
    ) as {
      runtime?: {
        type?: string;
        invocation?: string;
        sessionId?: string;
      };
      branchName?: string;
    };
    expect(metadata).toMatchObject({
      branchName,
      runtime: {
        type: "codex",
        invocation: "new",
        sessionId,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("resumes the saved Codex session for later full issue runs", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 149;
    const issueTitle = "Resume saved Codex sessions";
    const branchName = "feat/issue-149-resume-saved-codex-sessions";
    const sessionId = "019d5001-aaaa-7bbb-8ccc-ddddeeeeffff";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));
    const sessionStatePath = resolve(sessionStateDir, "session.json");
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".git-ai",
      "issues",
      `${issueNumber}-resume-saved-codex-sessions`
    );
    let gitStatusCallCount = 0;
    const gitCommands: string[][] = [];

    writeMockCodexSession(codexHome, sessionId, REPO_ROOT, "2026-04-01T09:20:00.000Z");
    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      sessionStatePath,
      `${JSON.stringify(
        {
          issueNumber,
          runtimeType: "codex",
          branchName,
          issueDir: `.git-ai/issues/${issueNumber}-resume-saved-codex-sessions`,
          runDir: ".git-ai/runs/20260401T090000000Z-issue-149",
          promptFile: ".git-ai/runs/20260401T090000000Z-issue-149/prompt.md",
          outputLog: ".git-ai/runs/20260401T090000000Z-issue-149/output.log",
          sessionId,
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-01T09:20:00.000Z",
          updatedAt: "2026-04-01T09:20:00.000Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: issueTitle,
          body: "Resume the same session instead of starting a new branch.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "";

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const mode = "fresh";',
            '+const mode = "resume";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git") {
          gitCommands.push(args);
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          throw new Error("Resume path should not switch back to the base branch.");
        }

        if (command === "git" && args[0] === "pull") {
          throw new Error("Resume path should not pull the base branch.");
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          throw new Error("Resume path should not create a new branch.");
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", sessionId, "--sandbox", "workspace-write"]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
    expect(gitCommands).toContainEqual(["rev-parse", "--verify", branchName]);
    expect(gitCommands).toContainEqual(["checkout", branchName]);
    expect(gitCommands).not.toContainEqual(["checkout", "main"]);
    expect(gitCommands).not.toContainEqual(["pull"]);
    expect(gitCommands).not.toContainEqual(["checkout", "-b", branchName]);

    const metadata = JSON.parse(
      readFileSync(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string, "metadata.json"), "utf8")
    ) as {
      runtime?: {
        type?: string;
        invocation?: string;
        sessionId?: string;
      };
    };
    expect(metadata).toMatchObject({
      runtime: {
        type: "codex",
        invocation: "resume",
        sessionId,
      },
    });

    const updatedSessionState = JSON.parse(readFileSync(sessionStatePath, "utf8")) as {
      runDir: string;
      promptFile: string;
      outputLog: string;
    };
    expect(updatedSessionState).toMatchObject({
      runDir: `.git-ai/runs/${createdRunDir}`,
      promptFile: `.git-ai/runs/${createdRunDir}/prompt.md`,
      outputLog: `.git-ai/runs/${createdRunDir}/output.log`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when saved issue session state points to a missing Codex session", async () => {
    const issueNumber = 150;
    const branchName = "feat/issue-150-stale-codex-session-state";
    createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));
    const sessionStatePath = resolve(sessionStateDir, "session.json");

    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      sessionStatePath,
      `${JSON.stringify(
        {
          issueNumber,
          runtimeType: "codex",
          branchName,
          issueDir: `.git-ai/issues/${issueNumber}-stale-codex-session-state`,
          runDir: ".git-ai/runs/20260401T092500000Z-issue-150",
          promptFile: ".git-ai/runs/20260401T092500000Z-issue-150/prompt.md",
          outputLog: ".git-ai/runs/20260401T092500000Z-issue-150/output.log",
          sessionId: "019d5002-0000-7111-8222-933344445555",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-01T09:25:00.000Z",
          updatedAt: "2026-04-01T09:25:00.000Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Stale Codex session state",
          body: "Fail with a recovery path when the saved session no longer exists.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout") {
          throw new Error("Stale session recovery should stop before branch checkout.");
        }

        if (command === "codex") {
          throw new Error("Stale session recovery should stop before launching Codex.");
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", String(issueNumber)];

    let caughtError: unknown;
    try {
      await run();
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain(
      `Saved Codex session 019d5002-0000-7111-8222-933344445555 for issue #${issueNumber} is no longer available.`
    );
    expect((caughtError as Error).message).toContain(
      `remove .git-ai/issues/${issueNumber}/session.json and rerun \`git-ai issue ${issueNumber}\``
    );
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", "019d5002-0000-7111-8222-933344445555"]),
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts legacy unattended issue session state without runtimeType", async () => {
    const issueNumber = 151;
    const branchName = "feat/issue-151-legacy-unattended-session-state";
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));
    const sessionStatePath = resolve(sessionStateDir, "session.json");
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".git-ai",
      "issues",
      `${issueNumber}-legacy-unattended-session-state`
    );
    let gitStatusCallCount = 0;
    const gitCommands: string[][] = [];

    mkdirSync(sessionStateDir, { recursive: true });
    writeFileSync(
      sessionStatePath,
      `${JSON.stringify(
        {
          issueNumber,
          branchName,
          issueDir: `.git-ai/issues/${issueNumber}-legacy-unattended-session-state`,
          runDir: ".git-ai/runs/20260415T074750395Z-issue-151",
          promptFile: ".git-ai/runs/20260415T074750395Z-issue-151/prompt.md",
          outputLog: ".git-ai/runs/20260415T074750395Z-issue-151/output.log",
          executionMode: "unattended",
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          createdAt: "2026-04-15T07:47:50.464Z",
          updatedAt: "2026-04-15T07:47:50.464Z",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Legacy unattended session state",
          body: "Resume unattended runs created before runtimeType was persisted.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const mode = "before";',
            '+const mode = "after";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "git") {
          gitCommands.push(args as string[]);
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          throw new Error("Legacy unattended resume should not switch to base branch.");
        }

        if (command === "git" && args[0] === "pull") {
          throw new Error("Legacy unattended resume should not pull the base branch.");
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          throw new Error("Legacy unattended resume should not create a new branch.");
        }

        if (command === "codex" && args[0] === "exec") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && (args[0] === "add" || args[0] === "commit" || args[0] === "push")) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return {
            status: 0,
            stdout: "https://github.com/DevwareUK/git-ai/pull/851\n",
            stderr: "",
          };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "issue", String(issueNumber), "--mode", "unattended"];

    await run();

    expect(gitCommands).toContainEqual(["rev-parse", "--verify", branchName]);
    expect(gitCommands).toContainEqual(["checkout", branchName]);
    expect(gitCommands).not.toContainEqual(["checkout", "main"]);
    expect(gitCommands).not.toContainEqual(["pull"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("continues with build and commit flow when Codex exits a full issue run", async () => {
    const issueNumber = 145;
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".git-ai",
      "issues",
      "145-resume-issue-automation-after-the-codex-session"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Resume issue automation after the Codex session exits",
          body: "The outer issue workflow should continue after a normal Codex exit.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          gitStatusCallCount += 1;
          return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,1 @@",
            '-const prompt = "old";',
            '+const prompt = "new";',
          ].join("\n");
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "view") {
          return {
            status: 1,
            error: new Error("force API fallback"),
          };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "pnpm" && args[0] === "build") {
          return { status: 0, stdout: "built\n", stderr: "" };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "push") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "gh" && args[0] === "pr" && args[1] === "create") {
          return { status: 0, stdout: "", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", String(issueNumber)];
    await run();

    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.any(Array),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "pnpm",
      ["build"],
      expect.objectContaining({
        encoding: "utf8",
      })
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-F", expect.stringContaining("commit-message.txt")],
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("writes a PR description diagnostic artifact during full issue runs when schema validation fails", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 147;
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".git-ai",
      "issues",
      "147-persist-pr-description-diagnostics-in-issue-runs"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    let gitStatusCallCount = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Persist PR description diagnostics in issue runs",
          body: "The issue workflow should preserve failed PR description payloads locally.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";

    const { run, generatePRDescription, StructuredGenerationError, spawnSync } =
      await loadCli({
        execFileSyncImpl: (command, args) => {
          if (command === "git" && args[0] === "status") {
            gitStatusCallCount += 1;
            return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
          }

          if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
            return "packages/cli/src/index.ts\n";
          }

          if (
            command === "git" &&
            args[0] === "diff" &&
            args[1] === "HEAD" &&
            args[2] === "--" &&
            args[3] === "packages/cli/src/index.ts"
          ) {
            return [
              "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
              "--- a/packages/cli/src/index.ts",
              "+++ b/packages/cli/src/index.ts",
              "@@ -1,1 +1,1 @@",
              '-const state = "before";',
              '+const state = "after";',
            ].join("\n");
          }

          if (command === "git" && args[0] === "remote") {
            return "git@github.com:DevwareUK/git-ai.git\n";
          }

          throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
        },
        spawnSyncImpl: (command, args) => {
          if (command === "gh" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "auth" && args[1] === "status") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "issue" && args[1] === "view") {
            return {
              status: 1,
              error: new Error("force API fallback"),
            };
          }

          if (command === "git" && args[0] === "rev-parse") {
            return { status: 1 };
          }

          if (command === "git" && args[0] === "checkout" && args[1] === "main") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "pull") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
            return { status: 0 };
          }

          if (command === "codex" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "codex") {
            return { status: 0 };
          }

          if (command === "pnpm" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "pnpm" && args[0] === "build") {
            return { status: 0, stdout: "built\n", stderr: "" };
          }

          if (command === "git" && args[0] === "add") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "commit") {
            return { status: 0 };
          }

          throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
        },
      });

    generatePRDescription.mockRejectedValue(
      new StructuredGenerationError({
        kind: "schema_validation",
        message: [
          "Model output failed PR description schema validation:",
          "- body: Invalid input: expected string, received undefined",
        ].join("\n"),
        rawResponse: '{"title":"feat: broken"}',
        parsedJson: {
          title: "feat: broken",
        },
        normalizedJson: {
          title: "feat: broken",
        },
        validationIssues: [
          {
            path: "body",
            message: "Invalid input: expected string, received undefined",
            code: "invalid_type",
          },
        ],
      })
    );

    process.argv = ["node", "git-ai", "issue", String(issueNumber)];

    let caughtError: unknown;
    try {
      await run();
    } catch (error: unknown) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", createdRunDir as string));

    const artifactRelativePath = `.git-ai/runs/${createdRunDir}/pr-description-generation-error.json`;
    expect((caughtError as Error).message).toContain(
      `Failed to generate PR description. Model output failed PR description schema validation:`
    );
    expect((caughtError as Error).message).toContain(
      `Diagnostic artifact: ${artifactRelativePath}.`
    );

    const artifact = JSON.parse(
      readFileSync(resolve(REPO_ROOT, artifactRelativePath), "utf8")
    ) as {
      stage: string;
      kind: string;
      rawResponse: string;
      parsedJson: Record<string, unknown>;
      normalizedJson: Record<string, unknown>;
      validationIssues: Array<{
        path: string;
        message: string;
        code: string;
      }>;
    };

    expect(artifact).toMatchObject({
      stage: "pr-description",
      kind: "schema_validation",
      rawResponse: '{"title":"feat: broken"}',
      parsedJson: {
        title: "feat: broken",
      },
      normalizedJson: {
        title: "feat: broken",
      },
      validationIssues: [
        {
          path: "body",
          message: "Invalid input: expected string, received undefined",
          code: "invalid_type",
        },
      ],
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "pnpm",
      ["build"],
      expect.objectContaining({
        encoding: "utf8",
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses repository config for issue build verification and pull request base branch", async () => {
    const issueNumber = 144;
    const sessionStateDir = resolve(REPO_ROOT, ".git-ai", "issues", String(issueNumber));
    const issueWorkspaceDir = resolve(
      REPO_ROOT,
      ".git-ai",
      "issues",
      "144-use-repository-config-in-issue-runs"
    );
    rmSync(sessionStateDir, { recursive: true, force: true });
    rmSync(issueWorkspaceDir, { recursive: true, force: true });
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(issueWorkspaceDir);
    const configPath = resolve(REPO_ROOT, ".git-ai", "config.json");
    const hadOriginalConfig = existsSync(configPath);
    const originalConfig = hadOriginalConfig ? readFileSync(configPath, "utf8") : undefined;
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          baseBranch: "develop",
          buildCommand: ["npm", "run", "verify"],
        },
        null,
        2
      )
    );

    let gitStatusCallCount = 0;
    const gitCommands: string[][] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Use repository config in issue runs",
          body: "Verify issue automation reads .git-ai/config.json.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "test-key";

    try {
      const { run, spawnSync } = await loadCli({
        prDescriptionResult: {
          title: "refactor: use configured issue run defaults",
          body: [
            "## Summary",
            "Use repository config defaults throughout the issue workflow.",
            "",
            "## Changes",
            "- Read the configured base branch before preparing the issue branch.",
            "- Use the configured build command before finalizing issue work.",
            "",
            "## Testing",
            "- npm run verify",
          ].join("\n"),
        },
        prAssistantResult: {
          summary: "Keeps issue-created pull requests aligned with repository configuration.",
          keyChanges: [
            "Uses the configured base branch for issue preparation and PR creation.",
            "Uses the configured build command before commit and PR steps.",
          ],
          riskAreas: [],
          reviewerFocus: [
            "Verify the workflow honors the configured base branch and build command.",
          ],
        },
        execFileSyncImpl: (command, args) => {
          if (command === "git" && args[0] === "status") {
            gitStatusCallCount += 1;
            return gitStatusCallCount === 1 ? "" : " M packages/cli/src/index.ts\n";
          }

          if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
            return "packages/cli/src/index.ts\n";
          }

          if (
            command === "git" &&
            args[0] === "diff" &&
            args[1] === "HEAD" &&
            args[2] === "--" &&
            args[3] === "packages/cli/src/index.ts"
          ) {
            return [
              "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
              "--- a/packages/cli/src/index.ts",
              "+++ b/packages/cli/src/index.ts",
              "@@ -1,1 +1,2 @@",
              "-const config = defaultConfig;",
              "+const config = loadConfig();",
              '+const baseBranch = "develop";',
            ].join("\n");
          }

          if (command === "git" && args[0] === "remote") {
            return "git@github.com:DevwareUK/git-ai.git\n";
          }

          throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
        },
        spawnSyncImpl: (command, args) => {
          if (command === "gh" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "auth" && args[1] === "status") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "issue" && args[1] === "view") {
            return {
              status: 1,
              error: new Error("force API fallback"),
            };
          }

          if (command === "git" && args[0] === "rev-parse") {
            gitCommands.push(args);
            return { status: 1 };
          }

          if (command === "git" && args[0] === "checkout" && args[1] === "develop") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "git" && args[0] === "pull") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
            gitCommands.push(args);
            return { status: 0 };
          }

          if (command === "codex" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "codex") {
            return { status: 0 };
          }

          if (command === "npm" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "npm" && args[0] === "run" && args[1] === "verify") {
            return { status: 0, stdout: "verified\n", stderr: "" };
          }

          if (command === "git" && args[0] === "add") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "commit") {
            return { status: 0 };
          }

          if (command === "git" && args[0] === "push") {
            return { status: 0, stdout: "", stderr: "" };
          }

          if (command === "gh" && args[0] === "pr" && args[1] === "create") {
            return { status: 0, stdout: "", stderr: "" };
          }

          throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
        },
      });

      process.argv = ["node", "git-ai", "issue", String(issueNumber)];
      await run();

      expect(gitCommands).toEqual([
        ["rev-parse", "--verify", "feat/issue-144-use-repository-config-in-issue-runs"],
        ["checkout", "develop"],
        ["pull"],
        ["checkout", "-b", "feat/issue-144-use-repository-config-in-issue-runs"],
      ]);
      expect(spawnSync).toHaveBeenCalledWith(
        "npm",
        ["run", "verify"],
        expect.objectContaining({
          encoding: "utf8",
        })
      );
      const prCreateCall = spawnSync.mock.calls.find(
        ([command, args]) =>
          command === "gh" &&
          Array.isArray(args) &&
          args[0] === "pr" &&
          args[1] === "create"
      );
      expect(prCreateCall).toBeDefined();
      const prArgs = prCreateCall?.[1] as string[];
      expect(prArgs[prArgs.indexOf("--title") + 1]).toBe(
        "refactor: use configured issue run defaults"
      );
      expect(prArgs[prArgs.indexOf("--base") + 1]).toBe("develop");
      expect(prArgs[prArgs.indexOf("--body") + 1]).toContain(`Closes #${issueNumber}`);
      expect(prArgs[prArgs.indexOf("--body") + 1]).toContain(
        "<!-- git-ai:pr-assistant:start -->"
      );
      expect(prArgs[prArgs.indexOf("--body") + 1]).toContain(
        "### Reviewer focus"
      );
    } finally {
      if (hadOriginalConfig && originalConfig !== undefined) {
        writeFileSync(configPath, originalConfig);
      } else {
        rmSync(configPath, { force: true });
      }
    }
  });

  it("fails issue preparation clearly when pulling the configured base branch fails", async () => {
    const issueNumber = 146;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Surface git pull failures during issue prep",
          body: "The issue workflow should stop if updating the base branch fails.",
          html_url: `https://github.com/DevwareUK/git-ai/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/git-ai.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "git" && args[0] === "rev-parse") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "main") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "pull") {
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          throw new Error("Issue branch should not be created after a failed pull.");
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "prepare", String(issueNumber)];

    await expect(run()).rejects.toThrow(
      'Failed to pull latest changes for base branch "main".'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when .git-ai/config.json contains malformed JSON", async () => {
    await withRepositoryConfig("{invalid-json", async () => {
      const { run } = await loadCli({
        analysisResult: createTestBacklogAnalysis(),
      });

      process.argv = ["node", "git-ai", "test-backlog", "--create-issues"];

      await expect(run()).rejects.toThrow("Failed to parse .git-ai/config.json");
    });
  });

  it("fails clearly when .git-ai/config.json contains an empty buildCommand", async () => {
    await withRepositoryConfig(
      JSON.stringify({ buildCommand: [] }, null, 2),
      async () => {
        const { run } = await loadCli({
          analysisResult: createTestBacklogAnalysis(),
        });

        process.argv = ["node", "git-ai", "test-backlog", "--create-issues"];

        await expect(run()).rejects.toThrow("Invalid .git-ai/config.json");
      }
    );
  });

  it("fails clearly when .git-ai/config.json contains an unsupported forge type", async () => {
    await withRepositoryConfig(
      JSON.stringify({ forge: { type: "gitlab" } }, null, 2),
      async () => {
        const { run } = await loadCli({
          analysisResult: createTestBacklogAnalysis(),
        });

        process.argv = ["node", "git-ai", "test-backlog", "--create-issues"];

        await expect(run()).rejects.toThrow("Invalid .git-ai/config.json");
      }
    );
  });

  it("fails full issue runs clearly when forge.type is none", async () => {
    await withRepositoryConfig(
      JSON.stringify({ forge: { type: "none" } }, null, 2),
      async () => {
        const { run } = await loadCli();

        process.argv = ["node", "git-ai", "issue", "42"];

        await expect(run()).rejects.toThrow(
          "Repository forge support is disabled by .git-ai/config.json"
        );
      }
    );
  });

  it("fails issue plan runs clearly when forge.type is none", async () => {
    await withRepositoryConfig(
      JSON.stringify({ forge: { type: "none" } }, null, 2),
      async () => {
        const { run } = await loadCli();

        process.argv = ["node", "git-ai", "issue", "plan", "42"];

        await expect(run()).rejects.toThrow(
          "Repository forge support is disabled by .git-ai/config.json"
        );
      }
    );
  });

  it("fails backlog issue creation clearly when forge.type is none", async () => {
    await withRepositoryConfig(
      JSON.stringify({ forge: { type: "none" } }, null, 2),
      async () => {
        const { run } = await loadCli({
          analysisResult: createTestBacklogAnalysis(),
        });

        process.argv = ["node", "git-ai", "test-backlog", "--create-issues"];

        await expect(run()).rejects.toThrow(
          "Repository forge support is disabled by .git-ai/config.json"
        );
      }
    );
  });

  it("skips draft issue creation with a clear message when forge.type is none", async () => {
    await withRepositoryConfig(
      JSON.stringify({ forge: { type: "none" } }, null, 2),
      async () => {
        const { run } = await loadCli({
          readlineAnswers: ["Unify PR assistant outputs."],
          spawnSyncImpl: (command, args) => {
            if (command === "codex" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "codex") {
              const { metadata } = readLatestRunMetadata();
              writeFileSync(
                resolve(REPO_ROOT, metadata.draftFile as string),
                "# Unify PR assistant outputs.\n\n## Summary\nKeep a single managed PR assistant section.\n",
                "utf8"
              );

              return { status: 0 };
            }

            throw new Error(`Unexpected spawnSync call: ${command}`);
          },
        });

        process.argv = ["node", "git-ai", "issue", "draft"];

        const messages: string[] = [];
        const stdout = captureStdout();
        vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
          messages.push(String(message ?? ""));
        });
        await run();

        const { runDir, metadata } = readLatestRunMetadata();
        cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "runs", runDir));
        if (metadata.draftFile) {
          cleanupTargets.add(resolve(REPO_ROOT, metadata.draftFile));
        }

        expect(messages.join("\n")).toContain(
          "Issue creation skipped because repository forge support is disabled by .git-ai/config.json."
        );
        expect(stdout.output()).toContain("Generated issue draft");
        expect(stdout.output()).toContain("# Unify PR assistant outputs.");
      }
    );
  });

  it("lets issue finalize review and modify the proposed commit message before committing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const { run, spawnSync, generateCommitMessage } = await loadCli({
      commitMessageResult: {
        title: "feat: propose issue finalize commit message",
        body: "Generated from the current diff.",
      },
      readlineAnswers: ["m", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,2 @@",
            '-const state = "before";',
            '+const state = "after";',
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command.startsWith("vim ")) {
          const [, quotedPath = ""] = command.match(/"([^"]+)"/) ?? [];
          writeFileSync(
            quotedPath,
            "feat: refine issue finalize commit message\n\nReviewed before commit.\n",
            "utf8"
          );
          return { status: 0 };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "finalize", "29"];
    const stdout = captureStdout();

    await run();

    const commitCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "commit"
    );
    expect(commitCall).toBeDefined();
    const commitArgs = commitCall?.[1] as string[];
    expect(commitArgs).toEqual(["commit", "-F", expect.stringContaining("commit-message.txt")]);
    expect(readFileSync(commitArgs[2], "utf8")).toContain(
      "feat: refine issue finalize commit message"
    );
    expect(stdout.output()).toContain("Proposed commit message");
    expect(generateCommitMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts')
    );
  });

  it("leaves issue finalize changes uncommitted when the reviewed message is declined", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,2 @@",
            '-const state = "before";',
            '+const state = "after";',
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "finalize", "29"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    expect(messages.join("\n")).toContain("Leaving the generated changes uncommitted.");
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          args[0] === "commit"
      )
    ).toBe(false);
  });

  it("fails issue finalize clearly when no generated changes exist", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "finalize", "29"];

    await expect(run()).rejects.toThrow(
      "The interactive runtime completed without producing any file changes to commit."
    );
  });
});
