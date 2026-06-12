import { analyzeFeatureBacklog, analyzeTestBacklog } from "@prs/core";
import type { CreatedIssueRecord } from "../forge";
import { getCliArgs, getRepositoryConfig, getRepositoryForge } from "../cli-context";
import { promptForLine, promptForYesNoDefaultYes } from "../cli-runtime";
import {
  parseFeatureBacklogCommandArgs,
  parseTestBacklogCommandArgs,
  type FeatureBacklogCommandOptions,
  type TestBacklogCommandOptions,
} from "./backlog";

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}


function formatTestBacklogMarkdown(
  result: Awaited<ReturnType<typeof analyzeTestBacklog>>,
  createdIssues: CreatedIssueRecord[]
): string {
  const lines: string[] = [
    "# AI Test Backlog",
    "",
    "## Summary",
    result.summary,
    "",
    "## Current testing setup",
    `- Status: ${toTitleCase(result.currentTestingSetup.status)}`,
    `- Test files detected: ${result.currentTestingSetup.testFileCount}`,
    `- Frameworks: ${
      result.currentTestingSetup.frameworks.length > 0
        ? result.currentTestingSetup.frameworks.join(", ")
        : "None detected"
    }`,
    `- CI integration: ${toTitleCase(result.currentTestingSetup.ciIntegration.status)}`,
  ];

  if (result.currentTestingSetup.evidence.length > 0) {
    lines.push(
      `- Evidence: ${result.currentTestingSetup.evidence.slice(0, 5).join("; ")}`
    );
  }

  if (result.currentTestingSetup.frameworkRecommendation) {
    lines.push(
      `- Recommended framework: ${result.currentTestingSetup.frameworkRecommendation.recommended}`
    );
    lines.push(
      `- Recommendation rationale: ${result.currentTestingSetup.frameworkRecommendation.rationale}`
    );
  }

  if (result.currentTestingSetup.ciIntegration.workflows.length > 0) {
    lines.push(
      `- CI workflows: ${result.currentTestingSetup.ciIntegration.workflows.join(", ")}`
    );
  }

  if (result.currentTestingSetup.ciIntegration.evidence.length > 0) {
    lines.push(
      `- CI evidence: ${result.currentTestingSetup.ciIntegration.evidence.slice(0, 5).join("; ")}`
    );
  }

  if (result.currentTestingSetup.notes.length > 0) {
    lines.push("");
    lines.push("## Notes");
    lines.push(...result.currentTestingSetup.notes.map((note) => `- ${note}`));
  }

  if (result.currentTestingSetup.ciIntegration.notes.length > 0) {
    lines.push("");
    lines.push("## CI notes");
    lines.push(
      ...result.currentTestingSetup.ciIntegration.notes.map((note) => `- ${note}`)
    );
  }

  lines.push("", "## Prioritized findings", "");
  if (result.findings.length === 0) {
    lines.push("No prioritized testing backlog findings were detected for this repository.");
    lines.push("");
  } else {
    for (const finding of result.findings) {
      lines.push(`### ${finding.title}`);
      lines.push(`- Priority: ${toTitleCase(finding.priority)}`);
      lines.push(`- Suggested test types: ${finding.suggestedTestTypes.join(", ")}`);
      lines.push(`- Rationale: ${finding.rationale}`);
      if (finding.existingCoverage) {
        lines.push(`- Existing coverage signal: ${finding.existingCoverage}`);
      }
      lines.push(
        `- Related paths: ${finding.relatedPaths.map((path) => `\`${path}\``).join(", ")}`
      );
      lines.push(`- Draft issue title: ${finding.issueTitle}`);
      lines.push("");
    }
  }

  lines.push(...formatCreatedIssueResultLines(createdIssues));

  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function formatFeatureBacklogMarkdown(
  result: Awaited<ReturnType<typeof analyzeFeatureBacklog>>,
  createdIssues: CreatedIssueRecord[]
): string {
  const lines: string[] = [
    "# AI Feature Backlog",
    "",
    "## Summary",
    result.summary,
    "",
    "## Repository signals",
    `- CLI surface: ${toTitleCase(String(result.repositorySignals.hasCli))}`,
    `- GitHub Actions: ${toTitleCase(String(result.repositorySignals.hasGitHubActions))}`,
    `- Existing tests: ${toTitleCase(String(result.repositorySignals.hasTests))}`,
    `- Issue templates: ${toTitleCase(String(result.repositorySignals.hasIssueTemplates))}`,
    `- Release automation: ${toTitleCase(String(result.repositorySignals.hasReleaseAutomation))}`,
    `- Examples/templates: ${toTitleCase(String(result.repositorySignals.hasExamples))}`,
    `- Package manifests: ${result.repositorySignals.packageCount}`,
    `- Workflows: ${result.repositorySignals.workflowCount}`,
    `- Provider adapters: ${result.repositorySignals.providerCount}`,
  ];

  if (result.repositorySignals.evidence.length > 0) {
    lines.push(
      `- Evidence: ${result.repositorySignals.evidence.slice(0, 5).join("; ")}`
    );
  }

  if (result.repositorySignals.notes.length > 0) {
    lines.push("", "## Notes");
    lines.push(...result.repositorySignals.notes.map((note) => `- ${note}`));
  }

  lines.push("", "## Prioritized suggestions", "");
  for (const suggestion of result.suggestions) {
    lines.push(`### ${suggestion.title}`);
    lines.push(`- Priority: ${toTitleCase(suggestion.priority)}`);
    lines.push(`- Category: ${toTitleCase(suggestion.category)}`);
    lines.push(`- Rationale: ${suggestion.rationale}`);
    lines.push(`- Evidence: ${suggestion.evidence.join("; ")}`);
    lines.push(
      `- Related paths: ${suggestion.relatedPaths.map((path) => `\`${path}\``).join(", ")}`
    );
    lines.push(`- Draft issue title: ${suggestion.issueTitle}`);
    lines.push("");
  }

  if (createdIssues.length > 0) {
    lines.push("## Issue results");
    lines.push(
      ...createdIssues.map(
        (issue) =>
          `- ${issue.status === "created" ? "Created" : "Reused"} #${issue.number}: ${issue.title} (${issue.url})`
      )
    );
    lines.push("");
  }

  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

