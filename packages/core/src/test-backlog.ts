import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import {
  TestBacklogInput,
  TestBacklogOutput,
  type CiIntegrationAssessmentType,
  type CurrentTestingSetupType,
  type FrameworkRecommendationType,
  type TestBacklogFindingType,
  type TestBacklogInputType,
  type TestBacklogOutputType,
} from "@prs/contracts";
import { createRepositoryPathMatcher } from "./path-filter";
import { resolveRepositoryConfig } from "./repository-config";

type PackageJson = {
  path: string;
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type WorkflowFile = {
  path: string;
  content: string;
};

type RepositorySnapshot = {
  allFiles: string[];
  packageJsons: PackageJson[];
  sourceFiles: string[];
  testFiles: string[];
  workflowFiles: WorkflowFile[];
  workflowPaths: string[];
  actionDirs: string[];
  packageDirs: string[];
  rootHasAction: boolean;
  rootHasCli: boolean;
};

type Component = {
  id: string;
  title: string;
  issueTitle: string;
  kind: "cli" | "core" | "contracts" | "providers" | "actions" | "workflow";
  relatedPaths: string[];
  coverageEvidence: string | undefined;
  rationale: string;
  repoFit: string;
  implementationPlan: string[];
  starterTests: string[];
  acceptanceCriteria: string[];
  suggestedTestTypes: Array<"unit" | "integration" | "smoke" | "cli" | "workflow">;
};

type FindingDraft = Omit<TestBacklogFindingType, "issueBody"> & {
  issueSummary: string;
  repoFit: string;
  implementationPlan: string[];
  starterTests: string[];
  acceptanceCriteria: string[];
  alternatives?: string[];
};

type LocalTestingSetup = Omit<CurrentTestingSetupType, "ciIntegration">;

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".prs",
  ".prs",
  "node_modules",
  "dist",
  "coverage",
  "build",
  ".next",
  ".turbo",
  ".cache",
]);

const TEST_CONFIG_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /^vitest\.config\./, name: "Vitest config" },
  { pattern: /^jest\.config\./, name: "Jest config" },
  { pattern: /^playwright\.config\./, name: "Playwright config" },
  { pattern: /^cypress\.config\./, name: "Cypress config" },
  { pattern: /^ava\.config\./, name: "AVA config" },
];

const FRAMEWORK_DEPENDENCIES: Record<string, string> = {
  vitest: "Vitest",
  jest: "Jest",
  "@jest/globals": "Jest",
  mocha: "Mocha",
  ava: "AVA",
  tap: "TAP",
  uvu: "uvu",
  playwright: "Playwright",
  "@playwright/test": "Playwright",
  cypress: "Cypress",
  supertest: "Supertest",
};

const UNIT_TEST_FRAMEWORKS = new Set(["Vitest", "Jest", "Mocha", "AVA", "TAP", "uvu", "node:test"]);
const BROWSER_TEST_FRAMEWORKS = new Set(["Playwright", "Cypress"]);
const CI_TEST_COMMAND_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bpnpm\s+(?:exec\s+)?vitest\b/i, label: "Vitest command" },
  { pattern: /\bpnpm\s+test(?:\s|$)/i, label: "pnpm test script" },
  { pattern: /\bnpm\s+(?:run\s+)?test(?:\s|$)/i, label: "npm test script" },
  { pattern: /\byarn\s+test(?:\s|$)/i, label: "yarn test script" },
  { pattern: /\bbun\s+test(?:\s|$)/i, label: "bun test script" },
  { pattern: /\bjest\b/i, label: "Jest command" },
  { pattern: /\bplaywright\s+test\b/i, label: "Playwright command" },
  { pattern: /\bcypress\s+run\b/i, label: "Cypress command" },
  { pattern: /\bnode\s+--test\b/i, label: "node:test command" },
];

function normalizePath(filePath: string): string {
  return filePath.split("\\").join("/");
}

function isTestFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const segments = normalized.split("/");
  if (segments.includes("test") || segments.includes("tests") || segments.includes("__tests__")) {
    return true;
  }

  return /\.(test|spec)\.[^./]+$/i.test(normalized);
}

function isSourceFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  if (isTestFile(normalized)) {
    return false;
  }

  return /(^|\/)(src|lib|app|server|packages|actions)\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(
    normalized
  );
}

