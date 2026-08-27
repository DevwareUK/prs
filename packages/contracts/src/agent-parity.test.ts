import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentLifecycleSmokeMatrix } from "./agent-parity";

const phases = {
  create: { status: "passed", evidence: "issue created" },
  refine: { status: "passed", evidence: "spec approved" },
  plan: { status: "passed", evidence: "plan approved" },
  implement: { status: "passed", evidence: "change committed" },
  verify: { status: "passed", evidence: "tests passed" },
  "open-pr": { status: "passed", evidence: "pull request opened" },
  validate: { status: "passed", evidence: "hosted checks passed" },
} as const;

describe("agent lifecycle smoke evidence", () => {
  it("keeps the checked-in three-host template schema-valid", () => {
    const template = JSON.parse(
      readFileSync(resolve("docs/examples/agent-lifecycle-smoke-matrix.template.json"), "utf8")
    );
    expect(AgentLifecycleSmokeMatrix.parse(template).hosts).toHaveLength(3);
  });

  it("requires one separately attributed row for every supported host", () => {
    const matrix = AgentLifecycleSmokeMatrix.parse({
      version: 1,
      repository: "https://github.com/example/disposable-prs-smoke",
      recordedAt: "2026-08-27T12:00:00.000Z",
      hosts: ["codex", "claude-code", "copilot"].map((host) => ({
        host,
        runner: `${host} local session`,
        issueUrl: `https://github.com/example/disposable-prs-smoke/issues/${host.length}`,
        pullRequestUrl: `https://github.com/example/disposable-prs-smoke/pull/${host.length}`,
        phases,
      })),
    });
    expect(matrix.hosts).toHaveLength(3);
  });

  it("rejects a missing or duplicated host row", () => {
    const row = {
      host: "codex",
      runner: "Codex local session",
      phases,
    };
    expect(() =>
      AgentLifecycleSmokeMatrix.parse({
        version: 1,
        repository: "https://github.com/example/disposable-prs-smoke",
        recordedAt: "2026-08-27T12:00:00.000Z",
        hosts: [row, row, { ...row, host: "claude-code" }],
      })
    ).toThrow();
  });
});
