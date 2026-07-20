import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterAll, afterEach, vi } from "vitest";
import {
  createIssuePlanWorkspace,
  createIssueRefineWorkspace,
  formatRunTimestamp,
  getIssuePlanRunDir,
  getIssueRefineSessionStateFilePath,
  getIssueRefineRunDir,
  loadIssueRefineSessionState,
  writeIssueRefineSessionState,
} from "./run-artifacts";
import { filterRepositoryPaths } from "../../core/src/path-filter";
import { DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS } from "../../core/src/repository-config";

const REPO_ROOT = createFixtureRepoRoot();
const ORIGINAL_ARGV = [...process.argv];
const cleanupTargets = new Set<string>();

function createFixtureRepoRoot(): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-cli-integration-repo-"));
  mkdirSync(resolve(repoRoot, ".git"), { recursive: true });
  mkdirSync(resolve(repoRoot, ".prs"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".git", "config"),
    [
      '[remote "origin"]',
      "\turl = git@github.com:DevwareUK/prs.git",
      "",
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    resolve(repoRoot, ".prs", "config.json"),
    "{\n  \"baseBranch\": \"main\",\n  \"buildCommand\": [\n    \"pnpm\",\n    \"build\"\n  ],\n  \"forge\": {\n    \"type\": \"github\"\n  },\n  \"ai\": {\n    \"issue\": {\n      \"useCodexSuperpowers\": true\n    },\n    \"runtime\": {\n      \"type\": \"codex\"\n    }\n  }\n}\n",
    "utf8"
  );
  mkdirSync(resolve(repoRoot, "packages", "cli", "src"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, "packages", "cli", "src", "index.ts"),
    Array.from(
      { length: 1250 },
      (_, index) => `// fixture source line ${index + 1}`
    ).join("\n") + "\n",
    "utf8"
  );
  return repoRoot;
}

vi.setConfig({ testTimeout: 20000 });

function getRepositoryIssueUrl(issueNumber: number): string {
  const gitEntryPath = resolve(REPO_ROOT, ".git");
  let gitConfigPath = resolve(gitEntryPath, "config");

  try {
    const gitEntryContents = readFileSync(gitEntryPath, "utf8").trim();
    const gitDirMatch = gitEntryContents.match(/^gitdir:\s*(.+)$/i);
    if (gitDirMatch?.[1]) {
      const gitDirPath = resolve(REPO_ROOT, gitDirMatch[1].trim());
      const commonDirPath = resolve(
        gitDirPath,
        readFileSync(resolve(gitDirPath, "commondir"), "utf8").trim()
      );

      gitConfigPath = existsSync(resolve(commonDirPath, "config"))
        ? resolve(commonDirPath, "config")
        : resolve(gitDirPath, "config");
    }
  } catch {
    // `.git` is usually a directory; fall back to `.git/config`.
  }

  const gitConfig = readFileSync(gitConfigPath, "utf8");
  const remoteSectionMatch = gitConfig.match(
    /\[remote\s+"origin"\][\s\S]*?url\s*=\s*(.+?)(?:\r?\n|$)/
  );
  const remoteUrl = remoteSectionMatch?.[1]?.trim();
  const repositorySlug = remoteUrl?.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];

  if (!repositorySlug) {
    throw new Error("Expected a GitHub origin remote for CLI integration fixtures.");
  }

  return `https://github.com/${repositorySlug}/issues/${issueNumber}`;
}

