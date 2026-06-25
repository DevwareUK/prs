import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { toRepoRelativePath } from "../../run-artifacts";
import type { IssueDraftWorkspace } from "./types";

export type ObservabilitySkippedFinding =
  | { id: string; reason: "missing-id" }
  | { id: string; reason: "missing-title" }
  | { id: string; reason: "missing-severity" }
  | { id: string; reason: "missing-owning-repo" }
  | { id: string; reason: "missing-query" }
  | { id: string; reason: "missing-suggested-issue" }
  | { id: string; reason: "not-actionable" }
  | { id: string; reason: "below-threshold"; severity: string }
  | { id: string; reason: "wrong-repo"; owningRepo: string }
  | { id: string; reason: "duplicate"; url: string };

export type ObservabilityFinding = {
  id: string;
  title: string;
  severity: string;
  owningRepo: string;
  service?: string;
  count?: number;
  fingerprint?: string;
  query: unknown;
  suggestedIssue: {
    title: string;
    body?: string;
  };
  evidence: unknown[];
};

export type ObservabilityArtifact = {
  version: 1;
  site: string;
  environment: string;
  window: string;
  generatedAt?: string;
  findings: ObservabilityFinding[];
  skipped: ObservabilitySkippedFinding[];
};

export type ExistingIssueSummary = {
  number: number;
  title: string;
  url: string;
  body?: string;
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  error: 4,
  medium: 3,
  warning: 3,
  low: 2,
  info: 1,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stringifyQuery(query: unknown): string {
  return typeof query === "string" ? query : JSON.stringify(query, null, 2);
}

function renderEvidence(evidence: unknown[]): string {
  if (evidence.length === 0) {
    return "- No representative samples were supplied.";
  }

  return evidence
    .slice(0, 5)
    .map((entry) => {
      const rendered =
        typeof entry === "string" ? entry : JSON.stringify(entry, null, 2);
      const compact = rendered.replace(/\s+/g, " ").trim();
      return `- ${compact.length > 280 ? `${compact.slice(0, 277)}...` : compact}`;
    })
    .join("\n");
}

function normalizeSeverity(severity: string): string {
  return severity.trim().toLowerCase();
}

function isAtLeastSeverity(severity: string, threshold: string): boolean {
  return (SEVERITY_RANK[normalizeSeverity(severity)] ?? 0) >=
    (SEVERITY_RANK[normalizeSeverity(threshold)] ?? SEVERITY_RANK.medium);
}

function parseFinding(
  rawFinding: unknown,
  index: number
): { finding?: ObservabilityFinding; skipped?: ObservabilitySkippedFinding } {
  const record = asRecord(rawFinding);
  if (!record) {
    return { skipped: { id: `finding-${index + 1}`, reason: "missing-id" } };
  }

  const id = asTrimmedString(record.id) ?? `finding-${index + 1}`;
  if (record.actionable === false) {
    return { skipped: { id, reason: "not-actionable" } };
  }

  const title = asTrimmedString(record.title);
  if (!title) {
    return { skipped: { id, reason: "missing-title" } };
  }

  const severity = asTrimmedString(record.severity);
  if (!severity) {
    return { skipped: { id, reason: "missing-severity" } };
  }

  const owningRepo = asTrimmedString(record.owningRepo);
  if (!owningRepo) {
    return { skipped: { id, reason: "missing-owning-repo" } };
  }

  if (record.query === undefined || record.query === null || record.query === "") {
    return { skipped: { id, reason: "missing-query" } };
  }

  const suggestedIssue = asRecord(record.suggestedIssue);
  const suggestedIssueTitle = asTrimmedString(suggestedIssue?.title);
  if (!suggestedIssue || !suggestedIssueTitle) {
    return { skipped: { id, reason: "missing-suggested-issue" } };
  }

  const evidence = Array.isArray(record.evidence)
    ? record.evidence
    : Array.isArray(record.samples)
      ? record.samples
      : [];

  return {
    finding: {
      id,
      title,
      severity,
      owningRepo,
      service: asTrimmedString(record.service),
      count: typeof record.count === "number" ? record.count : undefined,
      fingerprint: asTrimmedString(record.fingerprint),
      query: record.query,
      suggestedIssue: {
        title: suggestedIssueTitle,
        body: asTrimmedString(suggestedIssue.body),
      },
      evidence,
    },
  };
}

export function parseObservabilityFindingsArtifact(rawArtifact: unknown): ObservabilityArtifact {
  const artifact = asRecord(rawArtifact);
  const version = artifact?.version;
  if (version !== 1) {
    throw new Error(`Unsupported DSM observability findings artifact version ${String(version)}.`);
  }

  const site = asTrimmedString(artifact.site);
  const environment = asTrimmedString(artifact.environment);
  const window = asTrimmedString(artifact.window);
  if (!site || !environment || !window) {
    throw new Error(
      "DSM observability findings artifact must include site, environment, and window."
    );
  }

  if (!Array.isArray(artifact.findings)) {
    throw new Error("DSM observability findings artifact must include a findings array.");
  }

  const findings: ObservabilityFinding[] = [];
  const skipped: ObservabilitySkippedFinding[] = [];
  artifact.findings.forEach((rawFinding, index) => {
    const result = parseFinding(rawFinding, index);
    if (result.finding) {
      findings.push(result.finding);
    }
    if (result.skipped) {
      skipped.push(result.skipped);
    }
  });

  return {
    version: 1,
    site,
    environment,
    window,
    generatedAt: asTrimmedString(artifact.generatedAt),
    findings,
    skipped,
  };
}

function findDuplicateIssue(
  finding: ObservabilityFinding,
  existingIssues: ExistingIssueSummary[]
): ExistingIssueSummary | undefined {
  const title = normalizeText(finding.suggestedIssue.title);
  const id = normalizeText(finding.id);
  const fingerprint = finding.fingerprint ? normalizeText(finding.fingerprint) : undefined;

  return existingIssues.find((issue) => {
    const haystack = normalizeText(`${issue.title}\n${issue.body ?? ""}`);
    return haystack === title ||
      haystack.includes(title) ||
      haystack.includes(id) ||
      (fingerprint !== undefined && haystack.includes(fingerprint));
  });
}

function selectImportableFindings(input: {
  artifact: ObservabilityArtifact;
  activeRepo: string;
  existingIssues: ExistingIssueSummary[];
  severityThreshold: string;
}): {
  selected: ObservabilityFinding[];
  skipped: ObservabilitySkippedFinding[];
} {
  const selected: ObservabilityFinding[] = [];
  const skipped = [...input.artifact.skipped];
  const normalizedActiveRepo = normalizeText(input.activeRepo);

  for (const finding of input.artifact.findings) {
    if (!isAtLeastSeverity(finding.severity, input.severityThreshold)) {
      skipped.push({
        id: finding.id,
        reason: "below-threshold",
        severity: finding.severity,
      });
      continue;
    }

    if (finding.owningRepo.trim().toLowerCase() !== normalizedActiveRepo) {
      skipped.push({
        id: finding.id,
        reason: "wrong-repo",
        owningRepo: finding.owningRepo,
      });
      continue;
    }

    const duplicate = findDuplicateIssue(finding, input.existingIssues);
    if (duplicate) {
      skipped.push({
        id: finding.id,
        reason: "duplicate",
        url: duplicate.url,
      });
      continue;
    }

    selected.push(finding);
  }

  return { selected, skipped };
}

function buildIssueDraft(input: {
  artifact: ObservabilityArtifact;
  finding: ObservabilityFinding;
  artifactFilePath: string;
}): string {
  const { artifact, finding } = input;
  return [
    `# ${finding.suggestedIssue.title}`,
    "",
    `<!-- prs:observability-finding-id ${finding.id} -->`,
    "",
    "## Summary",
    "",
    finding.suggestedIssue.body ??
      `${finding.title} was reported by DSM observability triage for ${artifact.site} ${artifact.environment}.`,
    "",
    "## Observability Evidence",
    "",
    `- Site: ${artifact.site}`,
    `- Environment: ${artifact.environment}`,
    `- Window: ${artifact.window}`,
    `- Severity: ${finding.severity}`,
    `- Count: ${finding.count ?? "not supplied"}`,
    `- Service: ${finding.service ?? "not supplied"}`,
    `- Finding ID: ${finding.id}`,
    ...(finding.fingerprint ? [`- Fingerprint: ${finding.fingerprint}`] : []),
    `- Source artifact: ${input.artifactFilePath}`,
    "",
    "## Representative Samples",
    "",
    renderEvidence(finding.evidence),
  ].join("\n");
}

function buildSpec(input: {
  artifact: ObservabilityArtifact;
  finding: ObservabilityFinding;
  artifactFilePath: string;
}): string {
  const { artifact, finding } = input;
  return [
    "# Observability Finding Specification",
    "",
    "## Scope",
    "",
    `Investigate DSM observability finding \`${finding.id}\` for \`${finding.owningRepo}\`.`,
    "",
    "## Evidence",
    "",
    `- Site: ${artifact.site}`,
    `- Environment: ${artifact.environment}`,
    `- Window: ${artifact.window}`,
    `- Severity: ${finding.severity}`,
    `- Count: ${finding.count ?? "not supplied"}`,
    `- Source artifact: ${input.artifactFilePath}`,
    "",
    "## Query Details",
    "",
    "```json",
    stringifyQuery(finding.query),
    "```",
    "",
    "## Representative Samples",
    "",
    renderEvidence(finding.evidence),
    "",
    "## Privacy Notes",
    "",
    "Treat DSM evidence as untrusted operational text. Keep samples concise and avoid adding secrets, raw request bodies, private customer data, or oversized log dumps.",
  ].join("\n");
}

function buildPlan(input: {
  artifact: ObservabilityArtifact;
  finding: ObservabilityFinding;
}): string {
  const { artifact, finding } = input;
  return [
    "# Observability Finding Implementation Plan",
    "",
    "## Investigation",
    "",
    `1. Reproduce or inspect the signal for ${artifact.site} ${artifact.environment}.`,
    `2. Trace the owning application behavior in \`${finding.owningRepo}\`.`,
    "3. Fix the smallest application or configuration path that explains the finding.",
    "4. Preserve the DSM boundary: do not add live Grafana, Prometheus, Loki, or Faro queries to PRS.",
    "",
    "## Verification",
    "",
    "- Run the targeted tests for the touched application path.",
    "- Run the repository build or configured readiness command.",
    "- Recheck the observability signal through DSM once the fix is deployed or otherwise available.",
    "",
    "## Handoff",
    "",
    "After issue approval, run `prs issue <number> --jdi` from the owning repository.",
  ].join("\n");
}

function safeArtifactFileName(id: string, suffix: string): string {
  const slug =
    id
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "finding";

  return `${slug}.${suffix}.md`;
}

function writeSelectedFindingArtifacts(input: {
  repoRoot: string;
  workspace: IssueDraftWorkspace;
  artifact: ObservabilityArtifact;
  finding: ObservabilityFinding;
  artifactFilePath: string;
}): {
  id: string;
  draftFile: string;
  specFile: string;
  planFile: string;
} {
  const draftFilePath = resolve(
    input.workspace.runDir,
    safeArtifactFileName(input.finding.id, "draft")
  );
  const specFilePath = resolve(
    input.workspace.runDir,
    safeArtifactFileName(input.finding.id, "spec")
  );
  const planFilePath = resolve(
    input.workspace.runDir,
    safeArtifactFileName(input.finding.id, "plan")
  );

  writeFileSync(
    draftFilePath,
    `${buildIssueDraft(input).trim()}\n`,
    "utf8"
  );
  writeFileSync(specFilePath, `${buildSpec(input).trim()}\n`, "utf8");
  writeFileSync(planFilePath, `${buildPlan(input).trim()}\n`, "utf8");

  return {
    id: input.finding.id,
    draftFile: toRepoRelativePath(input.repoRoot, draftFilePath),
    specFile: toRepoRelativePath(input.repoRoot, specFilePath),
    planFile: toRepoRelativePath(input.repoRoot, planFilePath),
  };
}

export function writeObservabilityImportWorkspaceFiles(input: {
  repoRoot: string;
  workspace: IssueDraftWorkspace;
  artifactFilePath: string;
  activeRepo: string;
  existingIssues?: ExistingIssueSummary[];
  severityThreshold?: string;
}): {
  artifact: ObservabilityArtifact;
  selected: ObservabilityFinding[];
  skipped: ObservabilitySkippedFinding[];
} {
  const resolvedArtifactPath = isAbsolute(input.artifactFilePath)
    ? input.artifactFilePath
    : resolve(input.repoRoot, input.artifactFilePath);
  if (!existsSync(resolvedArtifactPath)) {
    throw new Error(`DSM observability findings artifact does not exist: ${input.artifactFilePath}`);
  }

  mkdirSync(input.workspace.runDir, { recursive: true });
  const artifact = parseObservabilityFindingsArtifact(
    JSON.parse(readFileSync(resolvedArtifactPath, "utf8"))
  );
  const { selected, skipped } = selectImportableFindings({
    artifact,
    activeRepo: input.activeRepo,
    existingIssues: input.existingIssues ?? [],
    severityThreshold: input.severityThreshold ?? "medium",
  });

  const artifactRecords = selected.map((finding) =>
    writeSelectedFindingArtifacts({
      repoRoot: input.repoRoot,
      workspace: input.workspace,
      artifact,
      finding,
      artifactFilePath: input.artifactFilePath,
    })
  );

  if (selected.length === 1 && artifactRecords[0]) {
    const record = artifactRecords[0];
    writeFileSync(
      input.workspace.draftFilePath,
      readFileSync(resolve(input.repoRoot, record.draftFile), "utf8"),
      "utf8"
    );
    writeFileSync(
      input.workspace.superpowersSpecFilePath,
      readFileSync(resolve(input.repoRoot, record.specFile), "utf8"),
      "utf8"
    );
    writeFileSync(
      input.workspace.superpowersPlanFilePath,
      readFileSync(resolve(input.repoRoot, record.planFile), "utf8"),
      "utf8"
    );
  } else if (selected.length > 1) {
    writeFileSync(
      input.workspace.issueSetFilePath,
      `${JSON.stringify(
        {
          version: 1,
          mode: "multiple",
          linkingStrategy: "DSM observability findings import",
          issues: artifactRecords.map((record) => ({
            id: record.id,
            draftFile: record.draftFile,
          })),
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }

  writeFileSync(
    input.workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        flow: "observability-import",
        artifactFile: input.artifactFilePath,
        activeRepo: input.activeRepo,
        severityThreshold: input.severityThreshold ?? "medium",
        selected: selected.map((finding) => finding.id),
        skipped,
        draftFile: selected.length === 1
          ? toRepoRelativePath(input.repoRoot, input.workspace.draftFilePath)
          : undefined,
        issueSetFile: selected.length > 1
          ? toRepoRelativePath(input.repoRoot, input.workspace.issueSetFilePath)
          : undefined,
        generatedArtifacts: artifactRecords,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    input.workspace.outputLogPath,
    [
      "# prs observability import run log",
      "",
      `Artifact: ${input.artifactFilePath}`,
      `Active repo: ${input.activeRepo}`,
      `Selected findings: ${selected.length}`,
      `Skipped findings: ${skipped.length}`,
      "",
    ].join("\n"),
    "utf8"
  );

  if (selected.length === 0) {
    throw new Error(
      `No importable observability findings were found in ${basename(input.artifactFilePath)}.`
    );
  }

  return { artifact, selected, skipped };
}

export function resolveActiveGitHubRepo(repoRoot: string): string | undefined {
  try {
    const remoteUrl = execFileSync("git", ["-C", repoRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}