function walkFiles(
  rootDir: string,
  matchesExcludedPath: (filePath: string) => boolean,
  currentDir = rootDir
): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = resolve(currentDir, entry.name);
    const relativePath = normalizePath(relative(rootDir, absolutePath));

    if (entry.isDirectory()) {
      if (
        SKIP_DIRECTORIES.has(entry.name) ||
        matchesExcludedPath(relativePath) ||
        matchesExcludedPath(`${relativePath}/`)
      ) {
        continue;
      }

      files.push(...walkFiles(rootDir, matchesExcludedPath, absolutePath));
      continue;
    }

    if (!entry.isFile() || matchesExcludedPath(relativePath)) {
      continue;
    }

    files.push(relativePath);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function readJsonFile<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function readTextFile(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function collectPackageJsons(repoRoot: string, allFiles: string[]): PackageJson[] {
  return allFiles
    .filter((filePath) => basename(filePath) === "package.json")
    .map((relativePath) => {
      const payload = readJsonFile<PackageJson>(resolve(repoRoot, relativePath));
      return payload
        ? {
            ...payload,
            path: relativePath,
          }
        : undefined;
    })
    .filter((value): value is PackageJson => Boolean(value));
}

function collectFrameworkEvidence(
  snapshot: RepositorySnapshot
): { frameworks: string[]; evidence: string[] } {
  const frameworks = new Set<string>();
  const evidence = new Set<string>();

  for (const packageJson of snapshot.packageJsons) {
    const deps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    };

    for (const [dependency, displayName] of Object.entries(FRAMEWORK_DEPENDENCIES)) {
      if (deps[dependency]) {
        frameworks.add(displayName);
        evidence.add(`${displayName} dependency in ${packageJson.path}`);
      }
    }

    for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
      if (!/^test(?::|$)/.test(scriptName)) {
        continue;
      }

      evidence.add(`test script "${scriptName}" in ${packageJson.path}`);
      if (command.includes("vitest")) {
        frameworks.add("Vitest");
      }
      if (command.includes("jest")) {
        frameworks.add("Jest");
      }
      if (command.includes("playwright")) {
        frameworks.add("Playwright");
      }
      if (command.includes("cypress")) {
        frameworks.add("Cypress");
      }
      if (command.includes("--test") || command.includes("node:test")) {
        frameworks.add("node:test");
      }
    }
  }

  for (const filePath of snapshot.allFiles) {
    const fileName = basename(filePath);
    for (const configPattern of TEST_CONFIG_PATTERNS) {
      if (configPattern.pattern.test(fileName)) {
        frameworks.add(configPattern.name.replace(" config", ""));
        evidence.add(`${configPattern.name} found at ${filePath}`);
      }
    }
  }

  if (snapshot.testFiles.length > 0 && frameworks.size === 0) {
    frameworks.add("Custom/unknown");
    evidence.add(
      `${snapshot.testFiles.length} test file${
        snapshot.testFiles.length === 1 ? "" : "s"
      } found without a recognized framework`
    );
  }

  return {
    frameworks: [...frameworks].sort((left, right) => left.localeCompare(right)),
    evidence: [...evidence].sort((left, right) => left.localeCompare(right)),
  };
}

function recommendFramework(
  snapshot: RepositorySnapshot,
  frameworks: string[]
): FrameworkRecommendationType | undefined {
  const hasUnitFramework = frameworks.some((framework) => UNIT_TEST_FRAMEWORKS.has(framework));
  if (hasUnitFramework) {
    return undefined;
  }

  const hasBrowserOnlyFramework = frameworks.some((framework) => BROWSER_TEST_FRAMEWORKS.has(framework));
  const tsSourceCount = snapshot.sourceFiles.filter((filePath) => /\.(ts|tsx)$/.test(filePath)).length;
  const monorepoSurfaceCount = snapshot.packageDirs.length + snapshot.actionDirs.length;

  return {
    recommended: "Vitest",
    rationale: hasBrowserOnlyFramework
      ? "The repository appears to rely on browser or workflow tooling without a lightweight unit-test runner. Vitest is the best complement because it adds fast TypeScript-friendly unit and integration coverage without replacing existing end-to-end tools."
      : [
          tsSourceCount > 0
            ? "The repository is TypeScript-heavy, so Vitest fits the existing source layout with minimal setup."
            : "The repository is JavaScript-oriented, and Vitest still provides a low-friction default for unit and integration coverage.",
          monorepoSurfaceCount > 2
            ? "Its fast startup and workspace-friendly configuration make it a strong default for a pnpm monorepo with multiple packages and GitHub Actions entrypoints."
            : "It is a practical default because it covers unit, smoke, and lightweight integration cases without pushing the repo into a heavier test stack on day one.",
        ].join(" "),
    alternatives: [
      "Jest is mature and familiar, but it adds more configuration overhead for this TypeScript-first workspace without a clear benefit over Vitest here.",
      "node:test keeps dependencies minimal, but you would need more manual mocking, assertions, and ergonomics for CLI and action-oriented coverage.",
    ],
  };
}

