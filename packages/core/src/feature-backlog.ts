import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import {
  FeatureBacklogInput,
  FeatureBacklogOutput,
  type FeatureBacklogInputType,
  type FeatureBacklogOutputType,
  type FeatureBacklogSuggestionType,
  type RepositoryFeatureSignalsType,
} from "@git-ai/contracts";
import { createRepositoryPathMatcher } from "./path-filter";
import { resolveRepositoryConfig } from "./repository-config";

type PackageJson = {
  path: string;
  name?: string;
  bin?: string | Record<string, string>;
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
  workflowFiles: WorkflowFile[];
  workflowPaths: string[];
  sourceFiles: string[];
  testFiles: string[];
  docsPaths: string[];
  examplePaths: string[];
  issueTemplatePaths: string[];
  providerSourcePaths: string[];
};

type SuggestionDraft = Omit<FeatureBacklogSuggestionType, "issueBody">;

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

const RELEASE_SIGNAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bchangeset\b/i, label: "Changesets release flow" },
  { pattern: /\bsemantic-release\b/i, label: "semantic-release flow" },
  { pattern: /\brelease-please\b/i, label: "release-please flow" },
  { pattern: /\bnpm publish\b/i, label: "npm publish step" },
  { pattern: /\bpnpm publish\b/i, label: "pnpm publish step" },
  { pattern: /\bgh release\b/i, label: "GitHub release step" },
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
      const payload = readJsonFile<Omit<PackageJson, "path">>(resolve(repoRoot, relativePath));
      return payload
        ? {
            ...payload,
            path: relativePath,
          }
        : undefined;
    })
    .filter((value): value is PackageJson => Boolean(value));
}

function collectSnapshot(repoRoot: string, excludePaths: string[]): RepositorySnapshot {
  const allFiles = walkFiles(repoRoot, createRepositoryPathMatcher(excludePaths));
  const workflowPaths = allFiles.filter((filePath) =>
    /^\.github\/workflows\/.+\.(yml|yaml)$/.test(filePath)
  );

  return {
    allFiles,
    packageJsons: collectPackageJsons(repoRoot, allFiles),
    workflowFiles: workflowPaths.map((path) => ({
      path,
      content: readTextFile(resolve(repoRoot, path)),
    })),
    workflowPaths,
    sourceFiles: allFiles.filter(isSourceFile),
    testFiles: allFiles.filter(isTestFile),
    docsPaths: allFiles.filter(
      (filePath) =>
        /^README(\..+)?$/i.test(filePath) ||
        /^docs\/.+/i.test(filePath) ||
        /^actions\/[^/]+\/README\.md$/i.test(filePath)
    ),
    examplePaths: allFiles.filter(
      (filePath) =>
        /^examples\/.+/i.test(filePath) ||
        /^templates\/.+/i.test(filePath) ||
        /^\.github\/workflows\/examples\/.+/i.test(filePath)
    ),
    issueTemplatePaths: allFiles.filter(
      (filePath) =>
        /^\.github\/ISSUE_TEMPLATE(?:\/.+|\.md)$/i.test(filePath)
    ),
    providerSourcePaths: allFiles.filter(
      (filePath) =>
        /^packages\/providers\/src\/.+\.(ts|js)$/i.test(filePath) &&
        !/\/(?:index|provider)\.(ts|js)$/i.test(filePath)
    ),
  };
}

