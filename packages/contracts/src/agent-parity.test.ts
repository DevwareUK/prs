import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentLifecycleSmokeMatrix } from "./agent-parity";

const commitShas = {
  codex: "a".repeat(40),
  "claude-code": "b".repeat(40),
  copilot: "c".repeat(40),
} as const;

function completedRow(host: keyof typeof commitShas) {
  return {
    host,
    runner: `${host} native session`,
    issueUrl: `https://github.com/example/disposable-prs-smoke/issues/${
      host === "codex" ? 1 : host === "claude-code" ? 2 : 3
    }`,
    pullRequestUrl: `https://github.com/example/disposable-prs-smoke/pull/${
      host === "codex" ? 11 : host === "claude-code" ? 12 : 13
    }`,
    phases: {
      create: { status: "passed", evidence: "issue created" },
      refine: { status: "passed", evidence: "specification approved" },
      plan: { status: "passed", evidence: "plan approved" },
      implement: { status: "passed", evidence: "change committed" },
      verify: { status: "passed", evidence: "local checks passed" },
      finalize: { status: "passed", evidence: "staged changes finalized" },
      "open-pr": { status: "passed", evidence: "pull request opened" },
      validate: { status: "passed", evidence: "hosted checks passed" },
    },
    safety: {
      artifactRoot: ".prs/runs",
      artifactPaths: [
        `.prs/runs/${host}-safety/issue-draft.md`,
        `.prs/runs/${host}-safety/spec.md`,
        `.prs/runs/${host}-safety/plan.md`,
        `.prs/runs/${host}-safety/completion.md`,
      ],
      commitSha: commitShas[host],
      committedPaths: ["src/status.js", "test/status.test.js"],
      sentinel: {
        path: `sentinel-${host}.txt`,
        state: "untracked",
        evidence: "present in git status after finalization",
      },
      checks: [
        { name: "pnpm test", status: "passed", evidence: "tests passed" },
        { name: "pnpm lint", status: "passed", evidence: "lint passed" },
        { name: "pnpm build", status: "passed", evidence: "build passed" },
      ],
      capabilityFallbacks: [],
      deviations: [],
    },
  };
}

function completedMatrix() {
  return {
    version: 2,
    repository: "https://github.com/example/disposable-prs-smoke",
    recordedAt: "2026-08-27T12:00:00.000Z",
    hosts: [completedRow("codex"), completedRow("claude-code"), completedRow("copilot")],
  };
}