function collectTestingSetup(snapshot: RepositorySnapshot): LocalTestingSetup {
  const { frameworks, evidence } = collectFrameworkEvidence(snapshot);
  const testDirectories = new Set<string>();

  for (const filePath of snapshot.testFiles) {
    const segments = filePath.split("/");
    if (segments.length <= 1) {
      testDirectories.add(".");
      continue;
    }

    testDirectories.add(segments.slice(0, -1).join("/"));
  }

  const hasTests = snapshot.testFiles.length > 0;
  const hasFrameworkEvidence = frameworks.length > 0 || evidence.length > 0;
  const status = !hasTests && !hasFrameworkEvidence
    ? "none"
    : snapshot.testFiles.length >= 5 || (hasTests && frameworks.length >= 1)
      ? "established"
      : "partial";

  const notes: string[] = [];
  if (!hasTests) {
    notes.push("No existing test files were detected in the repository scan.");
  }
  if (!hasFrameworkEvidence) {
    notes.push("No testing framework dependencies, configs, or test scripts were detected.");
  }
  if (hasFrameworkEvidence && !hasTests) {
    notes.push("Testing tooling appears to be present, but there are no test files yet.");
  }
  if (snapshot.workflowPaths.length > 0 && snapshot.actionDirs.length > 0) {
    notes.push(
      "Repository includes GitHub Actions automation, which increases the value of smoke and workflow coverage."
    );
  }

  return {
    status,
    hasTests,
    testFileCount: snapshot.testFiles.length,
    frameworks,
    evidence,
    testDirectories: [...testDirectories].sort((left, right) => left.localeCompare(right)),
    notes,
    frameworkRecommendation: recommendFramework(snapshot, frameworks),
  };
}

function collectCiIntegration(
  snapshot: RepositorySnapshot,
  setup: LocalTestingSetup
): CiIntegrationAssessmentType {
  const workflows = snapshot.workflowPaths;
  const evidence = new Set<string>();
  const notes: string[] = [];

  for (const workflowFile of snapshot.workflowFiles) {
    for (const candidate of CI_TEST_COMMAND_PATTERNS) {
      if (candidate.pattern.test(workflowFile.content)) {
        evidence.add(`${candidate.label} found in ${workflowFile.path}`);
      }
    }
  }

  let status: CiIntegrationAssessmentType["status"] = "missing";
  if (evidence.size > 0) {
    status = setup.hasTests ? "established" : "partial";
  }

  if (workflows.length === 0) {
    notes.push("No GitHub Actions workflows were detected, so tests are not currently enforceable in CI.");
  } else if (evidence.size === 0) {
    notes.push("GitHub Actions workflows exist, but none appear to invoke a test command.");
    notes.push(
      "Current workflows validate install/build flows only, so automated test regressions would still merge unnoticed."
    );
  } else if (!setup.hasTests) {
    notes.push("A workflow appears ready to execute tests, but the repository scan did not find test files yet.");
  }

  if (setup.hasTests && evidence.size === 0) {
    notes.push("Tests appear to exist locally, but they are not wired into GitHub Actions.");
  }

  return {
    status,
    hasGitHubActions: workflows.length > 0,
    workflows,
    evidence: [...evidence].sort((left, right) => left.localeCompare(right)),
    notes,
  };
}

function collectSnapshot(repoRoot: string, excludePaths: string[]): RepositorySnapshot {
  const allFiles = walkFiles(repoRoot, createRepositoryPathMatcher(excludePaths));
  const packageJsons = collectPackageJsons(repoRoot, allFiles);
  const workflowPaths = allFiles.filter((filePath) =>
    /^\.github\/workflows\/.+\.(yml|yaml)$/.test(filePath)
  );
  const packageDirs = uniquePaths(
    allFiles
      .map((filePath) => filePath.match(/^packages\/([^/]+)/)?.[0])
      .filter((value): value is string => Boolean(value))
  );
  const actionDirs = uniquePaths(
    allFiles
      .map((filePath) => filePath.match(/^actions\/([^/]+)/)?.[0])
      .filter((value): value is string => Boolean(value))
  );

  return {
    allFiles,
    packageJsons,
    sourceFiles: allFiles.filter(isSourceFile),
    testFiles: allFiles.filter(isTestFile),
    workflowFiles: workflowPaths.map((path) => ({
      path,
      content: readTextFile(resolve(repoRoot, path)),
    })),
    workflowPaths,
    actionDirs,
    packageDirs,
    rootHasAction: allFiles.includes("action.yml"),
    rootHasCli: packageJsons.some((packageJson) => {
      const payload = readJsonFile<{ bin?: unknown }>(resolve(repoRoot, packageJson.path));
      return typeof payload?.bin === "string" || typeof payload?.bin === "object";
    }),
  };
}