function collectSignals(snapshot: RepositorySnapshot): RepositoryFeatureSignalsType {
  const hasCli = snapshot.packageJsons.some((packageJson) => {
    if (typeof packageJson.bin === "string") {
      return true;
    }

    if (packageJson.bin && Object.keys(packageJson.bin).length > 0) {
      return true;
    }

    return Object.keys(packageJson.scripts ?? {}).some(
      (scriptName) => scriptName.startsWith("cli:") || scriptName === "cli"
    );
  });
  const hasGitHubActions = snapshot.workflowPaths.length > 0 || snapshot.allFiles.includes("action.yml");
  const hasTests = snapshot.testFiles.length > 0;
  const hasIssueTemplates = snapshot.issueTemplatePaths.length > 0;
  const hasExamples = snapshot.examplePaths.length > 0;
  const evidence = new Set<string>();
  const notes: string[] = [];
  const releaseSignals = new Set<string>();

  if (hasCli) {
    evidence.add("CLI entrypoint or CLI-oriented scripts detected in package.json");
  }
  if (hasGitHubActions) {
    evidence.add(
      `${snapshot.workflowPaths.length} GitHub Actions workflow${
        snapshot.workflowPaths.length === 1 ? "" : "s"
      } detected`
    );
  }
  if (snapshot.docsPaths.length > 0) {
    evidence.add(`${snapshot.docsPaths.length} documentation file${snapshot.docsPaths.length === 1 ? "" : "s"} detected`);
  }
  if (hasTests) {
    evidence.add(`${snapshot.testFiles.length} automated test file${snapshot.testFiles.length === 1 ? "" : "s"} detected`);
  }
  if (snapshot.providerSourcePaths.length > 0) {
    evidence.add(
      `${snapshot.providerSourcePaths.length} provider adapter implementation${
        snapshot.providerSourcePaths.length === 1 ? "" : "s"
      } detected`
    );
  }

  for (const workflowFile of snapshot.workflowFiles) {
    for (const candidate of RELEASE_SIGNAL_PATTERNS) {
      if (candidate.pattern.test(workflowFile.content)) {
        releaseSignals.add(`${candidate.label} in ${workflowFile.path}`);
      }
    }
  }

  if (snapshot.allFiles.some((filePath) => /^\.changeset\/.+/.test(filePath))) {
    releaseSignals.add("Changesets metadata under .changeset/");
  }

  if (!hasIssueTemplates) {
    notes.push("No GitHub issue templates were detected.");
  }
  if (!hasExamples) {
    notes.push("No examples or starter templates were detected.");
  }
  if (releaseSignals.size === 0 && snapshot.packageJsons.length > 0) {
    notes.push("No release automation signals were detected in workflows or repository metadata.");
  }
  if (snapshot.providerSourcePaths.length === 1) {
    notes.push("Only one concrete provider adapter appears to be implemented.");
  }

  return {
    hasCli,
    hasGitHubActions,
    hasTests,
    hasIssueTemplates,
    hasReleaseAutomation: releaseSignals.size > 0,
    hasExamples,
    packageCount: snapshot.packageJsons.length,
    workflowCount: snapshot.workflowPaths.length,
    providerCount: snapshot.providerSourcePaths.length,
    evidence: uniquePaths([...evidence, ...releaseSignals]),
    notes,
  };
}

function issueBodyForSuggestion(suggestion: SuggestionDraft): string {
  return [
    "## Summary",
    suggestion.title,
    "",
    "## Why this matters",
    suggestion.rationale,
    "",
    "## Repository signals",
    ...suggestion.evidence.map((item) => `- ${item}`),
    "",
    "## Proposed implementation",
    ...suggestion.implementationHighlights.map((item) => `- ${item}`),
    "",
    "## Acceptance criteria",
    ...suggestion.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "## Target paths",
    ...suggestion.relatedPaths.map((item) => `- \`${item}\``),
    "",
    `- Feature suggestion id: \`${suggestion.id}\``,
  ].join("\n");
}

function buildSuggestion(
  suggestion: Omit<SuggestionDraft, "priority"> & { priority?: FeatureBacklogSuggestionType["priority"] }
): FeatureBacklogSuggestionType {
  const draft: SuggestionDraft = {
    ...suggestion,
    priority: suggestion.priority ?? "medium",
  };

  return {
    ...draft,
    issueBody: issueBodyForSuggestion(draft),
  };
}

