import { describe, expect, it } from "vitest";
import { resolveGitHubCli } from "./github-auth";

describe("GitHub CLI discovery", () => {
  it("finds gh outside PATH", () => {
    expect(resolveGitHubCli({ env: { PATH: "/usr/bin:/bin" }, spawnSync: command => ({ status: command === "/opt/homebrew/bin/gh" ? 0 : 1 }) })).toMatchObject({ path: "/opt/homebrew/bin/gh", source: "common-path" });
  });
  it.each(["PRS_GH_PATH", "PRS_GITHUB_CLI_PATH"])("prefers %s over config and PATH", key => {
    expect(resolveGitHubCli({ env: { [key]: "/env/gh" }, configuredPath: "/config/gh", spawnSync: () => ({ status: 0 }) })).toMatchObject({ path: "/env/gh", source: "env" });
  });
  it("prefers the configured executable over PATH", () => {
    expect(resolveGitHubCli({ env: {}, configuredPath: "/config/gh", spawnSync: () => ({ status: 0 }) })).toMatchObject({ path: "/config/gh", source: "config" });
  });
  it("reports attempted locations without exposing process errors", () => {
    const result = resolveGitHubCli({ env: {}, spawnSync: () => ({ status: 1 }) });
    expect(result.path).toBeUndefined();
    expect(result.diagnostics.ghCandidates.map(candidate => candidate.path)).toContain("/opt/homebrew/bin/gh");
  });
});
