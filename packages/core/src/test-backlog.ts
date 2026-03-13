import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import {
  TestBacklogFindingType,
  TestBacklogInput,
  TestBacklogInputType,
  TestBacklogOutput,
  TestBacklogOutputType,
} from "@git-ai/contracts";

type PackageJson = {
  path: string;
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type RepositorySnapshot = {
  allFiles: string[];
  packageJsons: PackageJson[];
  sourceFiles: string[];
  testFiles: string[];
  workflowFiles: string[];
  actionDirs: string[];
  packageDirs: string[];
  rootHasAction: boolean;
  rootHasCli: boolean;
};

type Component = {
  id: string;
  title: string;
  kind: "cli" | "core" | "contracts" | "providers" | "actions" | "workflow";
  relatedPaths: string[];
  coverageEvidence: string | undefined;
};

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".git-ai",
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

function walkFiles(rootDir: string, currentDir = rootDir): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = resolve(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    files.push(normalizePath(relative(rootDir, absolutePath)));
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

function collectTestingSetup(snapshot: RepositorySnapshot) {
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
  if (snapshot.workflowFiles.length > 0 && snapshot.actionDirs.length > 0) {
    notes.push("Repository includes GitHub Actions automation, which increases the value of smoke and workflow coverage.");
  }

  return {
    status,
    hasTests,
    testFileCount: snapshot.testFiles.length,
    frameworks,
    evidence,
    testDirectories: [...testDirectories].sort((left, right) => left.localeCompare(right)),
    notes,
  } as const;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function collectSnapshot(repoRoot: string): RepositorySnapshot {
  const allFiles = walkFiles(repoRoot);
  const packageJsons = collectPackageJsons(repoRoot, allFiles);
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
    workflowFiles: allFiles.filter((filePath) => /^\.github\/workflows\/.+\.(yml|yaml)$/.test(filePath)),
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

function buildComponents(snapshot: RepositorySnapshot): Component[] {
  const components: Component[] = [];

  if (snapshot.packageDirs.includes("packages/cli") || snapshot.rootHasCli) {
    components.push({
      id: "cli",
      title: "CLI command coverage",
      kind: "cli",
      relatedPaths: uniquePaths(
        ["packages/cli", "package.json"].filter((path) => snapshot.allFiles.some((file) => file === path || file.startsWith(`${path}/`)))
      ),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["cli", "command"], ["packages/cli"]),
    });
  }

  if (snapshot.packageDirs.includes("packages/core")) {
    components.push({
      id: "core",
      title: "Core module unit coverage",
      kind: "core",
      relatedPaths: uniquePaths(
        snapshot.allFiles.filter(
          (filePath) => filePath.startsWith("packages/core/src/") || filePath === "packages/core/package.json"
        )
      ).slice(0, 12),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["core", "structured", "diff", "commit"], ["packages/core"]),
    });
  }

  if (snapshot.packageDirs.includes("packages/contracts")) {
    components.push({
      id: "contracts",
      title: "Contract and schema validation coverage",
      kind: "contracts",
      relatedPaths: uniquePaths(
        snapshot.allFiles.filter(
          (filePath) =>
            filePath.startsWith("packages/contracts/src/") || filePath === "packages/contracts/package.json"
        )
      ).slice(0, 12),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["contract", "schema", "zod"], ["packages/contracts"]),
    });
  }

  if (snapshot.packageDirs.includes("packages/providers")) {
    components.push({
      id: "providers",
      title: "Provider adapter regression coverage",
      kind: "providers",
      relatedPaths: uniquePaths(
        snapshot.allFiles.filter(
          (filePath) =>
            filePath.startsWith("packages/providers/src/") || filePath === "packages/providers/package.json"
        )
      ).slice(0, 12),
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["provider", "openai", "adapter"], ["packages/providers"]),
    });
  }

  if (snapshot.actionDirs.length > 0 || snapshot.rootHasAction) {
    const relatedPaths = uniquePaths([
      ...snapshot.actionDirs,
      ...snapshot.workflowFiles,
      ...(snapshot.rootHasAction ? ["action.yml"] : []),
    ]);
    components.push({
      id: "actions",
      title: "GitHub Action smoke coverage",
      kind: "actions",
      relatedPaths,
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["action", "workflow"], ["actions", ".github/workflows"]),
    });
  }

  if (snapshot.workflowFiles.length > 0) {
    components.push({
      id: "workflow",
      title: "Workflow orchestration regression coverage",
      kind: "workflow",
      relatedPaths: snapshot.workflowFiles,
      coverageEvidence: relatedCoverage(snapshot.testFiles, ["workflow", "dispatch", "issue"], [".github/workflows"]),
    });
  }

  return components;
}

function issueBodyForFinding(
  finding: Omit<TestBacklogFindingType, "issueBody" | "issueTitle">
): string {
  const lines = [
    "## Summary",
    finding.title,
    "",
    "## Why this matters",
    finding.rationale,
    "",
    "## Suggested scope",
    ...finding.suggestedTestTypes.map((testType) => `- Add ${testType} coverage for this area`),
    "",
    "## Target paths",
    ...finding.relatedPaths.map((path) => `- \`${path}\``),
  ];

  if (finding.existingCoverage) {
    lines.push("", "## Existing coverage signal", finding.existingCoverage);
  }

  lines.push("", "## Acceptance notes", `- Backlog finding id: \`${finding.id}\``);
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
    "initial-test-harness": 100,
    cli: 90,
    core: 85,
    actions: 80,
    workflow: 75,
    contracts: 70,
    providers: 65,
  };

  return explicitRanks[finding.id] ?? 50;
}

