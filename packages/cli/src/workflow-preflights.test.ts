import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureVerificationCommandAvailable,
  preflightIssueBaseBranch,
} from "./workflow-preflights";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const spawnSyncMock = vi.mocked(spawnSync);

function createSpawnResult(
  status: number,
  output: { stdout?: string; stderr?: string; error?: Error } = {}
) {
  return {
    status,
    stdout: output.stdout ?? "",
    stderr: output.stderr ?? "",
    error: output.error,
  } as never;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("workflow preflights", () => {
  it("accepts repo-local verification commands that can run from the repository root", () => {
    const repoRoot = "/tmp/example-repo";
    spawnSyncMock.mockReturnValue(
      createSpawnResult(0, { stdout: "PHPUnit 10.0.0\n" })
    );

    expect(() =>
      ensureVerificationCommandAvailable(
        repoRoot,
        ["vendor/bin/phpunit"],
        "git-ai issue workflows"
      )
    ).not.toThrow();

    expect(spawnSyncMock).toHaveBeenCalledWith("vendor/bin/phpunit", ["--version"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  });

  it("preflights a non-main issue base branch before checkout", () => {
    const repoRoot = "/tmp/example-repo";
    spawnSyncMock
      .mockReturnValueOnce(createSpawnResult(0, { stdout: "abc123\n" }))
      .mockReturnValueOnce(createSpawnResult(0))
      .mockReturnValueOnce(createSpawnResult(0, { stdout: "def456\n" }));

    expect(preflightIssueBaseBranch(repoRoot, "develop")).toEqual({
      remoteRef: "origin/develop",
      remoteTip: "def456",
    });

    expect(spawnSyncMock).toHaveBeenNthCalledWith(1, "git", [
      "rev-parse",
      "--verify",
      "refs/heads/develop",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(2, "git", [
      "fetch",
      "origin",
      "develop",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(spawnSyncMock).toHaveBeenNthCalledWith(3, "git", [
      "rev-parse",
      "--verify",
      "refs/remotes/origin/develop",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
    });
  });

  it("fails clearly when the configured issue base branch cannot be fetched", () => {
    const repoRoot = "/tmp/example-repo";
    spawnSyncMock
      .mockReturnValueOnce(createSpawnResult(0, { stdout: "abc123\n" }))
      .mockReturnValueOnce(
        createSpawnResult(1, { stderr: "fatal: couldn't find remote ref release\n" })
      );

    expect(() => preflightIssueBaseBranch(repoRoot, "release")).toThrow(
      'Configured base branch "release" could not be fetched from origin. Ensure "origin/release" exists and is reachable'
    );
  });
});