function buildSuggestions(
  snapshot: RepositorySnapshot,
  signals: RepositoryFeatureSignalsType
): FeatureBacklogSuggestionType[] {
  const suggestions: FeatureBacklogSuggestionType[] = [];

  if (!signals.hasIssueTemplates) {
    suggestions.push(
      buildSuggestion({
        id: "feedback-intake",
        title: "Add guided issue templates for feature requests and bug reports",
        category: "feedback",
        priority: signals.hasCli || signals.hasGitHubActions ? "high" : "medium",
        rationale:
          "The repository already exposes public automation and CLI surfaces, but incoming feedback is still unstructured. Issue templates will make requests easier to triage and turn into actionable backlog items.",
        evidence: [
          "Public repository automation surface detected through CLI or GitHub Actions",
          "No .github/ISSUE_TEMPLATE files were found",
        ],
        relatedPaths: [".github/ISSUE_TEMPLATE/feature_request.md", ".github/ISSUE_TEMPLATE/bug_report.md"],
        implementationHighlights: [
          "Add separate issue templates for bug reports and feature requests with explicit reproduction, impact, and desired outcome fields.",
          "Pre-populate labels and guidance so maintainers receive consistent issue metadata from the start.",
          "Document which template contributors should use in the main README or contributing docs.",
        ],
        acceptanceCriteria: [
          "GitHub presents structured templates when a new issue is opened.",
          "Feature requests capture the problem statement, desired outcome, and success criteria.",
          "Bug reports capture environment details and reproduction steps.",
        ],
        issueTitle: "Add guided issue templates for feature requests and bug reports",
      })
    );
  }

  if (signals.packageCount > 0 && !signals.hasReleaseAutomation) {
    suggestions.push(
      buildSuggestion({
        id: "release-automation",
        title: "Add release automation and changelog publishing",
        category: "automation",
        priority: signals.hasCli ? "high" : "medium",
        rationale:
          "The repository ships installable packages and CLI surfaces, but it does not show a release pipeline. A dedicated release flow will reduce manual publishing work and make shipped changes easier for users to consume.",
        evidence: [
          `${signals.packageCount} package.json file${signals.packageCount === 1 ? "" : "s"} detected`,
          "No release automation signal was found in GitHub workflows or changeset metadata",
        ],
        relatedPaths: [".github/workflows/release.yml", ".changeset", "README.md"],
        implementationHighlights: [
          "Choose a release strategy such as Changesets, release-please, or a lightweight publish workflow and wire it into GitHub Actions.",
          "Generate or update a changelog as part of the release flow so users can see what changed between versions.",
          "Document the release entrypoint and any required credentials for maintainers.",
        ],
        acceptanceCriteria: [
          "A documented workflow exists for cutting releases without manual shell steps.",
          "Published releases include user-visible change notes or changelog updates.",
          "The repository can produce versioned releases for its public packages or CLI.",
        ],
        issueTitle: "Add release automation and changelog publishing",
      })
    );
  }

  if ((signals.hasCli || signals.hasGitHubActions) && !signals.hasExamples) {
    suggestions.push(
      buildSuggestion({
        id: "starter-templates",
        title: "Ship starter templates and end-to-end usage examples",
        category: "onboarding",
        priority: "high",
        rationale:
          "This repository already offers commands and automation entrypoints, but there are no example projects or starter templates showing how those pieces fit together. Concrete examples lower adoption friction and reduce support churn.",
        evidence: [
          signals.hasCli ? "CLI commands are exposed from the repository" : "GitHub Actions entrypoints are exposed from the repository",
          "No examples/ or templates/ directory was detected",
        ],
        relatedPaths: ["examples/basic-repo", "examples/github-action-usage", "README.md"],
        implementationHighlights: [
          "Add one minimal example repository or fixture that shows the intended setup from install through first successful command.",
          "Include at least one GitHub Actions usage example if the project ships workflow-facing entrypoints.",
          "Reference the examples directly from the README so first-time users can discover them immediately.",
        ],
        acceptanceCriteria: [
          "At least one runnable example exists for the primary product path.",
          "The README links to the examples and explains when to use them.",
          "Examples stay aligned with the documented command surface.",
        ],
        issueTitle: "Ship starter templates and end-to-end usage examples",
      })
    );
  }

  if (signals.providerCount === 1) {
    const providerPath = snapshot.providerSourcePaths[0] ?? "packages/providers/src";
    suggestions.push(
      buildSuggestion({
        id: "multi-provider",
        title: "Add a second AI provider adapter and provider-selection flow",
        category: "platform",
        priority: "medium",
        rationale:
          "The repository already abstracts provider access, but only one concrete provider adapter appears to be implemented. Adding a second provider would validate the abstraction and give users an escape hatch for cost, latency, or policy constraints.",
        evidence: [
          `Exactly one provider adapter implementation was detected (${providerPath})`,
          "The repository already centralizes provider logic in a dedicated package",
        ],
        relatedPaths: ["packages/providers/src", "packages/cli/src/index.ts", "README.md"],
        implementationHighlights: [
          "Implement a second provider adapter behind the existing provider interface instead of branching command-specific logic.",
          "Add a CLI or environment-variable selection path so users can choose the active provider without code changes.",
          "Document provider-specific prerequisites and any differences in supported features.",
        ],
        acceptanceCriteria: [
          "At least two provider adapters can be selected through the public interface.",
          "Provider selection is documented and testable without patching source files.",
          "Existing OpenAI-backed flows continue to work unchanged when no alternative provider is selected.",
        ],
        issueTitle: "Add a second AI provider adapter and provider-selection flow",
      })
    );
  }

  if (snapshot.docsPaths.length === 0) {
    suggestions.push(
      buildSuggestion({
        id: "onboarding-guide",
        title: "Add a quickstart and troubleshooting guide",
        category: "onboarding",
        priority: "medium",
        rationale:
          "A short quickstart plus troubleshooting guide helps users get from install to first success without reading source code or guessing at environment requirements.",
        evidence: [
          "Repository analysis did not find dedicated docs or README coverage for onboarding beyond the default surface",
        ],
        relatedPaths: ["README.md", "docs/quickstart.md", "docs/troubleshooting.md"],
        implementationHighlights: [
          "Write a concise quickstart that covers install, required environment variables, and one success-path command.",
          "Add troubleshooting notes for the most likely setup failures such as missing tokens or missing local tools.",
          "Keep the guide focused on first-run success rather than exhaustive reference material.",
        ],
        acceptanceCriteria: [
          "A new user can complete one documented success path from the quickstart.",
          "Common setup failures are covered in troubleshooting guidance.",
          "The quickstart stays aligned with the actual CLI command surface.",
        ],
        issueTitle: "Add a quickstart and troubleshooting guide",
      })
    );
  }

  return suggestions;
}