describe("agent lifecycle smoke evidence", () => {
  it("keeps the checked-in version-2 three-host template schema-valid", () => {
    const template = JSON.parse(
      readFileSync(resolve("docs/examples/agent-lifecycle-smoke-matrix.template.json"), "utf8")
    );
    expect(AgentLifecycleSmokeMatrix.parse(template)).toMatchObject({ version: 2 });
  });

  it("accepts separately attributable completed native smoke rows", () => {
    expect(AgentLifecycleSmokeMatrix.parse(completedMatrix()).hosts).toHaveLength(3);
  });

  it.each([
    ["omits finalize", (matrix: any) => delete matrix.hosts[0].phases.finalize],
    ["commits a workflow artifact", (matrix: any) => {
      matrix.hosts[0].safety.committedPaths.push(matrix.hosts[0].safety.artifactPaths[0]);
    }],
    ["commits its sentinel path", (matrix: any) => {
      matrix.hosts[0].safety.committedPaths.push(matrix.hosts[0].safety.sentinel.path);
    }],
    ["reports its sentinel as committed", (matrix: any) => {
      matrix.hosts[0].safety.sentinel.state = "committed";
    }],
    ["has a failed local check", (matrix: any) => {
      matrix.hosts[0].safety.checks[0].status = "failed";
    }],
    ["lacks its own pull request URL", (matrix: any) => delete matrix.hosts[0].pullRequestUrl],
    ["duplicates another host", (matrix: any) => {
      matrix.hosts[2].host = "codex";
    }],
  ])("rejects completed evidence that %s", (_scenario, mutate) => {
    const matrix = completedMatrix();
    mutate(matrix);
    expect(() =>
      AgentLifecycleSmokeMatrix.parse(matrix)
    ).toThrow();
  });

  it.each([
    ["an absolute artifact path", (matrix: any) => {
      matrix.hosts[0].safety.artifactPaths[0] = "/.prs/runs/codex-safety/spec.md";
    }],
    ["a parent-traversing committed path", (matrix: any) => {
      matrix.hosts[0].safety.committedPaths[0] = "../src/status.js";
    }],
    ["a backslash-delimited artifact path", (matrix: any) => {
      matrix.hosts[0].safety.artifactPaths[0] = ".prs\\runs\\codex-safety\\spec.md";
    }],
    ["a dot-prefixed artifact path", (matrix: any) => {
      matrix.hosts[0].safety.artifactPaths[0] = "./.prs/runs/codex-safety/spec.md";
    }],
    ["a dot-prefixed sentinel path", (matrix: any) => {
      matrix.hosts[0].safety.sentinel.path = "./sentinel-codex.txt";
    }],
    ["a Windows drive-prefixed committed path", (matrix: any) => {
      matrix.hosts[0].safety.committedPaths[0] = "C:src/status.js";
    }],
    ["an empty sentinel path", (matrix: any) => {
      matrix.hosts[0].safety.sentinel.path = "";
    }],
    ["an empty committed path segment", (matrix: any) => {
      matrix.hosts[0].safety.committedPaths[0] = "src//status.js";
    }],
    ["a trailing committed path segment", (matrix: any) => {
      matrix.hosts[0].safety.committedPaths[0] = "src/status.js/";
    }],
    ["a dot committed path segment", (matrix: any) => {
      matrix.hosts[0].safety.committedPaths[0] = "src/./status.js";
    }],
  ])("rejects completed evidence with %s", (_scenario, mutate) => {
    const matrix = completedMatrix();
    mutate(matrix);
    expect(() => AgentLifecycleSmokeMatrix.parse(matrix)).toThrow();
  });

  it.each([
    ["shares a runner", (matrix: any) => {
      matrix.hosts[1].runner = matrix.hosts[0].runner;
    }],
    ["shares an issue URL", (matrix: any) => {
      matrix.hosts[1].issueUrl = matrix.hosts[0].issueUrl;
    }],
    ["shares a pull request URL", (matrix: any) => {
      matrix.hosts[1].pullRequestUrl = matrix.hosts[0].pullRequestUrl;
    }],
    ["uses an issue URL for another repository", (matrix: any) => {
      matrix.hosts[0].issueUrl = "https://github.com/example/other-repository/issues/1";
    }],
    ["uses a pull request URL as its issue URL", (matrix: any) => {
      matrix.hosts[0].issueUrl = "https://github.com/example/disposable-prs-smoke/pull/1";
    }],
    ["uses a mailto pull request URL", (matrix: any) => {
      matrix.hosts[0].pullRequestUrl = "mailto:smoke@example.com";
    }],
    ["uses an issue URL with a query string", (matrix: any) => {
      matrix.hosts[0].issueUrl =
        "https://github.com/example/disposable-prs-smoke/issues/1?host=copy";
    }],
    ["uses a pull request URL with a fragment", (matrix: any) => {
      matrix.hosts[0].pullRequestUrl =
        "https://github.com/example/disposable-prs-smoke/pull/11#checks";
    }],
    ["uses an issue URL with an explicit default port", (matrix: any) => {
      matrix.hosts[0].issueUrl =
        "https://github.com:443/example/disposable-prs-smoke/issues/1";
    }],
    ["uses a pull request URL with a nondefault port", (matrix: any) => {
      matrix.hosts[0].pullRequestUrl =
        "https://github.com:444/example/disposable-prs-smoke/pull/11";
    }],
    ["uses an issue URL with credentials", (matrix: any) => {
      matrix.hosts[0].issueUrl =
        "https://token@github.com/example/disposable-prs-smoke/issues/1";
    }],
    ["uses a backslash-delimited issue URL", (matrix: any) => {
      matrix.hosts[0].issueUrl =
        "https://github.com\\example\\disposable-prs-smoke\\issues\\1";
    }],
    ["uses a parent-traversing pull request URL", (matrix: any) => {
      matrix.hosts[0].pullRequestUrl =
        "https://github.com/example/disposable-prs-smoke/extra/../pull/11";
    }],
    ["uses an encoded-dot issue URL", (matrix: any) => {
      matrix.hosts[0].issueUrl =
        "https://github.com/example/disposable-prs-smoke/%2e/issues/1";
    }],
    ["uses a pull request URL with an embedded tab", (matrix: any) => {
      matrix.hosts[0].pullRequestUrl =
        "https://github.com/example/disposable-prs-smoke/pull/\t11";
    }],
  ])("rejects completed evidence that %s", (_scenario, mutate) => {
    const matrix = completedMatrix();
    mutate(matrix);
    expect(() => AgentLifecycleSmokeMatrix.parse(matrix)).toThrow();
  });

  it("normalizes GitHub owner, repository, and issue number before detecting duplicate evidence", () => {
    const matrix = completedMatrix();
    matrix.hosts[0].issueUrl = "https://github.com/EXAMPLE/DISPOSABLE-PRS-SMOKE/issues/01";
    expect(() => AgentLifecycleSmokeMatrix.parse(matrix)).not.toThrow();

    matrix.hosts[1].issueUrl = "https://github.com/example/disposable-prs-smoke/issues/1";
    expect(() => AgentLifecycleSmokeMatrix.parse(matrix)).toThrow();
  });

  it.each([
    ["a trailing line feed in the matrix repository", (matrix: any) => {
      matrix.repository += "\n";
    }],
    ["a trailing carriage return in an issue URL", (matrix: any) => {
      matrix.hosts[0].issueUrl += "\r";
    }],
    ["a trailing line separator in a pull request URL", (matrix: any) => {
      matrix.hosts[0].pullRequestUrl += "\u2028";
    }],
    ["a trailing paragraph separator in an issue URL", (matrix: any) => {
      matrix.hosts[0].issueUrl += "\u2029";
    }],
  ])("rejects completed evidence with %s", (_scenario, mutate) => {
    const matrix = completedMatrix();
    mutate(matrix);
    expect(() => AgentLifecycleSmokeMatrix.parse(matrix)).toThrow();
  });
});