function relatedCoverage(testFiles: string[], terms: string[], paths: string[]): string | undefined {
  const related = testFiles.filter((filePath) => {
    const haystack = filePath.toLowerCase();
    return terms.some((term) => haystack.includes(term.toLowerCase())) ||
      paths.some((path) => haystack.startsWith(path.toLowerCase()));
  });

  if (related.length === 0) {
    return undefined;
  }

  return `Detected ${related.length} related test file${
    related.length === 1 ? "" : "s"
  }: ${related.slice(0, 3).join(", ")}`;
}

function existingPaths(snapshot: RepositorySnapshot, candidates: string[]): string[] {
  return uniquePaths(
    candidates.filter((candidate) =>
      snapshot.allFiles.some((filePath) => filePath === candidate || filePath.startsWith(`${candidate}/`))
    )
  );
}

function preferredUnitFramework(setup: LocalTestingSetup): string {
  return (
    setup.frameworkRecommendation?.recommended ??
    setup.frameworks.find((framework) => UNIT_TEST_FRAMEWORKS.has(framework)) ??
    "Vitest"
  );
}

function buildComponents(snapshot: RepositorySnapshot, setup: LocalTestingSetup): Component[] {
  const unitFramework = preferredUnitFramework(setup);
  const components: Component[] = [];

  if (snapshot.packageDirs.includes("packages/cli") || snapshot.rootHasCli) {
    components.push({
      id: "cli",
      title: "CLI integration coverage for issue and test-backlog flows",
      issueTitle: "Add CLI integration coverage for `prs issue` and `prs test-backlog`",
      kind: "cli",
      relatedPaths: existingPaths(snapshot, [
        "packages/cli/src/index.ts",
        "packages/cli/package.json",
        "package.json",
      ]),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["cli", "command", "issue", "backlog"], ["packages/cli"]),
      rationale:
        "The CLI is the highest-leverage entry point in this repo. Regressions in argument parsing, git orchestration, or issue creation break core daily workflows immediately.",
      repoFit:
        "This repository routes issue preparation, issue finalization, and test backlog generation through a single CLI entrypoint, so one focused integration suite can protect several user-facing flows at once.",
      implementationPlan: [
        `Use ${unitFramework} to exercise the CLI against fixture repositories and mocked environment variables instead of relying on broad end-to-end tests first.`,
        "Cover `test-backlog` option parsing, markdown/json formatting, and duplicate-issue reuse logic with GitHub API calls mocked at the boundary.",
        "Cover `issue prepare` and `issue finalize` paths with fixture git state so branch naming, prompt file creation, and commit behavior are verified.",
      ],
      starterTests: [
        "`prs test-backlog --format json --top 3` returns stable JSON and preserves the generated issue titles.",
        "`prs issue prepare <n>` writes the expected run artifacts and output metadata for downstream automation.",
        "`prs issue finalize <n>` fails clearly when the branch or artifact state is incomplete.",
      ],
      acceptanceCriteria: [
        "CLI coverage runs in-process or via lightweight child-process wrappers without requiring live GitHub or OpenAI calls.",
        "The tests assert at least one success path and one failure path for both `issue` and `test-backlog` flows.",
        "The suite is wired into the repo-level test command introduced by the baseline framework setup.",
      ],
      suggestedTestTypes: ["cli", "integration"],
    });
  }

  if (snapshot.packageDirs.includes("packages/core")) {
    components.push({
      id: "core",
      title: "Unit coverage for test backlog analysis and issue drafting",
      issueTitle: "Add unit coverage for test backlog analysis and issue drafting",
      kind: "core",
      relatedPaths: existingPaths(snapshot, [
        "packages/core/src/test-backlog.ts",
        "packages/core/src/structured-generation.ts",
        "packages/core/package.json",
      ]),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["backlog", "structured", "diff", "commit"], ["packages/core"]),
      rationale:
        "The `packages/core` layer contains the ranking, recommendation, and prompt-shaping logic that everything else depends on. Small behavior changes here can silently reshape generated output across the repo.",
      repoFit:
        "This issue specifically targets the logic that scans the repository, scores findings, and drafts implementation-ready issue bodies, which is the highest-risk part of the new test backlog workflow.",
      implementationPlan: [
        `Add ${unitFramework} unit tests around repository snapshot analysis, framework detection, CI detection, and finding prioritization in \`packages/core/src/test-backlog.ts\`.`,
        "Add focused coverage for the issue body drafting helpers so recommendations, alternatives, and acceptance criteria remain opinionated instead of regressing back to generic text.",
        "Prefer table-driven fixtures over large repo snapshots so the test cases stay easy to extend as new heuristics are added.",
      ],
      starterTests: [
        "No-framework repositories receive a Vitest recommendation plus a distinct CI finding when workflows do not run tests.",
        "Repos with partial testing setups keep existing framework evidence and avoid duplicate initial-harness findings.",
        "Findings are ranked consistently so CI wiring and baseline harness work stay ahead of lower-value package-level gaps.",
      ],
      acceptanceCriteria: [
        "Core tests cover both `none` and `partial` testing-setup scenarios.",
        "Issue body generation includes repository-fit rationale, implementation steps, and acceptance criteria in every finding.",
        "The ranking logic remains deterministic for a fixed repository snapshot.",
      ],
      suggestedTestTypes: ["unit"],
    });
  }

  if (snapshot.packageDirs.includes("packages/contracts")) {
    components.push({
      id: "contracts",
      title: "Schema coverage for public test-backlog contracts",
      issueTitle: "Add schema coverage for test backlog output contracts",
      kind: "contracts",
      relatedPaths: existingPaths(snapshot, [
        "packages/contracts/src/test-backlog.ts",
        "packages/contracts/src/index.ts",
        "packages/contracts/package.json",
      ]),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["contract", "schema", "zod", "backlog"], ["packages/contracts"]),
      rationale:
        "Contract drift breaks CLI consumers and GitHub workflow summaries quickly. Targeted schema tests keep the public shape stable as the backlog output becomes richer.",
      repoFit:
        "The test backlog command now carries framework recommendations and CI metadata, so the Zod contract is the boundary that should lock those additions down.",
      implementationPlan: [
        `Add ${unitFramework} schema tests that parse valid backlog payloads and reject malformed priority, CI status, or framework recommendation data.`,
        "Focus on the public `test-backlog` contract first rather than trying to snapshot every contract in the monorepo immediately.",
      ],
      starterTests: [
        "A valid payload with framework recommendation and CI integration metadata parses successfully.",
        "Invalid CI statuses or empty recommendation strings fail validation.",
      ],
      acceptanceCriteria: [
        "Tests exercise the public Zod contract directly.",
        "The suite documents the new required CI metadata and optional framework recommendation fields.",
      ],
      suggestedTestTypes: ["unit"],
    });
  }

  if (snapshot.packageDirs.includes("packages/providers")) {
    components.push({
      id: "providers",
      title: "Provider adapter regression coverage for OpenAI integration",
      issueTitle: "Add provider adapter regression coverage for OpenAI responses",
      kind: "providers",
      relatedPaths: existingPaths(snapshot, [
        "packages/providers/src/openai.ts",
        "packages/providers/src/provider.ts",
        "packages/providers/package.json",
      ]),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["provider", "openai", "adapter"], ["packages/providers"]),
      rationale:
        "Provider adapters sit on an unstable boundary where request formatting and response parsing can break without obvious compile-time signals.",
      repoFit:
        "The repository currently ships one provider first, so a small mocked regression suite around the OpenAI adapter buys more confidence than a broad provider abstraction effort.",
      implementationPlan: [
        `Use ${unitFramework} with mocked fetch or provider stubs to verify request payload construction and failure handling in the OpenAI adapter.`,
        "Keep the scope to adapter behavior and avoid end-to-end model calls.",
      ],
      starterTests: [
        "Successful text generation returns the expected normalized payload.",
        "Non-OK responses raise actionable errors instead of leaking raw transport details.",
      ],
      acceptanceCriteria: [
        "No live network calls are required.",
        "Both success and failure paths are covered for the OpenAI adapter.",
      ],
      suggestedTestTypes: ["integration", "unit"],
    });
  }

  if (snapshot.actionDirs.length > 0 || snapshot.rootHasAction) {
    components.push({
      id: "actions",
      title: "Smoke coverage for bundled GitHub Action entrypoints",
      issueTitle: "Add smoke coverage for GitHub Action entrypoints",
      kind: "actions",
      relatedPaths: existingPaths(snapshot, [
        "actions/pr-assistant/src/index.ts",
        "actions/test-suggestions/src/index.ts",
      ]),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["action", "workflow"], ["actions", ".github/workflows"]),
      rationale:
        "The packaged GitHub Actions are public delivery surfaces. Light smoke coverage catches broken inputs, outputs, and packaging assumptions before users hit them in CI.",
      repoFit:
        "Each action wrapper is intentionally thin, so smoke tests can validate input parsing and output wiring without building a large harness around the GitHub runner.",
      implementationPlan: [
        `Add ${unitFramework} smoke tests that invoke each action entrypoint with stubbed \`@actions/core\` calls and a mocked provider.`,
        "Assert output keys and failure handling rather than trying to emulate the full GitHub Actions runtime.",
      ],
      starterTests: [
        "The PR assistant action writes the expected body output when core generation succeeds.",
        "The test suggestions action fails cleanly when required inputs are missing.",
      ],
      acceptanceCriteria: [
        "Action smoke tests run locally without network access.",
        "At least one happy path and one validation failure path are covered across the shipped actions.",
      ],
      suggestedTestTypes: ["smoke", "workflow"],
    });
  }

  if (snapshot.workflowPaths.length > 0) {
    components.push({
      id: "workflow",
      title: "Regression coverage for GitHub workflow shell orchestration",
      issueTitle: "Add regression coverage for workflow shell orchestration",
      kind: "workflow",
      relatedPaths: snapshot.workflowPaths,
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["workflow", "dispatch", "issue"], [".github/workflows"]),
      rationale:
        "Workflow YAML is easy to change accidentally and hard to exercise manually. Targeted regression checks reduce the risk of shipping broken automation paths.",
      repoFit:
        "This repo relies on hand-written shell steps for issue preparation, backlog generation, and PR creation, so lightweight workflow assertions have real operational value.",
      implementationPlan: [
        "Add fixture-based regression checks around the highest-risk workflows first instead of trying to execute every workflow end-to-end.",
        "Validate that critical jobs still install dependencies, build the workspace, and pass the expected CLI arguments after future edits.",
      ],
      starterTests: [
        "The issue-to-pr workflow still builds the CLI before invoking `prs issue prepare`.",
        "The test-backlog workflow still publishes the generated report after running the CLI.",
      ],
      acceptanceCriteria: [
        "Workflow coverage focuses on protecting critical shell orchestration, not generic YAML snapshots.",
        "The selected checks fail if required CLI arguments or build steps are removed.",
      ],
      suggestedTestTypes: ["workflow", "integration"],
    });
  }

  return components.filter((component) => component.relatedPaths.length > 0);
}