function buildManagedTestSuggestionBlock(options: {
  title: string;
  priority: "High" | "Medium" | "Low";
  value: string;
  addressed?: boolean;
  testType?: string;
  behavior?: string;
  regressionRisk?: string;
  protectedPaths?: string[];
  likelyLocations?: string[];
  edgeCases?: string[];
  implementationNote?: string;
}): string[] {
  const lines = [
    `#### ${options.title}`,
    ...(options.addressed === undefined
      ? []
      : [`- [${options.addressed ? "x" : " "}] Addressed`]),
    `- Priority: ${options.priority}`,
    `- Test type: ${options.testType ?? "integration"}`,
    `- Behavior covered: ${options.behavior ?? `${options.title} should stay covered.`}`,
    `- Regression risk: ${options.regressionRisk ?? `${options.title} can regress without focused tests.`}`,
    `- Why it matters: ${options.value}`,
  ];

  if (options.protectedPaths?.length) {
    lines.push(
      `- Protected paths: ${options.protectedPaths
        .map((path) => `\`${path}\``)
        .join(", ")}`
    );
  }

  if (options.likelyLocations?.length) {
    lines.push(
      `- Likely locations: ${options.likelyLocations
        .map((path) => `\`${path}\``)
        .join(", ")}`
    );
  }

  if (options.edgeCases?.length) {
    lines.push("- Edge cases:");
    lines.push(...options.edgeCases.map((edgeCase) => `  - ${edgeCase}`));
  }

  lines.push(
    `- Implementation note: ${
      options.implementationNote ?? `Add or extend tests for ${options.title.toLowerCase()}.`
    }`
  );

  return lines;
}

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
      frameworkRecommendation: {
        recommended: "Vitest",
        rationale: "Vitest fits package-level TypeScript and CLI integration tests.",
        alternatives: [
          "Jest is mature but more configuration-heavy for this workspace.",
          "node:test is minimal but less ergonomic for CLI coverage.",
        ],
      },
      ciIntegration: {
        status: "partial" as const,
        hasGitHubActions: true,
        workflows: [".github/workflows/ci.yml"],
        evidence: ["GitHub Actions workflow runs pnpm test"],
        notes: ["Issue orchestration paths are not covered yet."],
      },
    },
    notableCoverageGaps: [
      "No integration coverage for prs issue prepare/finalize.",
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
        issueTitle: "Add CLI integration coverage for prs issue prepare",
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
        issueTitle: "Add CLI integration coverage for prs test-backlog",
        issueBody: "Verify JSON and markdown output plus duplicate issue reuse logic.",
      },
      {
        id: "cli-issue-finalize",
        title: "Missing failure coverage for issue finalize",
        priority: "medium" as const,
        rationale: "Finalize should fail clearly when Codex has not produced changes.",
        suggestedTestTypes: ["integration", "cli"] as const,
        relatedPaths: ["packages/cli/src/index.ts"],
        issueTitle: "Add failure coverage for prs issue finalize",
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
    acceptanceCriteria: [
      "Users can explicitly refresh a managed issue plan comment when the issue changes.",
    ],
    likelyFiles: [
      "packages/cli/src/index.ts",
      "packages/cli/src/github.ts",
      "README.md",
    ],
    implementationSteps: [
      "Generate a structured plan from the GitHub issue title and body.",
      "Post the plan as a managed comment that collaborators can edit.",
    ],
    testPlan: [
      "Verify the plan comment is created on the issue.",
      "Ensure later issue runs load the edited plan into the issue snapshot.",
    ],
    risks: [
      "Regenerating the plan should not overwrite a manually edited comment by default.",
    ],
    doneDefinition: [
      "The managed issue plan comment reflects the latest explicitly requested refresh.",
    ],
    openQuestions: [
      "Whether future flows should diff the old and refreshed plan before applying it.",
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
        confidence: "medium" as const,
        category: "usability" as const,
        affectedFile: "README.md",
        body: "The onboarding path is better, but a new user still has to infer which commands are one-time setup versus normal operation.",
        whyThisMatters:
          "That ambiguity makes the first successful run harder than it needs to be.",
        suggestedFix:
          "Split install/configuration from the first successful run in the README flow.",
      },
    ],
    comments: [
      {
        path: "packages/cli/src/index.ts",
        line: 412,
        severity: "high" as const,
        confidence: "high" as const,
        category: "correctness" as const,
        affectedFile: "packages/cli/src/index.ts",
        body: "This path assumes the issue number flag was populated and will blow up on malformed input.",
        whyThisMatters:
          "Malformed input should fail as a clear validation error, not a downstream crash.",
        suggestedFix:
          "Validate the flag before using it so the CLI fails with a clear error.",
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
      issue?: { useCodexSuperpowers?: unknown };
      issueDraft?: { useCodexSuperpowers?: unknown };
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
    prReadiness?: { commands?: unknown };
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

  if (config.ai?.issueDraft !== undefined) {
    if (
      typeof config.ai.issueDraft !== "object" ||
      config.ai.issueDraft === null ||
      (config.ai.issueDraft.useCodexSuperpowers !== undefined &&
        typeof config.ai.issueDraft.useCodexSuperpowers !== "boolean")
    ) {
      throw new Error("ai.issueDraft.useCodexSuperpowers must be a boolean");
    }
  }

  if (config.ai?.issue !== undefined) {
    if (
      typeof config.ai.issue !== "object" ||
      config.ai.issue === null ||
      (config.ai.issue.useCodexSuperpowers !== undefined &&
        typeof config.ai.issue.useCodexSuperpowers !== "boolean")
    ) {
      throw new Error("ai.issue.useCodexSuperpowers must be a boolean");
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

  if (config.prReadiness?.commands !== undefined) {
    if (
      !Array.isArray(config.prReadiness.commands) ||
      config.prReadiness.commands.some((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return true;
        }
        const commandEntry = entry as { name?: unknown; command?: unknown };
        return (
          typeof commandEntry.name !== "string" ||
          commandEntry.name.trim().length === 0 ||
          !Array.isArray(commandEntry.command) ||
          commandEntry.command.length === 0 ||
          commandEntry.command.some(
            (segment) => typeof segment !== "string" || segment.trim().length === 0
          )
        );
      })
    ) {
      throw new Error("prReadiness.commands must contain named non-empty commands");
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

function parseJsonPayloadFromOutput<T>(output: string): T {
  const jsonStart = output.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`Expected JSON output but none was found:\n${output}`);
  }

  return JSON.parse(output.slice(jsonStart)) as T;
}

function isUnexpectedSpawnSyncCall(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("Unexpected spawnSync call:");
}

function isUnexpectedExecFileSyncCall(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("Unexpected execFileSync call:");
}

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
};

function createMockChildProcess(options: {
  status?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
} = {}): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  queueMicrotask(() => {
    if (options.stdout) {
      child.stdout.emit("data", Buffer.from(options.stdout));
    }
    if (options.stderr) {
      child.stderr.emit("data", Buffer.from(options.stderr));
    }
    if (options.error) {
      child.emit("error", options.error);
    }
    child.emit("close", options.status ?? 0, options.signal ?? null);
  });

  return child;
}

function isGitListUntrackedFilesCommand(command: string, args: string[]): boolean {
  return (
    command === "git" &&
    args[0] === "ls-files" &&
    args[1] === "--others" &&
    args[2] === "--exclude-standard"
  );
}

function isGitStatusPorcelainCommand(command: string, args: string[]): boolean {
  return command === "git" && args[0] === "status" && args[1] === "--porcelain";
}

function syntheticGitRefTip(ref: string): string {
  return `${ref.replace(/[^a-z0-9]+/gi, "-")}-tip`;
}

function listIssueDraftFiles(): string[] {
  try {
    return readdirSync(resolve(REPO_ROOT, ".prs", "issues"))
      .filter((entry) => entry.startsWith("issue-draft-") && entry.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

function listRunDirectories(): string[] {
  try {
    return readdirSync(resolve(REPO_ROOT, ".prs", "runs")).sort();
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
    ".prs",
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

function writeMockIssueWorktreeOutcome(options: {
  worktreePath: string;
  issueNumber: number;
  branchName: string;
  pullRequest:
    | { status: "created"; title: string; url: string }
    | { status: "skipped"; reason: "no-changes" };
}): void {
  const runDir = `.prs/runs/mock-issue-${options.issueNumber}`;
  const issueDir = `.prs/issues/${options.issueNumber}`;
  mkdirSync(resolve(options.worktreePath, runDir), { recursive: true });
  mkdirSync(resolve(options.worktreePath, issueDir), { recursive: true });
  writeFileSync(
    resolve(options.worktreePath, issueDir, "session.json"),
    `${JSON.stringify(
      {
        issueNumber: options.issueNumber,
        runtimeType: "codex",
        branchName: options.branchName,
        baseBranch: "main",
        configuredBaseBranch: "main",
        issueDir,
        runDir,
        promptFile: `${runDir}/prompt.md`,
        outputLog: `${runDir}/output.log`,
        executionMode: "unattended",
        createdAt: "2026-04-26T10:00:00.000Z",
        updatedAt: "2026-04-26T10:00:00.000Z",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    resolve(options.worktreePath, runDir, "metadata.json"),
    `${JSON.stringify(
      {
        outcome: {
          issueNumber: options.issueNumber,
          branchName: options.branchName,
          baseBranch: "main",
          runDir,
          committed: options.pullRequest.status === "created",
          pullRequest: options.pullRequest,
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function readLatestRunMetadata(): {
  runDir: string;
    metadata: {
      draftFile?: string;
      issueSetFile?: string;
      promptFile?: string;
      outputLog?: string;
      runDir?: string;
  };
} {
  const runDir = [...listRunDirectories()]
    .reverse()
    .find((entry) =>
      existsSync(resolve(REPO_ROOT, ".prs", "runs", entry, "metadata.json"))
    );
  if (!runDir) {
    throw new Error("Expected a run directory.");
  }

  const metadataPath = resolve(REPO_ROOT, ".prs", "runs", runDir, "metadata.json");
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

async function loadGitHubForge(options: {
  runtimeRepoRoot?: string;
  execFileSyncImpl?: (command: string, args: string[]) => string;
  spawnSyncImpl?: (
    command: string,
    args: string[],
    rawSecondArg?: unknown
  ) => { status: number; error?: Error; stdout?: string; stderr?: string };
  spawnImpl?: (
    command: string,
    args: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv }
  ) => MockChildProcess;
} = {}) {
  vi.resetModules();

  const execFileSync = vi.fn((command: string, args: string[]) => {
    if (
      command === "git" &&
      args[0] === "-C" &&
      args[2] === "remote" &&
      args[3] === "get-url" &&
      args[4] === "origin"
    ) {
      return options.execFileSyncImpl?.(command, args.slice(2)) ??
        "git@github.com:DevwareUK/prs.git\n";
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
    const normalizedArgs =
      command === "git" && args[0] === "-C" ? args.slice(2) : args;

    if (options.spawnSyncImpl) {
      return options.spawnSyncImpl(command, normalizedArgs, rawSecondArg);
    }

    if (command === "gh" && normalizedArgs[0] === "--version") {
      return { status: 1, error: new Error("gh is unavailable") };
    }

    if (command === "gh" && normalizedArgs[0] === "auth" && normalizedArgs[1] === "status") {
      return { status: 1, error: new Error("gh is unavailable") };
    }

    return { status: 0, stdout: "", stderr: "" };
  });

  vi.doMock("node:child_process", () => ({
    execFileSync,
    spawnSync,
  }));

  const module = await import("./github");

  return {
    createGitHubRepositoryForge: module.createGitHubRepositoryForge,
    execFileSync,
    spawnSync,
  };
}

function createMockCodexHome(): string {
  const codexHome = mkdtempSync(resolve(tmpdir(), "prs-codex-home-"));
  mkdirSync(resolve(codexHome, "sessions"), { recursive: true });
  cleanupTargets.add(codexHome);
  process.env.CODEX_HOME = codexHome;
  return codexHome;
}

function createMockCodexSuperpowersHome(): string {
  const codexHome = createMockCodexHome();
  const pluginRoot = resolve(
    codexHome,
    "plugins",
    "cache",
    "openai-curated",
    "superpowers",
    "test-version"
  );
  mkdirSync(resolve(pluginRoot, "skills", "brainstorming"), { recursive: true });
  mkdirSync(resolve(pluginRoot, "skills", "writing-plans"), { recursive: true });
  writeFileSync(resolve(pluginRoot, "skills", "brainstorming", "SKILL.md"), "# test\n");
  writeFileSync(resolve(pluginRoot, "skills", "writing-plans", "SKILL.md"), "# test\n");
  return codexHome;
}

function createTempRepoRoot(): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-refine-repo-"));
  mkdirSync(resolve(repoRoot, ".git"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".git", "config"),
    [
      '[remote "origin"]',
      "\turl = git@github.com:DevwareUK/prs.git",
      "",
    ].join("\n"),
    "utf8"
  );
  cleanupTargets.add(repoRoot);
  return repoRoot;
}

function createTempWorktreeRepoRoot(): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-refine-worktree-repo-"));
  const commonGitDir = resolve(repoRoot, ".git-common");
  const worktreeGitDir = resolve(commonGitDir, "worktrees", "refine-test");
  mkdirSync(worktreeGitDir, { recursive: true });
  writeFileSync(
    resolve(repoRoot, ".git"),
    "gitdir: .git-common/worktrees/refine-test\n",
    "utf8"
  );
  writeFileSync(resolve(worktreeGitDir, "commondir"), "../..\n", "utf8");
  writeFileSync(
    resolve(commonGitDir, "config"),
    [
      '[remote "origin"]',
      "\turl = git@github.com:DevwareUK/prs.git",
      "",
    ].join("\n"),
    "utf8"
  );
  cleanupTargets.add(repoRoot);
  return repoRoot;
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
  const configPath = resolve(REPO_ROOT, ".prs", "config.json");
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

function withoutRepositoryConfig(callback: () => Promise<void>): Promise<void> {
  const configPaths = [resolve(REPO_ROOT, ".prs", "config.json")] as const;
  const originals = configPaths.map((configPath) => ({
    configPath,
    existed: existsSync(configPath),
    contents: existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined,
  }));

  for (const { configPath } of originals) {
    rmSync(configPath, { force: true });
  }

  return callback().finally(() => {
    for (const { configPath, existed, contents } of originals) {
      if (existed && contents !== undefined) {
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, contents);
      } else {
        rmSync(configPath, { force: true });
      }
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
    riskAreas: string[];
    filesChanged: string[];
    testingNotes: string[];
    rolloutConcerns: string[];
    reviewerChecklist: string[];
  };
  prDescriptionResult?: {
    title: string;
    body: string;
  };
  prReviewResult?: ReturnType<typeof createPRReviewResult>;
  readlineAnswers?: string[];
  runtimeRepoRoot?: string;
  dotenvConfigImpl?: (options?: { path?: string; quiet?: boolean }) => {
    parsed?: Record<string, string>;
  };
  execFileSyncImpl?: (command: string, args: string[]) => string;
  spawnSyncImpl?: (
    command: string,
    args: string[],
    rawSecondArg?: unknown
  ) => { status: number; error?: Error; stdout?: string; stderr?: string };
} = {}) {
  vi.resetModules();
  process.env.PRS_DISABLE_AUTO_RUN = "1";

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
  } else {
    generateIssueResolutionPlan.mockResolvedValue(createIssueResolutionPlanResult());
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
      riskAreas: [],
      filesChanged: ["packages/cli/src/index.ts"],
      testingNotes: ["pnpm build"],
      rolloutConcerns: [],
      reviewerChecklist: [
        "Confirm the generated PR body and assistant section match the diff.",
      ],
    }
  );
  const generatePRDescription = vi.fn();
  generatePRDescription.mockResolvedValue(
    options.prDescriptionResult ?? {
      title: "feat: improve issue workflow authoring",
      body: [
        "Generate commit and pull request authoring from the completed issue diff.",
        "",
        "- Use deterministic local commit text for issue finalization.",
        "- Generate a concise PR description before opening the pull request.",
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
  const getConfiguredBaseBranch = () => {
    try {
      const parsed = JSON.parse(
        readFileSync(resolve(runtimeRepoRoot, ".prs", "config.json"), "utf8")
      ) as { baseBranch?: unknown };
      return typeof parsed.baseBranch === "string" && parsed.baseBranch.trim()
        ? parsed.baseBranch.trim()
        : "main";
    } catch {
      return "main";
    }
  };

  const execFileSync = vi.fn((command: string, args: string[]) => {
    if (
      command === "git" &&
      args[0] === "-C" &&
      args[2] === "rev-parse" &&
      args[3] === "--show-toplevel"
    ) {
      if (String(args[1]).includes(`${REPO_ROOT}/.prs/worktrees/`)) {
        return `${args[1]}\n`;
      }

      return `${runtimeRepoRoot}\n`;
    }

    if (options.execFileSyncImpl) {
      const normalizedArgs =
        command === "git" && args[0] === "-C" ? args.slice(2) : args;
      if (command === "git" && args[0] === "-C") {
        try {
          return options.execFileSyncImpl(command, normalizedArgs);
        } catch (error: unknown) {
          if (
            (isGitListUntrackedFilesCommand(command, normalizedArgs) ||
              isGitStatusPorcelainCommand(command, normalizedArgs)) &&
            isUnexpectedExecFileSyncCall(error)
          ) {
            return "";
          }

          throw error;
        }
      }

      try {
        return options.execFileSyncImpl(command, normalizedArgs);
      } catch (error: unknown) {
        if (
          (isGitListUntrackedFilesCommand(command, normalizedArgs) ||
            isGitStatusPorcelainCommand(command, normalizedArgs)) &&
          isUnexpectedExecFileSyncCall(error)
        ) {
          return "";
        }

        throw error;
      }
    }

    if (
      command === "git" &&
      args[0] === "-C" &&
      (isGitListUntrackedFilesCommand(command, args.slice(2)) ||
        isGitStatusPorcelainCommand(command, args.slice(2)))
    ) {
      return "";
    }

    if (
      isGitListUntrackedFilesCommand(command, args) ||
      isGitStatusPorcelainCommand(command, args)
    ) {
      return "";
    }

    throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
  });
  const spawnSync = vi.fn((command: string, rawSecondArg?: unknown) => {
    const args = Array.isArray(rawSecondArg) ? rawSecondArg : [];
    const normalizedArgs =
      command === "git" && args[0] === "-C" ? args.slice(2) : args;
    const invokeCustomSpawnSync = () =>
      options.spawnSyncImpl?.(command, normalizedArgs, rawSecondArg);

    if (
      (command === "/opt/homebrew/bin/gh" || command === "/usr/local/bin/gh") &&
      normalizedArgs[0] === "--version"
    ) {
      try {
        return invokeCustomSpawnSync() ?? {
          status: 1,
          error: new Error(`${command} unavailable`),
          stdout: "",
          stderr: "",
        };
      } catch (error: unknown) {
        if (!isUnexpectedSpawnSyncCall(error)) {
          throw error;
        }

        return {
          status: 1,
          error: new Error(`${command} unavailable`),
          stdout: "",
          stderr: "",
        };
      }
    }

    if (
      command !== "git" &&
      command !== "gh" &&
      command !== "codex" &&
      normalizedArgs[0] === "--version"
    ) {
      try {
        return invokeCustomSpawnSync() ?? { status: 0 };
      } catch (error: unknown) {
        if (!isUnexpectedSpawnSyncCall(error)) {
          throw error;
        }

        return { status: 0, stdout: "", stderr: "" };
      }
    }

    if (
      command === "git" &&
      normalizedArgs[0] === "rev-parse" &&
      normalizedArgs[1] === "--verify" &&
      typeof normalizedArgs[2] === "string" &&
      /^refs\/(heads|remotes)\//.test(normalizedArgs[2])
    ) {
      const requiresStdout = normalizedArgs[2].startsWith("refs/remotes/");
      try {
        const result = invokeCustomSpawnSync();
        if (
          result &&
          (result.error ||
            Boolean(result.stderr) ||
            (result.status === 0 &&
              (!requiresStdout || Boolean(result.stdout?.trim()))))
        ) {
          return result;
        }
      } catch (error: unknown) {
        if (!isUnexpectedSpawnSyncCall(error)) {
          throw error;
        }
      }

      return {
        status: 0,
        stdout: `${syntheticGitRefTip(normalizedArgs[2])}\n`,
        stderr: "",
      };
    }

    if (options.spawnSyncImpl) {
      try {
        return invokeCustomSpawnSync();
      } catch (error: unknown) {
        if (
          command === "git" &&
          normalizedArgs[0] === "branch" &&
          normalizedArgs[1] === "--show-current" &&
          isUnexpectedSpawnSyncCall(error)
        ) {
          return { status: 0, stdout: `${getConfiguredBaseBranch()}\n`, stderr: "" };
        }

        if (
          command === "git" &&
          normalizedArgs[0] === "status" &&
          normalizedArgs[1] === "--porcelain" &&
          isUnexpectedSpawnSyncCall(error)
        ) {
          if (options.execFileSyncImpl) {
            try {
              return {
                status: 0,
                stdout: options.execFileSyncImpl("git", normalizedArgs),
                stderr: "",
              };
            } catch (execError: unknown) {
              if (!isUnexpectedExecFileSyncCall(execError)) {
                throw execError;
              }
            }
          }

          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          normalizedArgs[0] === "rev-parse" &&
          (normalizedArgs[1] === getConfiguredBaseBranch() ||
            normalizedArgs[1] === `origin/${getConfiguredBaseBranch()}`) &&
          isUnexpectedSpawnSyncCall(error)
        ) {
          return {
            status: 0,
            stdout: `${getConfiguredBaseBranch()}-tip\n`,
            stderr: "",
          };
        }

        if (
          command === "git" &&
          normalizedArgs[0] === "fetch" &&
          normalizedArgs[1] === "origin" &&
          typeof normalizedArgs[2] === "string" &&
          isUnexpectedSpawnSyncCall(error)
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          normalizedArgs[0] === "merge-base" &&
          normalizedArgs[1] === "--is-ancestor" &&
          normalizedArgs[3] === "HEAD" &&
          isUnexpectedSpawnSyncCall(error)
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          normalizedArgs[0] === "worktree" &&
          normalizedArgs[1] === "add" &&
          normalizedArgs[2] === "--detach" &&
          typeof normalizedArgs[3] === "string" &&
          isUnexpectedSpawnSyncCall(error)
        ) {
          mkdirSync(normalizedArgs[3], { recursive: true });
          return { status: 0, stdout: "", stderr: "" };
        }

        throw error;
      }
    }

    return { status: 0 };
  });
  const spawn = vi.fn(
    (
      command: string,
      rawArgs?: unknown,
      rawOptions?: { cwd?: string; env?: NodeJS.ProcessEnv }
    ) => {
      const args = Array.isArray(rawArgs) ? rawArgs.map(String) : [];
      if (options.spawnImpl) {
        return options.spawnImpl(command, args, rawOptions ?? {});
      }

      return createMockChildProcess();
    }
  );
  const readlineAnswers = [...(options.readlineAnswers ?? [])];
  const createInterface = vi.fn(() => ({
    question: vi.fn(async () => readlineAnswers.shift() ?? ""),
    close: vi.fn(),
  }));

  vi.doMock("@prs/core", async () => {
    const issueTokenEstimate = await import("../../core/src/issue-token-estimate");
    const prAssistantBody = await import("../../core/src/pr-assistant-body");
    const prReviewRender = await import("../../core/src/pr-review-render");

    return {
    DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS:
      issueTokenEstimate.DEFAULT_ISSUE_ESTIMATE_COST_SETTINGS,
    DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION:
      issueTokenEstimate.DEFAULT_ISSUE_ESTIMATE_FALLBACK_MODEL_RATE_USD_PER_MILLION,
    DEFAULT_REPOSITORY_AI_CODEX_PREFER_SUBAGENTS: true,
    DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
    DEFAULT_REPOSITORY_BASE_BRANCH: "main",
    DEFAULT_REPOSITORY_BUILD_COMMAND: ["pnpm", "build"],
    analyzeFeatureBacklog,
    analyzeTestBacklog,
    buildPRAssistantSection: prAssistantBody.buildPRAssistantSection,
    estimateIssueImplementationTokens: issueTokenEstimate.estimateIssueImplementationTokens,
    extractIssueImplementationPlanFiles:
      issueTokenEstimate.extractIssueImplementationPlanFiles,
    filterRepositoryPaths,
    formatPRReviewMarkdown: prReviewRender.formatPRReviewMarkdown,
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
        codex?: { preferSubagents?: boolean };
        issue?: { useCodexSuperpowers?: boolean };
        issueDraft?: { useCodexSuperpowers?: boolean };
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
        codex: {
          preferSubagents: config?.ai?.codex?.preferSubagents ?? true,
        },
        issue: {
          useCodexSuperpowers:
            config?.ai?.issue?.useCodexSuperpowers ??
            config?.ai?.issueDraft?.useCodexSuperpowers ??
            false,
        },
        issueDraft: {
          useCodexSuperpowers:
            config?.ai?.issue?.useCodexSuperpowers ??
            config?.ai?.issueDraft?.useCodexSuperpowers ??
            false,
        },
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
  vi.doMock("@prs/contracts", () => ({
    UNATTENDED_GITHUB_OUTPUT_NOTE:
      "prs automation note: this GitHub-visible output was generated and posted by prs unattended automation.",
    applyGitHubOutputFraming: (body: string, mode = "manual") => {
      const note =
        "prs automation note: this GitHub-visible output was generated and posted by prs unattended automation.";
      const stripped = `${body
        .split(/\r?\n/)
        .filter((line) => line.trim() !== note)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()}\n`;
      if (mode !== "unattended") {
        return stripped;
      }
      const lines = stripped.trimEnd().split(/\r?\n/);
      if (/^<!--\s*prs:[^>]+-->$/.test(lines[0]?.trim() ?? "")) {
        const rest = lines.slice(1);
        while (rest[0]?.trim() === "") {
          rest.shift();
        }
        return [lines[0], "", note, "", ...rest].join("\n") + "\n";
      }
      return [note, "", ...lines].join("\n") + "\n";
    },
    DEFAULT_PR_IMPACT_PROFILE: {
      riskLevel: "none",
      riskReasons: [],
      affectedAreas: [],
      rolloutImpact: [],
      migrationImpact: [],
      configurationImpact: [],
      flags: {
        security: false,
        performance: false,
      },
      manualVerification: [],
    },
    includesManagedMarker: (body: string, markers: string[]) =>
      markers.some((marker) => body.includes(marker)),
    startsWithManagedMarker: (body: string, markers: string[]) => {
      const firstContentLine = body
        .split(/\r?\n/)
        .find((line) => line.trim().length > 0);
      return markers.some((marker) => firstContentLine?.trim() === marker);
    },
    ISSUE_PLAN_COMMENT_MARKER: "<!-- prs:issue-plan -->",
    ISSUE_SPEC_COMMENT_MARKER: "<!-- prs:issue-spec -->",
    TEST_SUGGESTIONS_COMMENT_MARKER: "<!-- prs:test-suggestions -->",
    IssueDraftSet: {
      parse: (value: unknown) => {
        const manifest = value as {
          version?: unknown;
          mode?: unknown;
          sourceIssueNumber?: unknown;
          linkingStrategy?: unknown;
          issues?: Array<{
            id?: unknown;
            draftFile?: unknown;
            dependsOn?: unknown;
            blocks?: unknown;
            related?: unknown;
          }>;
        };

        if (
          manifest.version !== 1 ||
          (manifest.mode !== "single" && manifest.mode !== "multiple") ||
          !Array.isArray(manifest.issues) ||
          manifest.issues.length === 0
        ) {
          throw new Error("Invalid issue set manifest.");
        }

        if (manifest.mode === "multiple" && manifest.issues.length < 2) {
          throw new Error("multiple issue sets require at least two issues");
        }

        const ids = new Set<string>();
        const normalizedIssues = manifest.issues.map((issue) => {
          if (typeof issue.id !== "string" || !issue.id.trim()) {
            throw new Error("issue id must be non-empty");
          }
          if (typeof issue.draftFile !== "string" || !issue.draftFile.trim()) {
            throw new Error("draftFile must be non-empty");
          }
          const id = issue.id.trim();
          if (ids.has(id)) {
            throw new Error(`duplicate issue id "${id}"`);
          }
          ids.add(id);

          return {
            id,
            draftFile: issue.draftFile.trim(),
            dependsOn: Array.isArray(issue.dependsOn) ? issue.dependsOn : [],
            blocks: Array.isArray(issue.blocks) ? issue.blocks : [],
            related: Array.isArray(issue.related) ? issue.related : [],
          };
        });

        for (const issue of normalizedIssues) {
          for (const target of [...issue.dependsOn, ...issue.blocks, ...issue.related]) {
            if (typeof target !== "string" || !ids.has(target)) {
              throw new Error(`issue "${issue.id}" references unknown issue "${target}"`);
            }
          }
        }

        return {
          version: 1 as const,
          mode: manifest.mode,
          ...(typeof manifest.sourceIssueNumber === "number"
            ? { sourceIssueNumber: manifest.sourceIssueNumber }
            : {}),
          ...(typeof manifest.linkingStrategy === "string"
            ? { linkingStrategy: manifest.linkingStrategy.trim() }
            : {}),
          issues: normalizedIssues,
        };
      },
    },
    PRODUCT_SHORT_NAME: "prs",
    PR_ASSISTANT_END_MARKER: "<!-- prs:pr-assistant:end -->",
    PR_ASSISTANT_START_MARKER: "<!-- prs:pr-assistant:start -->",
    PRImpactProfile: {
      parse: (value?: unknown) => {
        const profile = value && typeof value === "object" ? value as {
          riskLevel?: unknown;
          riskReasons?: unknown;
          affectedAreas?: unknown;
          rolloutImpact?: unknown;
          migrationImpact?: unknown;
          configurationImpact?: unknown;
          flags?: unknown;
          manualVerification?: unknown;
        } : {};
        const flags = profile.flags && typeof profile.flags === "object"
          ? profile.flags as { security?: unknown; performance?: unknown }
          : {};

        return {
          riskLevel:
            profile.riskLevel === "low" ||
            profile.riskLevel === "medium" ||
            profile.riskLevel === "high"
              ? profile.riskLevel
              : "none",
          riskReasons: Array.isArray(profile.riskReasons)
            ? profile.riskReasons.filter((item): item is string => typeof item === "string")
            : [],
          affectedAreas: Array.isArray(profile.affectedAreas)
            ? profile.affectedAreas.filter((item): item is string => typeof item === "string")
            : [],
          rolloutImpact: Array.isArray(profile.rolloutImpact)
            ? profile.rolloutImpact.filter((item): item is string => typeof item === "string")
            : [],
          migrationImpact: Array.isArray(profile.migrationImpact)
            ? profile.migrationImpact.filter((item): item is string => typeof item === "string")
            : [],
          configurationImpact: Array.isArray(profile.configurationImpact)
            ? profile.configurationImpact.filter((item): item is string => typeof item === "string")
            : [],
          flags: {
            security: flags.security === true,
            performance: flags.performance === true,
          },
          manualVerification: Array.isArray(profile.manualVerification)
            ? profile.manualVerification.filter((item): item is string => typeof item === "string")
            : [],
        };
      },
    },
    REPOSITORY_CONFIG_RELATIVE_PATH: ".prs/config.json",
    REPOSITORY_STATE_DIRECTORY: ".prs",
    GENERATED_BY_SETUP_HEADER: "# Generated by prs setup",
    SETUP_SECTION_END: "<!-- prs:setup:end -->",
    SETUP_SECTION_START: "<!-- prs:setup:start -->",
    RepositoryConfig: {
      parse: vi.fn((value?: unknown) => parseMockRepositoryConfig(value)),
    },
  }));
  vi.doMock("@prs/providers", () => ({
    createProviderFromConfig: vi.fn(
      async (
        config: { type: string; model?: string },
        environment: {
          openaiApiKey?: string;
          openaiModel?: string;
          openaiBaseUrl?: string;
          awsRegion?: string;
          awsDefaultRegion?: string;
        },
        options: { modelOverride?: string } = {}
      ) => {
        const requestedModel = options.modelOverride?.trim();
        const resolvedModel = requestedModel ?? config.model;
        if (config.type === "openai") {
          if (!environment.openaiApiKey) {
            throw new Error(
              "OpenAI provider requires OPENAI_API_KEY. Set it in your environment or in a .env file."
            );
          }

          return {
            providerType: "openai",
            model: resolvedModel ?? environment.openaiModel,
          };
        }

        const region = environment.awsRegion ?? environment.awsDefaultRegion;
        if (!resolvedModel?.trim()) {
          throw new Error(
            "Bedrock Claude provider requires an explicit model in `.prs/config.json` under `ai.provider.model`."
          );
        }

        if (!region && !(config as { region?: string }).region) {
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
          model: resolvedModel ?? undefined,
          region,
        };
      }
    ),
    readProviderEnvironment: vi.fn(() => ({
      openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
      openaiModel: process.env.OPENAI_MODEL?.trim() || undefined,
      openaiBaseUrl: process.env.OPENAI_BASE_URL?.trim() || undefined,
      awsRegion: process.env.AWS_REGION?.trim() || undefined,
      awsDefaultRegion: process.env.AWS_DEFAULT_REGION?.trim() || undefined,
    })),
  }));
  const dotenvConfig = options.dotenvConfigImpl ?? vi.fn(() => ({ parsed: {} }));
  vi.doMock("dotenv", () => ({
    default: {
      config: dotenvConfig,
    },
    config: dotenvConfig,
  }));
  vi.doMock("node:child_process", () => ({
    execFileSync,
    spawn,
    spawnSync,
  }));
  vi.doMock("node:readline/promises", () => ({
    createInterface,
  }));

  const module = await import("./index");

  return {
    readReviewDiffForAutomation: module.readReviewDiffForAutomation,
    run: module.run,
    extractIssuePlanLikelyFiles: module.extractIssuePlanLikelyFiles,
    findOverlappingPullRequests: module.findOverlappingPullRequests,
    recommendIssueBranchBase: module.recommendIssueBranchBase,
    parseFeatureBacklogCommandArgs: module.parseFeatureBacklogCommandArgs,
    parseAuditCommandArgs: module.parseAuditCommandArgs,
    parseCodexCommand: module.parseCodexCommand,
    parseIssueCommandArgs: module.parseIssueCommandArgs,
    parsePrCommandArgs: module.parsePrCommandArgs,
    parseReviewCommandArgs: module.parseReviewCommandArgs,
    parseSetupCommandArgs: module.parseSetupCommandArgs,
    parseUpdateCommandArgs: module.parseUpdateCommandArgs,
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
    spawn,
    spawnSync,
    createInterface,
  };
}

afterAll(() => {
  rmSync(REPO_ROOT, { recursive: true, force: true });
});

afterEach(() => {
  process.argv = [...ORIGINAL_ARGV];
  delete process.env.PRS_DISABLE_AUTO_RUN;
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

export {
  REPO_ROOT,
  cleanupTargets,
  createIssuePlanWorkspace,
  createIssueRefineWorkspace,
  formatRunTimestamp,
  getIssuePlanRunDir,
  getIssueRefineRunDir,
  getIssueRefineSessionStateFilePath,
  loadIssueRefineSessionState,
  writeIssueRefineSessionState,
  getRepositoryIssueUrl,
  buildManagedTestSuggestionBlock,
  createTestBacklogAnalysis,
  createFeatureBacklogAnalysis,
  createIssueDraftResult,
  createIssueDraftGuidanceReadyResult,
  createIssueDraftGuidanceClarifyResult,
  createIssueResolutionPlanResult,
  createPRReviewResult,
  createFetchResponse,
  captureStdout,
  parseJsonPayloadFromOutput,
  createMockChildProcess,
  listIssueDraftFiles,
  listRunDirectories,
  readIssueBatchState,
  writeMockIssueWorktreeOutcome,
  readLatestRunMetadata,
  loadGitHubForge,
  createMockCodexHome,
  createMockCodexSuperpowersHome,
  createTempRepoRoot,
  createTempWorktreeRepoRoot,
  writeMockCodexSession,
  withRepositoryConfig,
  withoutRepositoryConfig,
  loadCli,
};