function parseNumberedSelection(
  response: string,
  maxIndex: number,
  itemType = "item"
): number[] {
  const normalized = response.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "n") {
    return [];
  }

  if (normalized === "all") {
    return Array.from({ length: maxIndex }, (_, index) => index);
  }

  const selected = new Set<number>();
  for (const part of response.split(",")) {
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `Invalid selection "${trimmed}". Use comma-separated ${itemType} numbers, "all", or "none".`
      );
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maxIndex) {
      throw new Error(
        `Invalid selection "${trimmed}". Choose ${itemType} values between 1 and ${maxIndex}.`
      );
    }

    selected.add(parsed - 1);
  }

  return [...selected].sort((left, right) => left - right);
}

function formatCreatedIssueResultLines(createdIssues: CreatedIssueRecord[]): string[] {
  if (createdIssues.length === 0) {
    return [];
  }

  return [
    "## Issue results",
    ...createdIssues.map(
      (issue) =>
        `- ${issue.status === "created" ? "Created" : "Reused"} #${issue.number}: ${issue.title} (${issue.url})`
    ),
    "",
  ];
}

function parseTestBacklogIssueSelection(response: string, maxIndex: number): number[] {
  const normalized = response.trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return Array.from({ length: maxIndex }, (_, index) => index);
  }

  return parseNumberedSelection(response, maxIndex, "finding");
}

function appendAdditionalDescription(body: string, additionalDescription: string): string {
  const trimmed = additionalDescription.trim();
  if (!trimmed) {
    return body;
  }

  return `${body}\n\n## Maintainer notes\n${trimmed}\n`;
}

async function maybeCreateTestBacklogIssues(
  options: TestBacklogCommandOptions,
  analysis: Awaited<ReturnType<typeof analyzeTestBacklog>>,
  selectedIndexes = analysis.findings
    .slice(0, options.maxIssues)
    .map((_, index) => index)
): Promise<CreatedIssueRecord[]> {
  if (!options.createIssues) {
    return [];
  }

  const forge = getRepositoryForge(options.repoRoot);
  const createdIssues: CreatedIssueRecord[] = [];

  for (const findingIndex of selectedIndexes) {
    const finding = analysis.findings[findingIndex];
    if (!finding) {
      continue;
    }

    createdIssues.push(
      await forge.createOrReuseIssue(
        finding.issueTitle,
        finding.issueBody,
        options.labels
      )
    );
  }

  return createdIssues;
}