function issueBodyForFinding(finding: FindingDraft): string {
  const lines = [
    "## Summary",
    finding.issueSummary,
    "",
    "## Why this matters",
    finding.rationale,
    "",
    "## Why this approach fits this repository",
    finding.repoFit,
  ];

  if (finding.alternatives && finding.alternatives.length > 0) {
    lines.push("", "## Alternatives considered", ...finding.alternatives.map((item) => `- ${item}`));
  }

  lines.push(
    "",
    "## Proposed implementation",
    ...finding.implementationPlan.map((step) => `- ${step}`),
    "",
    "## First tests to add",
    ...finding.starterTests.map((test) => `- ${test}`),
    "",
    "## Target paths",
    ...finding.relatedPaths.map((path) => `- \`${path}\``)
  );

  if (finding.existingCoverage) {
    lines.push("", "## Existing coverage signal", finding.existingCoverage);
  }

  lines.push(
    "",
    "## Acceptance criteria",
    ...finding.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    `- Backlog finding id: \`${finding.id}\``
  );

  return lines.join("\n");
}

function findingPriority(score: number): "high" | "medium" | "low" {
  if (score >= 80) {
    return "high";
  }
  if (score >= 55) {
    return "medium";
  }
  return "low";
}

function findingRank(finding: TestBacklogFindingType): number {
  const explicitRanks: Record<string, number> = {
    "initial-test-harness": 110,
    "ci-test-execution": 105,
    cli: 92,
    core: 88,
    actions: 80,
    workflow: 76,
    contracts: 72,
    providers: 68,
  };

  return explicitRanks[finding.id] ?? 50;
}

