import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAuditCommand } from "./audit-runner";

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("../cli-context", () => ({
  getDefaultRepoRoot: () => state.root,
  getCliArgs: () => ["audit", "validate-coverage", "--file", "coverage.json", "--json"],
}));

const fixture = readFileSync("docs/examples/release-coverage.json", "utf8");

async function validate(evidence: unknown) {
  writeFileSync(join(state.root, "coverage.json"), JSON.stringify(evidence));
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  await runAuditCommand();
  expect(stdout).toHaveBeenCalledTimes(1);
  return JSON.parse(stdout.mock.calls[0][0]);
}

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "prs-release-coverage-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(state.root, { recursive: true, force: true });
});

describe("audit release coverage", () => {
  it("reports both compatible Composer updates and each schedule status", async () => {
    expect(await validate(JSON.parse(fixture))).toMatchObject({
      status: "complete",
      lockfiles: [{
        ecosystem: "composer", status: "complete", checkedCount: 2,
        findings: [
          { package: "drupal/graphql_core_schema", lockedVersion: "1.0.29", targetVersion: "1.0.30", status: "compatible" },
          {
            package: "phpstan/phpstan-phpunit", lockedVersion: "2.1.3", targetVersion: "2.1.4", status: "compatible",
            schedule: { preparation: { status: "active" }, deployment: { status: "paused" } },
          },
        ],
      }, { ecosystem: "npm", status: "complete" }],
    });
  });

  it.each([
    ["advisory only", { kind: "advisory" }, "missing-release-comparison"],
    ["stale observation", { observedAt: "2026-11-26T12:03:00Z" }, "stale-observation"],
    ["different revision", { revision: "e283b5b48d70e6a4d6a1eb99c4e087dcc1c33251" }, "baseline-mismatch"],
    ["unreachable source", {
      checkedCount: 0,
      gaps: [{ scope: "composer.lock", reason: "unreachable", detail: "Registry timeout" }],
    }, "unreachable"],
  ])("marks Composer incomplete with %s and retains verified npm findings", async (_name, change, reason) => {
    const evidence = JSON.parse(fixture);
    Object.assign(evidence.observations[0], change, { findings: [] });
    expect(await validate(evidence)).toMatchObject({
      status: "incomplete",
      lockfiles: [{
        path: "composer.lock", status: "incomplete",
        gaps: expect.arrayContaining([expect.objectContaining({ reason })]),
        findings: [],
      }, {
        path: "assets/package-lock.json", status: "complete",
        findings: [{ package: "example-dependency", targetVersion: "1.0.1" }],
      }],
    });
  });

  it("keeps verified findings from a partially checked lockfile", async () => {
    const evidence = JSON.parse(fixture);
    const composer = evidence.observations[0];
    composer.checkedCount = 1;
    composer.findings.pop();
    composer.gaps = [{ scope: "phpstan/phpstan-phpunit", reason: "excluded", detail: "Fixture exclusion" }];
    expect(await validate(evidence)).toMatchObject({
      status: "incomplete",
      lockfiles: [{
        status: "incomplete", checkedCount: 1,
        gaps: [{ scope: "phpstan/phpstan-phpunit", reason: "excluded" }],
        findings: [{ package: "drupal/graphql_core_schema" }],
      }, { status: "complete" }],
    });
  });

  it("requires coverage for every detected lockfile even within a single ecosystem", async () => {
    const evidence = JSON.parse(fixture);
    evidence.lockfiles.push({ ecosystem: "npm", path: "admin/package-lock.json", packageCount: 1 });
    expect(await validate(evidence)).toMatchObject({
      status: "incomplete",
      lockfiles: [{ status: "complete" }, { status: "complete" }, {
        path: "admin/package-lock.json", status: "incomplete",
        gaps: [{ reason: "missing-release-comparison" }],
      }],
    });
  });

  it("marks unaccounted packages incomplete", async () => {
    const evidence = JSON.parse(fixture);
    evidence.lockfiles[0].packageCount = 3;
    expect(await validate(evidence)).toMatchObject({
      status: "incomplete",
      lockfiles: [{ gaps: [{ reason: "unchecked-entries" }] }, { status: "complete" }],
    });
  });

  it("rejects duplicate release evidence for a single lockfile", async () => {
    const evidence = JSON.parse(fixture);
    evidence.observations.push(evidence.observations[0]);
    await expect(validate(evidence)).rejects.toThrow(/duplicate release observation/i);
  });

  it("reports package coverage as not applicable for a project with no detected locks", async () => {
    const evidence = JSON.parse(fixture);
    evidence.lockfiles = [];
    evidence.observations = [];
    expect(await validate(evidence)).toMatchObject({ status: "not-applicable", lockfiles: [] });
  });
});