async function maybePromptForTestBacklogIssueCreation(
  options: TestBacklogCommandOptions,
  analysis: Awaited<ReturnType<typeof analyzeTestBacklog>>
): Promise<CreatedIssueRecord[]> {
  if (
    options.createIssues ||
    options.format !== "markdown" ||
    analysis.findings.length === 0 ||
    !process.stdin.isTTY
  ) {
    return [];
  }

  const shouldCreateIssues = await promptForYesNoDefaultYes(
    "Do you want to create GitHub issues now? (Y/n): "
  );
  if (!shouldCreateIssues) {
    return [];
  }

  const candidateFindings = analysis.findings.slice(0, options.maxIssues);
  const issueNumbers = candidateFindings
    .map((_, index) => String(index + 1))
    .join(",");
  const rawSelection = await promptForLine(
    `Which issues would you like to create? (ALL/${issueNumbers}): `
  );
  const selectedIndexes = parseTestBacklogIssueSelection(
    rawSelection,
    candidateFindings.length
  );

  return maybeCreateTestBacklogIssues(
    {
      ...options,
      createIssues: true,
    },
    analysis,
    selectedIndexes
  );
}

async function maybeCreateFeatureBacklogIssues(
  options: FeatureBacklogCommandOptions,
  analysis: Awaited<ReturnType<typeof analyzeFeatureBacklog>>
): Promise<CreatedIssueRecord[]> {
  if (!options.createIssues) {
    return [];
  }

  const forge = getRepositoryForge(options.repoRoot);
  const createdIssues: CreatedIssueRecord[] = [];
  const selectionPrompt = analysis.suggestions
    .map((suggestion, index) => `${index + 1}:${suggestion.issueTitle}`)
    .join(", ");
  const rawSelection = await promptForLine(
    `Create issues for which suggestions? [all|none|${selectionPrompt}]: `
  );
  const selectedIndexes = parseNumberedSelection(
    rawSelection,
    analysis.suggestions.length,
    "suggestion"
  ).slice(0, options.maxIssues);

  if (selectedIndexes.length === 0) {
    return [];
  }

  for (const suggestionIndex of selectedIndexes) {
    const suggestion = analysis.suggestions[suggestionIndex];
    const titleInput = await promptForLine(
      `Issue title [${suggestion.issueTitle}]: `
    );
    const issueTitle = titleInput.trim() || suggestion.issueTitle;
    const extraDescription = await promptForLine(
      "Additional description (optional): "
    );
    const labelsInput = await promptForLine(
      `Labels [${options.labels.join(",")}]: `
    );
    const labels = labelsInput.trim()
      ? labelsInput
          .split(",")
          .map((label) => label.trim())
          .filter(Boolean)
      : options.labels;

    createdIssues.push(
      await forge.createOrReuseIssue(
        issueTitle,
        appendAdditionalDescription(suggestion.issueBody, extraDescription),
        labels
      )
    );
  }

  return createdIssues;
}

export async function runTestBacklogCommand(args = getCliArgs()): Promise<void> {
  const options = parseTestBacklogCommandArgs(args);
  const repositoryConfig = getRepositoryConfig(options.repoRoot);
  const analysis = await analyzeTestBacklog({
    excludePaths: repositoryConfig.aiContext.excludePaths,
    repoRoot: options.repoRoot,
    maxFindings: options.top,
  });
  const createdIssues = await maybeCreateTestBacklogIssues(options, analysis);
  const output = {
    ...analysis,
    createdIssues,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatTestBacklogMarkdown(analysis, createdIssues)}\n`);

  const interactivelyCreatedIssues = await maybePromptForTestBacklogIssueCreation(
    options,
    analysis
  );
  if (interactivelyCreatedIssues.length > 0) {
    process.stdout.write(
      `\n${formatCreatedIssueResultLines(interactivelyCreatedIssues).join("\n")}`
    );
  }
}

export async function runFeatureBacklogCommand(args = getCliArgs()): Promise<void> {
  const options = parseFeatureBacklogCommandArgs(args);
  const repositoryConfig = getRepositoryConfig(options.repoRoot);
  const analysis = await analyzeFeatureBacklog({
    excludePaths: repositoryConfig.aiContext.excludePaths,
    repoRoot: options.repoRoot,
    maxSuggestions: options.top,
  });
  const createdIssues = await maybeCreateFeatureBacklogIssues(options, analysis);
  const output = {
    ...analysis,
    createdIssues,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatFeatureBacklogMarkdown(analysis, createdIssues)}\n`);
}