function buildFinding(component: Component, setupStatus: string, testFileCount: number): TestBacklogFindingType {
  const baseScore = {
    cli: 92,
    core: 88,
    actions: 82,
    workflow: 78,
    contracts: 74,
    providers: 68,
  }[component.kind];

  const coveragePenalty = component.coverageEvidence ? 24 : 0;
  const maturityPenalty = setupStatus === "established" ? 10 : setupStatus === "partial" ? 4 : 0;
  const lowTestCountBonus = testFileCount === 0 ? 8 : testFileCount < 5 ? 4 : 0;
  const score = baseScore - coveragePenalty - maturityPenalty + lowTestCountBonus;
  const priority = findingPriority(score);

  const rationaleByKind: Record<Component["kind"], string> = {
    cli: "The CLI is a high-leverage entry point. Command parsing, git command orchestration, and error handling need regression coverage because failures here block day-to-day usage.",
    core: "The core package contains the main business logic and prompt shaping. Focused unit coverage here reduces the risk of silent behavior regressions across every consumer.",
    contracts: "Schema and contract validation are the public boundary for generated outputs. Tests here prevent malformed payloads and clarify expected shapes as the project grows.",
    providers: "Provider adapters are integration-sensitive and easy to break when request or response handling changes. Mocked regression coverage is valuable even in small repositories.",
    actions: "GitHub Action wrappers are a user-facing delivery surface. Smoke coverage helps catch broken input handling, output formatting, and packaging mistakes before they hit CI users.",
    workflow: "Workflow orchestration contains the highest-risk automation paths because it coordinates checkout, build, Codex execution, and GitHub side effects. Regression tests here help prevent broken operational flows.",
  };

  const suggestedTypesByKind: Record<Component["kind"], Array<"unit" | "integration" | "smoke" | "cli" | "workflow">> = {
    cli: ["cli", "integration"],
    core: ["unit"],
    contracts: ["unit"],
    providers: ["integration", "unit"],
    actions: ["smoke", "workflow"],
    workflow: ["workflow", "integration"],
  };

  const findingBase = {
    id: component.id,
    title: component.title,
    priority,
    rationale: rationaleByKind[component.kind],
    suggestedTestTypes: suggestedTypesByKind[component.kind],
    relatedPaths: component.relatedPaths.slice(0, 12),
    existingCoverage: component.coverageEvidence,
  };

  return {
    ...findingBase,
    issueTitle: `Add ${component.title}`,
    issueBody: issueBodyForFinding(findingBase),
  };
}

function buildInitialFrameworkFinding(
  snapshot: RepositorySnapshot,
  sourceFileCount: number
): TestBacklogFindingType {
  const relatedPaths = uniquePaths([
    "package.json",
    ...snapshot.packageDirs,
    ...snapshot.actionDirs,
  ]).filter((path) => snapshot.allFiles.some((file) => file === path || file.startsWith(`${path}/`)));
  const title = "Initial repository-wide test harness and smoke coverage";
  const rationale =
    sourceFileCount === 0
      ? "The repository does not currently show a testing setup. Establishing a lightweight test harness is the prerequisite for any meaningful backlog work."
      : `The repository currently has ${sourceFileCount} source file${
          sourceFileCount === 1 ? "" : "s"
        } but no detected automated test setup. A minimal harness is the highest-value first step because it unlocks every later coverage improvement.`;

  const findingBase: Omit<TestBacklogFindingType, "issueTitle" | "issueBody"> = {
    id: "initial-test-harness",
    title,
    priority: "high" as const,
    rationale,
    suggestedTestTypes: ["smoke", "unit"],
    relatedPaths: relatedPaths.length > 0 ? relatedPaths : ["package.json"],
    existingCoverage: undefined,
  };

  return {
    ...findingBase,
    issueTitle: "Add initial test framework and smoke coverage",
    issueBody: issueBodyForFinding(findingBase),
  };
}

function summarizeAnalysis(
  setup: ReturnType<typeof collectTestingSetup>,
  findings: TestBacklogFindingType[],
  sourceFileCount: number
): string {
  const frameworkSummary =
    setup.frameworks.length > 0 ? setup.frameworks.join(", ") : "no detected frameworks";
  const topPriorities = findings
    .slice(0, 3)
    .map((finding) => finding.title.toLowerCase())
    .join("; ");

  return `Repository scan found ${sourceFileCount} source file${
    sourceFileCount === 1 ? "" : "s"
  }, ${setup.testFileCount} test file${
    setup.testFileCount === 1 ? "" : "s"
  }, and ${frameworkSummary}. Current testing setup is ${setup.status}. Highest-value gaps focus on ${topPriorities}.`;
}

export async function analyzeTestBacklog(
  input: TestBacklogInputType
): Promise<TestBacklogOutputType> {
  const parsed = TestBacklogInput.parse(input);
  const repoRoot = resolve(parsed.repoRoot);
  const snapshot = collectSnapshot(repoRoot);
  const setup = collectTestingSetup(snapshot);
  const components = buildComponents(snapshot);
  const findings: TestBacklogFindingType[] = [];

  if (setup.status === "none") {
    findings.push(buildInitialFrameworkFinding(snapshot, snapshot.sourceFiles.length));
  }

  for (const component of components) {
    findings.push(buildFinding(component, setup.status, setup.testFileCount));
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