function buildFinding(component: Component, setup: LocalTestingSetup): TestBacklogFindingType {
  const baseScore = {
    cli: 92,
    core: 88,
    actions: 80,
    workflow: 76,
    contracts: 72,
    providers: 68,
  }[component.kind];

  const coveragePenalty = component.coverageEvidence ? 22 : 0;
  const maturityPenalty = setup.status === "established" ? 10 : setup.status === "partial" ? 4 : 0;
  const lowTestCountBonus = setup.testFileCount === 0 ? 8 : setup.testFileCount < 5 ? 4 : 0;
  const score = baseScore - coveragePenalty - maturityPenalty + lowTestCountBonus;
  const priority = findingPriority(score);

  const findingBase: FindingDraft = {
    id: component.id,
    title: component.title,
    priority,
    rationale: component.rationale,
    suggestedTestTypes: component.suggestedTestTypes,
    relatedPaths: component.relatedPaths.slice(0, 12),
    existingCoverage: component.coverageEvidence,
    issueTitle: component.issueTitle,
    issueSummary: component.title,
    repoFit: component.repoFit,
    implementationPlan: component.implementationPlan,
    starterTests: component.starterTests,
    acceptanceCriteria: component.acceptanceCriteria,
  };

  return {
    ...findingBase,
    issueBody: issueBodyForFinding(findingBase),
  };
}

