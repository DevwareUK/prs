import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createIssueDraftWorkspace,
} from "./workflows/issue/drafts";
import {
  parseObservabilityFindingsArtifact,
  writeObservabilityImportWorkspaceFiles,
} from "./workflows/issue/observability-import";

function createRepoRoot(): string {
  const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-observability-import-"));
  mkdirSync(resolve(repoRoot, ".prs"), { recursive: true });
  return repoRoot;
}

function createArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    site: "cfp",
    environment: "prod",
    window: "24h",
    generatedAt: "2026-06-25T08:00:00Z",
    findings: [
      {
        id: "obs-cfp-faro-errors",
        title: "Faro browser errors increased on CFP production",
        severity: "high",
        actionable: true,
        owningRepo: "DevwareUK/CF8",
        service: "cfp-web",
        count: 37,
        fingerprint: "cfp:faro:browser-errors",
        query: {
          datasource: "loki",
          expression: "{site=\"cfp\", env=\"prod\"} |= \"browser_error\"",
        },
        suggestedIssue: {
          title: "Investigate Faro browser errors on CFP production",
          body: "Faro reported a spike in browser errors for CFP production.",
        },
        evidence: [
          {
            timestamp: "2026-06-25T07:55:00Z",
            message: "TypeError: failed to fetch checkout summary",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("DSM observability findings import", () => {
  it("rejects unsupported artifact versions with a clear message", () => {
    expect(() => parseObservabilityFindingsArtifact({ ...createArtifact(), version: 2 }))
      .toThrow("Unsupported DSM observability findings artifact version 2");
  });

  it("keeps importing valid findings while reporting skipped malformed findings", () => {
    const result = parseObservabilityFindingsArtifact(
      createArtifact({
        findings: [
          ...(createArtifact().findings as unknown[]),
          {
            id: "obs-missing-query",
            title: "Missing query should be skipped",
            severity: "high",
            actionable: true,
            owningRepo: "DevwareUK/CF8",
            suggestedIssue: {
              title: "Skipped malformed issue",
            },
          },
        ],
      })
    );

    expect(result.findings).toHaveLength(1);
    expect(result.skipped).toEqual([
      {
        id: "obs-missing-query",
        reason: "missing-query",
      },
    ]);
  });

  it("writes local issue draft, spec, and plan artifacts for non-duplicate active-repo findings", () => {
    const repoRoot = createRepoRoot();
    const workspace = createIssueDraftWorkspace(repoRoot);
    const artifactPath = resolve(repoRoot, "dsm-observability-findings.json");
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        createArtifact({
          findings: [
            ...(createArtifact().findings as unknown[]),
            {
              id: "obs-existing-node-exporter",
              title: "Node exporter is already tracked",
              severity: "high",
              actionable: true,
              owningRepo: "DevwareUK/CF8",
              service: "node-exporter",
              count: 6,
              fingerprint: "cfp:node-exporter:down",
              query: "up{job=\"node-exporter\"} == 0",
              suggestedIssue: {
                title: "Investigate node exporter outage on CFP production",
                body: "Node exporter is down.",
              },
            },
            {
              id: "obs-bos-runtime-errors",
              title: "BOS errors belong in the BOS repository",
              severity: "high",
              actionable: true,
              owningRepo: "DevwareUK/BOS",
              query: "rate(errors_total[5m]) > 0",
              suggestedIssue: {
                title: "Investigate BOS production runtime errors",
              },
            },
            {
              id: "obs-informational-dashboard",
              title: "Informational dashboard annotation",
              severity: "high",
              actionable: false,
              owningRepo: "DevwareUK/CF8",
              query: "sum(rate(info_total[5m]))",
              suggestedIssue: {
                title: "Informational annotation should not create work",
              },
            },
          ],
        }),
        null,
        2
      )}\n`
    );

    const result = writeObservabilityImportWorkspaceFiles({
      repoRoot,
      workspace,
      artifactFilePath: artifactPath,
      activeRepo: "DevwareUK/CF8",
      existingIssues: [
        {
          number: 123,
          title: "Investigate node exporter outage on CFP production",
          url: "https://github.com/DevwareUK/CF8/issues/123",
        },
      ],
    });

    expect(result.selected).toHaveLength(1);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        {
          id: "obs-existing-node-exporter",
          reason: "duplicate",
          url: "https://github.com/DevwareUK/CF8/issues/123",
        },
        {
          id: "obs-bos-runtime-errors",
          reason: "wrong-repo",
          owningRepo: "DevwareUK/BOS",
        },
        {
          id: "obs-informational-dashboard",
          reason: "not-actionable",
        },
      ])
    );
    expect(readFileSync(workspace.draftFilePath, "utf8")).toContain(
      "<!-- prs:observability-finding-id obs-cfp-faro-errors -->"
    );
    expect(readFileSync(workspace.superpowersSpecFilePath, "utf8")).toContain(
      "Query Details"
    );
    expect(readFileSync(workspace.superpowersPlanFilePath, "utf8")).toContain(
      "Verification"
    );
    expect(readFileSync(workspace.metadataFilePath, "utf8")).toContain(
      "\"flow\": \"observability-import\""
    );
  });

  it("writes issue-set artifacts for multiple selected findings without a shared spec path", () => {
    const repoRoot = createRepoRoot();
    const workspace = createIssueDraftWorkspace(repoRoot);
    const artifactPath = resolve(repoRoot, "dsm-observability-findings.json");
    writeFileSync(
      artifactPath,
      `${JSON.stringify(
        createArtifact({
          findings: [
            ...(createArtifact().findings as unknown[]),
            {
              id: "obs-cfp-checkout-errors",
              title: "Checkout errors increased on CFP production",
              severity: "medium",
              actionable: true,
              owningRepo: "DevwareUK/CF8",
              service: "cfp-checkout",
              count: 12,
              fingerprint: "cfp:checkout:errors",
              query: "sum(rate(checkout_errors_total[5m])) > 0",
              suggestedIssue: {
                title: "Investigate checkout errors on CFP production",
              },
            },
          ],
        }),
        null,
        2
      )}\n`
    );

    const result = writeObservabilityImportWorkspaceFiles({
      repoRoot,
      workspace,
      artifactFilePath: artifactPath,
      activeRepo: "DevwareUK/CF8",
    });

    expect(result.selected).toHaveLength(2);
    expect(existsSync(workspace.issueSetFilePath)).toBe(true);
    expect(existsSync(workspace.superpowersSpecFilePath)).toBe(false);
    const issueSet = JSON.parse(readFileSync(workspace.issueSetFilePath, "utf8")) as {
      mode: string;
      issues: Array<{ id: string; draftFile: string }>;
    };
    expect(issueSet.mode).toBe("multiple");
    expect(issueSet.issues.map((issue) => issue.id)).toEqual([
      "obs-cfp-faro-errors",
      "obs-cfp-checkout-errors",
    ]);
    for (const issue of issueSet.issues) {
      expect(issue.draftFile).toContain(".prs/runs/");
    }
  });
});
