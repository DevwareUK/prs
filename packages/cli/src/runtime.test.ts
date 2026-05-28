import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getInteractiveRuntimeLaunchBlocker,
  getInteractiveRuntimeByType,
  getUnattendedRuntimeLaunchBlocker,
  isCodexSuperpowersAvailable,
  selectInteractiveRuntime,
} from "./runtime";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const cleanupTargets = new Set<string>();

function createCodexHome(prefix: string): string {
  const codexHome = mkdtempSync(resolve(tmpdir(), prefix));
  cleanupTargets.add(codexHome);
  return codexHome;
}

function writeSuperpowersPlugin(codexHome: string, version = "test-version"): void {
  const pluginRoot = resolve(
    codexHome,
    "plugins",
    "cache",
    "openai-curated",
    "superpowers",
    version
  );

  mkdirSync(resolve(pluginRoot, "skills", "brainstorming"), { recursive: true });
  mkdirSync(resolve(pluginRoot, "skills", "writing-plans"), { recursive: true });
  writeFileSync(resolve(pluginRoot, "skills", "brainstorming", "SKILL.md"), "# test\n");
  writeFileSync(resolve(pluginRoot, "skills", "writing-plans", "SKILL.md"), "# test\n");
}

afterEach(() => {
  delete process.env.CODEX_HOME;
  delete process.env.CODEX_SESSION_ID;
  delete process.env.CODEX_SANDBOX;
  delete process.env.CODEX_WORKSPACE_ID;

  for (const target of cleanupTargets) {
    rmSync(target, { recursive: true, force: true });
  }
  cleanupTargets.clear();

  vi.restoreAllMocks();
});

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
    const repoRoot = resolve(tmpdir(), "prs-runtime-resume-test");
    const runDir = resolve(repoRoot, ".prs", "runs", "20260415T000000000Z-issue-1");
    mkdirSync(runDir, { recursive: true });

    vi.mocked(spawnSync).mockImplementation((command) => {
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

describe("getInteractiveRuntimeLaunchBlocker", () => {
  it("blocks legacy interactive launches in dumb, non-tty, and nested Codex contexts", () => {
    expect(
      getInteractiveRuntimeLaunchBlocker(
        { TERM: "dumb" },
        { stdin: { isTTY: true }, stdout: { isTTY: true } }
      )
    ).toContain("TERM=dumb");
    expect(
      getInteractiveRuntimeLaunchBlocker(
        { TERM: "xterm-256color" },
        { stdin: { isTTY: false }, stdout: { isTTY: true } }
      )
    ).toContain("interactive terminal");
    expect(
      getInteractiveRuntimeLaunchBlocker(
        { TERM: "xterm-256color", CODEX_SESSION_ID: "session-1" },
        { stdin: { isTTY: true }, stdout: { isTTY: true } }
      )
    ).toContain("CODEX_SESSION_ID");
  });

  it("allows explicit legacy launch override", () => {
    expect(
      getInteractiveRuntimeLaunchBlocker(
        { TERM: "dumb", PRS_ALLOW_INTERACTIVE_RUNTIME_LAUNCH: "1" },
        { stdin: { isTTY: false }, stdout: { isTTY: false } }
      )
    ).toBeUndefined();
  });
});

describe("getUnattendedRuntimeLaunchBlocker", () => {
  it("blocks nested unattended Codex launches inside an active Codex session", () => {
    expect(
      getUnattendedRuntimeLaunchBlocker({
        TERM: "xterm-256color",
        CODEX_SESSION_ID: "session-1",
      })
    ).toBe(
      "Legacy unattended runtime launch is disabled inside an active Codex session (CODEX_SESSION_ID is set). Use `prs tool issue ready <number> --unattended --json` from the active Codex session instead."
    );
  });

  it("allows unattended Codex launch in tests even when the harness has Codex markers", () => {
    expect(
      getUnattendedRuntimeLaunchBlocker({
        VITEST: "true",
        CODEX_SANDBOX: "workspace-write",
      })
    ).toBeUndefined();
  });
});

describe("isCodexSuperpowersAvailable", () => {
  it("returns true when the cached Superpowers plugin exposes the required skills", () => {
    const codexHome = createCodexHome("prs-runtime-codex-home-");
    writeSuperpowersPlugin(codexHome);

    expect(isCodexSuperpowersAvailable(codexHome)).toBe(true);
  });

  it("returns false when the Superpowers plugin is missing or incomplete", () => {
    const codexHome = createCodexHome("prs-runtime-codex-home-");
    mkdirSync(
      resolve(codexHome, "plugins", "cache", "openai-curated", "superpowers", "partial"),
      {
        recursive: true,
      }
    );
    writeFileSync(
      resolve(
        codexHome,
        "plugins",
        "cache",
        "openai-curated",
        "superpowers",
        "partial",
        "README.md"
      ),
      "# partial\n"
    );

    expect(isCodexSuperpowersAvailable(codexHome)).toBe(false);
  });
});