function buildInitialFrameworkFinding(
  snapshot: RepositorySnapshot,
  sourceFileCount: number,
  setup: LocalTestingSetup
): TestBacklogFindingType {
  const recommendation = setup.frameworkRecommendation;
  const recommendedFramework = recommendation?.recommended ?? "Vitest";
  const relatedPaths = existingPaths(snapshot, [
    "package.json",
    "pnpm-workspace.yaml",
    "packages",
    "actions",
  ]);
  const rationale =
    sourceFileCount === 0
      ? `The repository does not currently show a testing setup. Adopting ${recommendedFramework} is the prerequisite for any meaningful backlog work.`
      : `The repository currently has ${sourceFileCount} source file${
          sourceFileCount === 1 ? "" : "s"
        } but no detected automated unit-test framework. Adding ${recommendedFramework} first is the fastest way to make later CLI, core, and Action coverage implementable.`;

  const findingBase: FindingDraft = {
    id: "initial-test-harness",
    title: `Adopt ${recommendedFramework} and add baseline monorepo test wiring`,
    priority: "high",
    rationale,
    suggestedTestTypes: ["smoke", "unit"],
    relatedPaths: relatedPaths.length > 0 ? relatedPaths : ["package.json"],
    existingCoverage: undefined,
    issueTitle: `Adopt ${recommendedFramework} and add baseline monorepo test wiring`,
    issueSummary:
      `Introduce ${recommendedFramework} as the default repository test runner, add a shared workspace test script, and land the first smoke tests that prove the harness works.`,
    repoFit:
      recommendation?.rationale ??
      `${recommendedFramework} is a pragmatic fit for this repository because it can cover package-level unit tests, CLI-oriented integration tests, and lightweight action smoke tests without introducing a heavy initial setup.`,
    implementationPlan: [
      `Add ${recommendedFramework} at the workspace root and create a repo-level \`test\` script that runs across packages.`,
      "Create a minimal shared layout for tests so new package-level suites can follow one convention instead of inventing their own structure later.",
      "Land a very small set of baseline smoke tests first, such as a contract parse test and one CLI or core-path sanity check, to prove the harness is actually executable.",
    ],
    starterTests: [
      "A schema or contract-level parse test that runs without external services.",
      "A core helper test that exercises deterministic repository-analysis logic.",
      "One CLI formatting or argument-parsing smoke test to confirm the workspace wiring works end to end.",
    ],
    acceptanceCriteria: [
      "The repository has a single documented default test framework and a root-level test command.",
      "At least one fast baseline test runs successfully in CI and locally.",
      "New findings generated by `prs test-backlog` no longer describe the repo as lacking a test framework.",
    ],
    alternatives: recommendation?.alternatives,
  };

  return {
    ...findingBase,
    issueBody: issueBodyForFinding(findingBase),
  };
}

