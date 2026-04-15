import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getInteractiveRuntimeByType, selectInteractiveRuntime } from "./runtime";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

describe("selectInteractiveRuntime", () => {
  it("selects Claude Code when it is configured and available", () => {
    vi.mocked(spawnSync).mockImplementation((command) => {
      if (command === "claude") {
        return { status: 0 } as never;
      }

      return { status: 1, error: new Error("unexpected") } as never;
    });

    const runtime = selectInteractiveRuntime({
      type: "claude-code",
    });

    expect(runtime.type).toBe("claude-code");
    expect(runtime.displayName).toBe("Claude Code");
  });

  it("falls back to Codex when the configured Claude Code runtime is unavailable", () => {
    const onFallback = vi.fn();

    vi.mocked(spawnSync).mockImplementation((command) => {
      if (command === "claude") {
        return { status: 1, error: new Error("missing") } as never;
      }

      if (command === "codex") {
        return { status: 0 } as never;
      }

      return { status: 1, error: new Error("unexpected") } as never;
    });

    const runtime = selectInteractiveRuntime(
      {
        type: "claude-code",
      },
      {
        onFallback,
      }
    );

    expect(runtime.type).toBe("codex");
    expect(onFallback).toHaveBeenCalledWith(
      'Configured runtime "Claude Code" is unavailable because the `claude` CLI is not available on PATH. Falling back to the default runtime "Codex".'
    );
  });

  it("fails clearly when neither the configured runtime nor the default runtime is available", () => {
    vi.mocked(spawnSync).mockImplementation((command) => {
      if (command === "claude" || command === "codex") {
        return { status: 1, error: new Error("missing") } as never;
      }

      return { status: 1, error: new Error("unexpected") } as never;
    });

    expect(() =>
      selectInteractiveRuntime({
        type: "claude-code",
      })
    ).toThrow(
      'Configured runtime "Claude Code" is unavailable because the `claude` CLI is not available on PATH. The default runtime "Codex" is also unavailable because the `codex` CLI is not available on PATH.'
    );
  });

  it("does not send the original issue prompt again when resuming a Codex session", () => {
    const repoRoot = resolve(tmpdir(), "git-ai-runtime-resume-test");
    const runDir = resolve(repoRoot, ".git-ai", "runs", "20260415T000000000Z-issue-1");
    mkdirSync(runDir, { recursive: true });

    vi.mocked(spawnSync).mockImplementation((command, args) => {
      if (command === "codex") {
        return { status: 0 } as never;
      }

      return { status: 1, error: new Error("unexpected") } as never;
    });

    const runtime = getInteractiveRuntimeByType("codex");
    try {
      runtime.launch(
        repoRoot,
        {
          promptFilePath: resolve(runDir, "prompt.md"),
          outputLogPath: resolve(runDir, "output.log"),
        },
        {
          resumeSessionId: "019d5001-aaaa-7bbb-8ccc-ddddeeeeffff",
        }
      );

      expect(spawnSync).toHaveBeenCalledWith(
        "codex",
        [
          "resume",
          "019d5001-aaaa-7bbb-8ccc-ddddeeeeffff",
          "--sandbox",
          "workspace-write",
          "--ask-for-approval",
          "on-request",
          "--cd",
          repoRoot,
        ],
        expect.objectContaining({
          cwd: repoRoot,
          stdio: "inherit",
        })
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
