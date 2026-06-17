import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadCodexSessionModelMetadata } from "./codex-session-metadata";
import { createTempRepoRoot } from "./index-test-support";

describe("Codex session metadata", () => {
  it("loads the current Codex thread model from local state", () => {
    const codexHome = createTempRepoRoot();
    const stateDbPath = resolve(codexHome, "state_5.sqlite");
    writeFileSync(stateDbPath, "", "utf8");
    const execFileSyncImpl = vi.fn(() => "gpt-5.5\thigh\n");

    expect(
      loadCodexSessionModelMetadata({
        codexHome,
        env: {
          CODEX_THREAD_ID: "019ed540-2666-74f0-b987-515d935ec1e3",
        },
        execFileSyncImpl: execFileSyncImpl as never,
      })
    ).toEqual({
      threadId: "019ed540-2666-74f0-b987-515d935ec1e3",
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(execFileSyncImpl).toHaveBeenCalledWith(
      "sqlite3",
      [
        "-separator",
        "\t",
        stateDbPath,
        "select coalesce(model, ''), coalesce(reasoning_effort, '') from threads where id = '019ed540-2666-74f0-b987-515d935ec1e3' limit 1;",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  });

  it("returns undefined when the current thread state is unavailable", () => {
    const codexHome = createTempRepoRoot();
    mkdirSync(resolve(codexHome, "nested"), { recursive: true });

    expect(
      loadCodexSessionModelMetadata({
        codexHome,
        env: {
          CODEX_THREAD_ID: "019ed540-2666-74f0-b987-515d935ec1e3",
        },
        execFileSyncImpl: vi.fn(() => "gpt-5.5\thigh\n") as never,
      })
    ).toBeUndefined();
  });
});
