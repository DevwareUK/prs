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
    aiContext?: { excludePaths?: unknown };
    baseBranch?: unknown;
    buildCommand?: unknown;
    forge?: { type?: unknown };
  };

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
  if (options.commitMessageResult) {
    generateCommitMessage.mockResolvedValue(options.commitMessageResult);
  }
  const generateDiffSummary = vi.fn();
  if (options.diffSummaryResult) {
    generateDiffSummary.mockResolvedValue(options.diffSummaryResult);
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

  vi.doMock("@git-ai/core", () => ({
    DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
    DEFAULT_REPOSITORY_BASE_BRANCH: "main",
    DEFAULT_REPOSITORY_BUILD_COMMAND: ["pnpm", "build"],
    analyzeFeatureBacklog,
    analyzeTestBacklog,
    filterRepositoryPaths,
    generateCommitMessage,
    generateDiffSummary,
    generateIssueDraft,
    generateIssueDraftGuidance,
    generatePRReview,
    generateIssueResolutionPlan,
    resolveRepositoryConfig: vi.fn((config?: {
      aiContext?: { excludePaths?: string[] };
      baseBranch?: string;
      buildCommand?: string[];
      forge?: { type?: "github" | "none" };
    }) => ({
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
  }));
  vi.doMock("@git-ai/contracts", () => ({
    RepositoryConfig: {
      parse: vi.fn((value?: unknown) => parseMockRepositoryConfig(value)),
    },
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
    generatePRReview,
    generateIssueResolutionPlan,
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
    expect(readFileSync(promptFilePath, "utf8")).toContain("[2] Commit changes");
    expect(readFileSync(outputLogPath, "utf8")).toContain("# git-ai pr fix-comments run log");
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
      ["commit", "-m", "fix: address PR review comments for #88"],
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
    expect(readFileSync(promptFilePath, "utf8")).toContain("[2] Commit changes");
    expect(readFileSync(outputLogPath, "utf8")).toContain("# git-ai pr fix-tests run log");
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
      ["commit", "-m", "test: address AI test suggestions for PR #91"],
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

  it("generates a local issue draft and saves it under .git-ai/issues", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const issueDraft = createIssueDraftResult();
    const { run, generateIssueDraft, generateIssueDraftGuidance } = await loadCli({
      issueDraftResult: issueDraft,
      issueDraftGuidanceResults: [createIssueDraftGuidanceReadyResult()],
      readlineAnswers: [
        "Combine PR description and review summary into a single PR assistant action.",
        "Should update the PR body rather than replacing it.",
      ],
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command.startsWith("vim ")) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.argv = ["node", "git-ai", "issue", "draft"];

    await run();

    expect(generateIssueDraftGuidance).toHaveBeenCalledWith(expect.any(Object), {
      featureIdea: "Combine PR description and review summary into a single PR assistant action.",
      additionalContext: "Should update the PR body rather than replacing it.",
      repositoryContext: expect.stringContaining("README.md excerpt:"),
      answers: [],
    });
    expect(generateIssueDraft).toHaveBeenCalledWith(expect.any(Object), {
      featureIdea: "Combine PR description and review summary into a single PR assistant action.",
      additionalContext: "Should update the PR body rather than replacing it.",
      repositoryContext: expect.stringContaining("README.md excerpt:"),
      clarificationTranscript: undefined,
    });

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();

    const createdDraftPath = resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string);
    cleanupTargets.add(createdDraftPath);

    const content = readFileSync(createdDraftPath, "utf8");
    expect(content).toContain(`# ${issueDraft.title}`);
    expect(content).toContain("## Summary");
    expect(content).toContain("## Proposed behavior");
    expect(content).toContain("- Do not overwrite non-managed PR body content.");
  });

  it("creates a GitHub issue from the reviewed draft only after confirmation", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const issueDraft = createIssueDraftResult();
    const { run, execFileSync } = await loadCli({
      issueDraftResult: issueDraft,
      issueDraftGuidanceResults: [createIssueDraftGuidanceReadyResult()],
      readlineAnswers: ["Unify PR assistant outputs.", "", "y"],
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
        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command.startsWith("vim ")) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.argv = ["node", "git-ai", "issue", "draft"];

    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));

    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        "DevwareUK/git-ai",
        "--title",
        issueDraft.title,
        "--body",
        expect.stringContaining("## Summary"),
      ],
      expect.any(Object)
    );
  });

  it("asks iterative clarification questions before drafting when the issue is underspecified", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const issueDraft = createIssueDraftResult();
    const { run, generateIssueDraft, generateIssueDraftGuidance } = await loadCli({
      issueDraftResult: issueDraft,
      issueDraftGuidanceResults: [
        createIssueDraftGuidanceClarifyResult(),
        createIssueDraftGuidanceReadyResult(),
      ],
      readlineAnswers: [
        "Turn issue draft into a guided specification workflow.",
        "",
        "Keep the current sections for now, but add technical considerations if the model has concrete ones.",
      ],
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command.startsWith("vim ")) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.argv = ["node", "git-ai", "issue", "draft"];

    await run();

    expect(generateIssueDraftGuidance).toHaveBeenNthCalledWith(1, expect.any(Object), {
      featureIdea: "Turn issue draft into a guided specification workflow.",
      additionalContext: undefined,
      repositoryContext: expect.stringContaining("README.md excerpt:"),
      answers: [],
    });
    expect(generateIssueDraftGuidance).toHaveBeenNthCalledWith(2, expect.any(Object), {
      featureIdea: "Turn issue draft into a guided specification workflow.",
      additionalContext: undefined,
      repositoryContext: expect.stringContaining("README.md excerpt:"),
      answers: [
        {
          question:
            "Should the guided flow keep the current markdown sections, or should it add sections like out of scope and technical considerations?",
          answer:
            "Keep the current sections for now, but add technical considerations if the model has concrete ones.",
        },
      ],
    });
    expect(generateIssueDraft).toHaveBeenCalledWith(expect.any(Object), {
      featureIdea: "Turn issue draft into a guided specification workflow.",
      additionalContext: undefined,
      repositoryContext: expect.stringContaining("README.md excerpt:"),
      clarificationTranscript: expect.stringContaining(
        "Keep the current sections for now, but add technical considerations if the model has concrete ones."
      ),
    });

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));
  });

  it("creates a draft issue with a GitHub token when gh is unavailable", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const issueDraft = createIssueDraftResult();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 109,
        title: issueDraft.title,
        html_url: "https://github.com/DevwareUK/git-ai/issues/109",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      issueDraftResult: issueDraft,
      issueDraftGuidanceResults: [createIssueDraftGuidanceReadyResult()],
      readlineAnswers: ["Unify PR assistant outputs.", "", "y"],
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

        if (command.startsWith("vim ")) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "git-ai", "issue", "draft"];

    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".git-ai", "issues", createdDraft as string));

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
      title: issueDraft.title,
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
          return { status: 1 };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
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

    expect(output.branchName).toBe("feat/issue-91234-cli-issue-prepare-integration-fixture");
    expect(output.mode).toBe("github-action");
    expect(readFileSync(issueFilePath, "utf8")).toContain(`- Issue number: ${issueNumber}`);
    expect(readFileSync(issueFilePath, "utf8")).toContain(`- Title: ${issueTitle}`);
    expect(readFileSync(issueFilePath, "utf8")).toContain("## Resolution Plan");
    expect(readFileSync(issueFilePath, "utf8")).toContain("Edited plan from GitHub.");
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      "You are running inside a GitHub Actions workflow via Codex."
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
    expect(JSON.parse(readFileSync(metadataFilePath, "utf8"))).toMatchObject({
      completionFile: `${output.runDir}/codex-result.json`,
    });
    expect(readFileSync(githubOutputPath, "utf8")).toContain("branch_name<<");
    expect(readFileSync(githubOutputPath, "utf8")).toContain(output.branchName);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("writes local issue prompts that exit Codex immediately after /commit", async () => {
    const issueNumber = 91235;
    const issueTitle = "Local issue prompt exits after commit selection";

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
      '[2] Commit & create PR'
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      'for `/commit`, write `{"action":"commit"}` and then exit Codex immediately so `git-ai` can resume the build, commit, and PR flow'
    );
    expect(readFileSync(promptFilePath, "utf8")).toContain(
      'for `/exit`, write `{"action":"exit"}` and then exit Codex immediately'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips build, commit, and PR creation when Codex exits a full issue run", async () => {
    const issueNumber = 145;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Respect exit from interactive issue runs",
          body: "The outer issue workflow should not auto-commit after /exit.",
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

        if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
          return { status: 0 };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const latestRunDir = listRunDirectories().at(-1);
          if (!latestRunDir) {
            throw new Error("Expected an issue run directory before launching Codex.");
          }

          writeFileSync(
            resolve(REPO_ROOT, ".git-ai", "runs", latestRunDir, "codex-result.json"),
            `${JSON.stringify({ action: "exit" })}\n`
          );

          return { status: 0 };
        }

        if (
          command === "pnpm" ||
          (command === "git" && ["add", "commit", "push"].includes(args[0] ?? "")) ||
          (command === "gh" && args[0] === "pr" && args[1] === "create")
        ) {
          throw new Error(`Unexpected post-exit command: ${command} ${args.join(" ")}`);
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses repository config for issue build verification and pull request base branch", async () => {
    const issueNumber = 144;
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

    try {
      const { run, spawnSync } = await loadCli({
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

          if (command === "git" && args[0] === "checkout" && args[1] === "-b") {
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

      expect(spawnSync).toHaveBeenCalledWith(
        "npm",
        ["run", "verify"],
        expect.objectContaining({
          encoding: "utf8",
        })
      );
      expect(spawnSync).toHaveBeenCalledWith(
        "gh",
        [
          "pr",
          "create",
          "--title",
          "Fix: Use repository config in issue runs",
          "--body",
          `Closes #${issueNumber}`,
          "--base",
          "develop",
        ],
        expect.objectContaining({
          encoding: "utf8",
        })
      );
    } finally {
      if (hadOriginalConfig && originalConfig !== undefined) {
        writeFileSync(configPath, originalConfig);
      } else {
        rmSync(configPath, { force: true });
      }
    }
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
        const issueDraft = createIssueDraftResult();
        const { run } = await loadCli({
          issueDraftResult: issueDraft,
          issueDraftGuidanceResults: [createIssueDraftGuidanceReadyResult()],
          readlineAnswers: ["Unify PR assistant outputs.", ""],
          spawnSyncImpl: (command) => {
            if (command.startsWith("vim ")) {
              return { status: 0 };
            }

            throw new Error(`Unexpected spawnSync call: ${command}`);
          },
        });

        process.env.OPENAI_API_KEY = "test-key";
        process.argv = ["node", "git-ai", "issue", "draft"];

        const messages: string[] = [];
        vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
          messages.push(String(message ?? ""));
        });
        await run();

        expect(messages.join("\n")).toContain(
          "Issue creation skipped because repository forge support is disabled by .git-ai/config.json."
        );
      }
    );
  });

  it("fails issue finalize clearly when no generated changes exist", async () => {
    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "git-ai", "issue", "finalize", "29"];

    await expect(run()).rejects.toThrow(
      "Codex completed without producing any file changes to commit."
    );
  });
});
