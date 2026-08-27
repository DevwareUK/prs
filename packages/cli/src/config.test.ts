import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadRepositoryConfig, loadResolvedRepositoryConfig } from "./config";

describe("repository config loading", () => {
  it("loads deterministic configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "prs-config-"));
    mkdirSync(join(root, ".prs"));
    writeFileSync(join(root, ".prs/config.json"), JSON.stringify({
      baseBranch: "develop", buildCommand: ["make", "test"], forge: { type: "none" },
    }));
    expect(loadRepositoryConfig(root)).toMatchObject({ baseBranch: "develop", forge: { type: "none" } });
    expect(loadResolvedRepositoryConfig(root)).toMatchObject({ baseBranch: "develop", buildCommand: ["make", "test"] });
  });

  it("migrates retired keys safely and reports the change", () => {
    const root = mkdtempSync(join(tmpdir(), "prs-config-migrate-"));
    mkdirSync(join(root, ".prs"));
    writeFileSync(join(root, ".prs/config.json"), JSON.stringify({ ai: {}, githubActions: {} }));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(loadRepositoryConfig(root)).not.toHaveProperty("ai");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("configuration migration"));
    error.mockRestore();
  });
});
