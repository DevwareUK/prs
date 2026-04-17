import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeRuntimeChanges } from "./runtime-change-review";

const cleanupTargets = new Set<string>();

function createRunDir(): string {
  const runDir = mkdtempSync(resolve(tmpdir(), "git-ai-runtime-change-review-"));
  cleanupTargets.add(runDir);
  return runDir;
}

afterEach(() => {
  vi.restoreAllMocks();

  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();
});

describe("finalizeRuntimeChanges", () => {
  it("returns without committing when no changes exist before build verification", async () => {
    const run = vi.fn();
    const promptForLine = vi.fn();
    const resolveInitialCommitMessage = vi.fn();
    const commitGeneratedChanges = vi.fn();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      finalizeRuntimeChanges({
        repoRoot: "/repo",
        runDir: createRunDir(),
        commitPrompt: "Commit generated changes? [Y/n/m]: ",
        promptForLine,
        hasChanges: vi.fn().mockReturnValue(false),
        commitGeneratedChanges,
        resolveInitialCommitMessage,
        noChangesMessage: "No follow-up changes were made.",
        noChangesAction: "return",
        verifyBuild: {
          buildCommand: ["pnpm", "build"],
          outputLogPath: "/tmp/output.log",
          run,
        },
        checkForChangesBeforeBuild: true,
      })
    ).resolves.toEqual({
      committed: false,
      reason: "no-changes",
    });

    expect(run).not.toHaveBeenCalled();
    expect(promptForLine).not.toHaveBeenCalled();
    expect(resolveInitialCommitMessage).not.toHaveBeenCalled();
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith("No follow-up changes were made.");
  });

  it("stops before commit review when build verification fails", async () => {
    const promptForLine = vi.fn();
    const resolveInitialCommitMessage = vi.fn();
    const commitGeneratedChanges = vi.fn();

    await expect(
      finalizeRuntimeChanges({
        repoRoot: "/repo",
        runDir: createRunDir(),
        commitPrompt: "Commit generated changes? [Y/n/m]: ",
        promptForLine,
        hasChanges: vi.fn().mockReturnValue(true),
        commitGeneratedChanges,
        resolveInitialCommitMessage,
        noChangesMessage: "No follow-up changes were made.",
        noChangesAction: "return",
        verifyBuild: {
          buildCommand: ["pnpm", "build"],
          outputLogPath: "/tmp/output.log",
          run: vi.fn(() => {
            throw new Error("Build failed.");
          }),
        },
        checkForChangesBeforeBuild: true,
      })
    ).rejects.toThrow("Build failed.");

    expect(promptForLine).not.toHaveBeenCalled();
    expect(resolveInitialCommitMessage).not.toHaveBeenCalled();
    expect(commitGeneratedChanges).not.toHaveBeenCalled();
  });

  it("leaves generated changes uncommitted when the reviewed commit message is declined", async () => {
    const commitGeneratedChanges = vi.fn();
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      finalizeRuntimeChanges({
        repoRoot: "/repo",
        runDir: createRunDir(),
        commitPrompt: "Commit generated changes? [Y/n/m]: ",
        promptForLine: vi.fn().mockResolvedValue("n"),
        hasChanges: vi.fn().mockReturnValue(true),
        commitGeneratedChanges,
        resolveInitialCommitMessage: vi
          .fn()
          .mockResolvedValue("fix: keep follow-up changes uncommitted\n"),
        noChangesMessage: "No follow-up changes were made.",
        noChangesAction: "return",
      })
    ).resolves.toEqual({
      committed: false,
      reason: "declined",
    });

    expect(commitGeneratedChanges).not.toHaveBeenCalled();
    expect(consoleLog).toHaveBeenCalledWith("Leaving the generated changes uncommitted.");
  });
});
