import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitHubAuthFailure } from "../github-auth-failure";
import { makeUsageFixture } from "../token-usage.test-support";
const forge = vi.hoisted(() => ({ type: "github", isAuthenticated: vi.fn(), createOrReuseIssue: vi.fn() }));
const state = vi.hoisted(() => ({ args: ["tool", "issue", "create", "--draft-file", "draft.md", "--json"], root: "/repo", localOnly: false }));
vi.mock("../cli-context", () => ({
  getCliArgs: () => state.args,
  getDefaultRepoRoot: () => state.root,
  getRepositoryConfig: () => { if (state.localOnly) throw new Error("Local render must not require forge config"); return {}; },
  getRepositoryForge: () => { if (state.localOnly) throw new Error("Local render must not request a forge"); return forge; },
  loadRepoEnv: () => undefined,
}));
import { runToolCommand } from "./tool-runner";
afterEach(() => vi.restoreAllMocks());

it("returns safe login recovery when authentication discovery throws an unknown error", async () => {
  forge.isAuthenticated.mockImplementation(() => { throw new Error("do-not-expose-auth-diagnostic"); });
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });
  await runToolCommand();
  expect(JSON.parse(output.join(""))).toEqual({
    status: "blocked",
    reason: "github-auth-required",
    message: "GitHub issue creation requires an installed and authenticated GitHub CLI (gh).",
    nextAction: "configure-github-auth",
  });
  expect(output.join("")).not.toContain("do-not-expose-auth-diagnostic");
  expect(forge.createOrReuseIssue).not.toHaveBeenCalled();
});

it("returns credential-store recovery when authentication discovery cannot access a saved credential", async () => {
  forge.isAuthenticated.mockImplementation(() => {
    throw new GitHubAuthFailure(
      "Saved credential is inaccessible.",
      "github-credential-store-inaccessible",
      "retry-with-credential-store-access"
    );
  });
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });

  await runToolCommand();

  expect(JSON.parse(output.join(""))).toEqual({
    status: "blocked",
    reason: "github-credential-store-inaccessible",
    message: "Saved credential is inaccessible.",
    nextAction: "retry-with-credential-store-access",
  });
  expect(forge.createOrReuseIssue).not.toHaveBeenCalled();
});

it("renders local evidence without loading repository forge configuration or authentication", async () => {
  const root = mkdtempSync(join(tmpdir(), "prs-usage-runner-"));
  const run = join(root, ".prs/runs/run-42"); mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "input.json"), JSON.stringify(makeUsageFixture("priced-cache")));
  state.root = root; state.localOnly = true;
  state.args = ["tool", "token-usage", "render", "--file", ".prs/runs/run-42/input.json", "--output", ".prs/runs/run-42/output.md", "--json"];
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });
  try {
    await runToolCommand();
    expect(JSON.parse(output.join(""))).toMatchObject({ status: "rendered", totals: { modelTokens: { totalTokens: 1150 } } });
  } finally {
    state.root = "/repo"; state.localOnly = false;
    state.args = ["tool", "issue", "create", "--draft-file", "draft.md", "--json"];
    rmSync(root, { recursive: true, force: true });
  }
});

it("captures locally without loading forge configuration or authentication", async () => {
  const root = mkdtempSync(join(tmpdir(), "prs-capture-runner-"));
  mkdirSync(join(root, ".prs/runs/capture"), { recursive: true });
  state.root = root; state.localOnly = true;
  state.args = ["tool", "token-usage", "capture", "--host", "copilot", "--session", "test", "--source", join(root, "not-created.jsonl"), "--output", ".prs/runs/capture/usage-evidence.json", "--json"];
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });
  try {
    await runToolCommand();
    expect(JSON.parse(output.join(""))).toMatchObject({ status: "unavailable", capture: { sessionId: "test" } });
  } finally {
    state.root = "/repo"; state.localOnly = false;
    state.args = ["tool", "issue", "create", "--draft-file", "draft.md", "--json"];
    rmSync(root, { recursive: true, force: true });
  }
});