function suggestionRank(suggestion: FeatureBacklogSuggestionType): number {
  const explicitRanks: Record<string, number> = {
    "feedback-intake": 94,
    "release-automation": 90,
    "starter-templates": 86,
    "multi-provider": 74,
    "onboarding-guide": 70,
  };

  return explicitRanks[suggestion.id] ?? 50;
}

function summarizeAnalysis(
  snapshot: RepositorySnapshot,
  signals: RepositoryFeatureSignalsType,
  suggestions: FeatureBacklogSuggestionType[]
): string {
  const topSuggestionSummary = suggestions
    .slice(0, 3)
    .map((suggestion) => suggestion.title.toLowerCase())
    .join("; ");

  return `Repository scan found ${snapshot.sourceFiles.length} source file${
    snapshot.sourceFiles.length === 1 ? "" : "s"
  }, ${signals.packageCount} package manifest${
    signals.packageCount === 1 ? "" : "s"
  }, and ${signals.workflowCount} GitHub workflow${
    signals.workflowCount === 1 ? "" : "s"
  }. CLI surface is ${signals.hasCli ? "present" : "not detected"}, GitHub Actions support is ${
    signals.hasGitHubActions ? "present" : "not detected"
  }, and release automation is ${signals.hasReleaseAutomation ? "present" : "missing"}. Highest-value feature opportunities focus on ${topSuggestionSummary}.`;
}

export async function analyzeFeatureBacklog(
  input: FeatureBacklogInputType
): Promise<FeatureBacklogOutputType> {
  const parsed = FeatureBacklogInput.parse(input);
  const repoRoot = resolve(parsed.repoRoot);
  const excludePaths = resolveRepositoryConfig({
    aiContext: {
      excludePaths: parsed.excludePaths,
    },
  }).aiContext.excludePaths;
  const snapshot = collectSnapshot(repoRoot, excludePaths);
  const signals = collectSignals(snapshot);
  const suggestions = buildSuggestions(snapshot, signals)
    .sort((left, right) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[right.priority] - priorityOrder[left.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      const rankDiff = suggestionRank(right) - suggestionRank(left);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, parsed.maxSuggestions ?? 5);

  if (suggestions.length === 0) {
    suggestions.push(
      buildSuggestion({
        id: "onboarding-guide",
        title: "Add a quickstart and troubleshooting guide",
        category: "onboarding",
        priority: "medium",
        rationale:
          "The repository is active enough to benefit from a documented first-run path, even if the structural scan did not identify stronger product gaps.",
        evidence: ["Repository scan produced no stronger automatic feature heuristics."],
        relatedPaths: ["README.md", "docs/quickstart.md"],
        implementationHighlights: [
          "Document the first success path for a new user or maintainer.",
          "Capture the minimum required environment variables and tools.",
        ],
        acceptanceCriteria: [
          "A new user can follow one documented path from clone to success.",
        ],
        issueTitle: "Add a quickstart and troubleshooting guide",
      })
    );
  }

  return FeatureBacklogOutput.parse({
    summary: summarizeAnalysis(snapshot, signals, suggestions),
    repositorySignals: signals,
    notableOpportunities: suggestions.map(
      (suggestion) => `${suggestion.title} (${suggestion.priority})`
    ),
    suggestions,
  });
}