function buildCiFinding(
  snapshot: RepositorySnapshot,
  ciIntegration: CiIntegrationAssessmentType,
  setup: LocalTestingSetup
): TestBacklogFindingType {
  const hasExistingWorkflows = ciIntegration.workflows.length > 0;
  const workflowTarget = hasExistingWorkflows
    ? ciIntegration.workflows.slice(0, 4)
    : [".github/workflows/test.yml"];
  const unitFramework = preferredUnitFramework(setup);

  const findingBase: FindingDraft = {
    id: "ci-test-execution",
    title: hasExistingWorkflows
      ? "Add test execution to GitHub Actions"
      : "Add a GitHub Actions workflow for test execution",
    priority: "high",
    rationale: hasExistingWorkflows
      ? "The repository already depends on GitHub Actions, but current workflows do not enforce automated tests. That leaves the highest-value regressions detectable only after merge."
      : "Without CI wiring, even a good local test suite will drift out of use. Test execution should become part of the default automation path as soon as the baseline harness exists.",
    suggestedTestTypes: ["workflow"],
    relatedPaths: workflowTarget,
    existingCoverage: ciIntegration.evidence.length > 0
      ? ciIntegration.evidence.join("; ")
      : undefined,
    issueTitle: hasExistingWorkflows
      ? "Add test execution to GitHub Actions"
      : "Add a GitHub Actions workflow for test execution",
    issueSummary: hasExistingWorkflows
      ? "Update the existing GitHub Actions workflows so automated tests run alongside the current install/build steps."
      : "Introduce a GitHub Actions workflow that installs dependencies, builds the workspace, and runs the repository test command on every relevant trigger.",
    repoFit: hasExistingWorkflows
      ? "This repo already uses GitHub Actions for issue automation and backlog generation, so adding test enforcement to that same CI surface is a small operational step with high leverage."
      : "This repo already has automation-oriented workflows in mind, so creating the first CI test workflow now prevents the future test suite from becoming an optional local-only tool.",
    implementationPlan: hasExistingWorkflows
      ? [
          "Choose the workflow or workflows that gate the most important changes and add the repo-level test command after dependency installation and build steps.",
          `Use the shared \`pnpm test\` entrypoint from the baseline ${unitFramework} setup so local and CI behavior stay aligned.`,
          "Fail the workflow when tests fail, and document which workflow should become the expected signal for contributors before merge.",
        ]
      : [
          "Create a dedicated workflow under `.github/workflows/` that runs on pull requests and pushes to the default branch.",
          `Install dependencies, build the workspace, and run the shared ${unitFramework}-backed repo test command in that workflow.`,
          "Publish the workflow as the default enforcement path so future test additions automatically gain CI coverage.",
        ],
    starterTests: hasExistingWorkflows
      ? [
          "A pull request that removes the test step from the target workflow should fail the workflow regression coverage added later.",
          "The workflow runs the same root-level test command contributors use locally.",
        ]
      : [
          "The new workflow installs dependencies, builds, and runs tests on a pull request event.",
          "The workflow fails when the repo-level test command exits non-zero.",
        ],
    acceptanceCriteria: [
      "Automated tests are executed by GitHub Actions rather than being local-only guidance.",
      "The workflow uses the repository’s shared test command instead of duplicating package-specific commands inline.",
      "Contributors can identify one clear CI signal that represents test health.",
    ],
  };

  return {
    ...findingBase,
    issueBody: issueBodyForFinding(findingBase),
  };
}

function summarizeAnalysis(
  setup: CurrentTestingSetupType,
  findings: TestBacklogFindingType[],
  sourceFileCount: number
): string {
  const frameworkSummary =
    setup.frameworks.length > 0 ? setup.frameworks.join(", ") : "no detected frameworks";
  const ciSummary = setup.ciIntegration.status;
  const recommendationSummary = setup.frameworkRecommendation
    ? ` Recommended default framework: ${setup.frameworkRecommendation.recommended}.`
    : "";
  const topPriorities = findings
    .slice(0, 3)
    .map((finding) => finding.title.toLowerCase())
    .join("; ");

  return `Repository scan found ${sourceFileCount} source file${
    sourceFileCount === 1 ? "" : "s"
  }, ${setup.testFileCount} test file${
    setup.testFileCount === 1 ? "" : "s"
  }, and ${frameworkSummary}. Current testing setup is ${setup.status} and CI test integration is ${ciSummary}.${recommendationSummary} Highest-value gaps focus on ${topPriorities}.`;
}

export async function analyzeTestBacklog(
  input: TestBacklogInputType
): Promise<TestBacklogOutputType> {
  const parsed = TestBacklogInput.parse(input);
  const repoRoot = resolve(parsed.repoRoot);
  const excludePaths = resolveRepositoryConfig({
    aiContext: {
      excludePaths: parsed.excludePaths,
    },
  }).aiContext.excludePaths;
  const snapshot = collectSnapshot(repoRoot, excludePaths);
  const localSetup = collectTestingSetup(snapshot);
  const ciIntegration = collectCiIntegration(snapshot, localSetup);
  const setup: CurrentTestingSetupType = {
    ...localSetup,
    ciIntegration,
  };
  const components = buildComponents(snapshot, localSetup);
  const findings: TestBacklogFindingType[] = [];

  if (localSetup.frameworkRecommendation) {
    findings.push(buildInitialFrameworkFinding(snapshot, snapshot.sourceFiles.length, localSetup));
  }

  if (ciIntegration.status !== "established") {
    findings.push(buildCiFinding(snapshot, ciIntegration, localSetup));
  }

  for (const component of components) {
    findings.push(buildFinding(component, localSetup));
  }

  const sortedFindings = findings
    .sort((left, right) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[right.priority] - priorityOrder[left.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const rankDiff = findingRank(right) - findingRank(left);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, parsed.maxFindings ?? 5);

  const notableCoverageGaps = sortedFindings.map(
    (finding) => `${finding.title} (${finding.priority})`
  );

  return TestBacklogOutput.parse({
    summary: summarizeAnalysis(setup, sortedFindings, snapshot.sourceFiles.length),
    currentTestingSetup: setup,
    notableCoverageGaps,
    findings: sortedFindings,
  });
}
