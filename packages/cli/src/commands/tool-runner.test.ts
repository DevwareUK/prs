import { afterEach, expect, it, vi } from "vitest";
const forge = vi.hoisted(() => ({ type: "github", isAuthenticated: vi.fn(), createOrReuseIssue: vi.fn() }));
vi.mock("../cli-context", () => ({
  getCliArgs: () => ["tool", "issue", "create", "--draft-file", "draft.md", "--json"],
  getDefaultRepoRoot: () => "/repo",
  getRepositoryConfig: () => ({}),
  getRepositoryForge: () => forge,
  loadRepoEnv: () => undefined,
}));
import { runToolCommand } from "./tool-runner";
afterEach(() => vi.restoreAllMocks());

it("returns blocked JSON with account guidance when authentication discovery throws", async () => {
  forge.isAuthenticated.mockImplementation(() => { throw new Error('GitHub account "work" is unavailable. Run gh auth login --hostname github.com for that account.'); });
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });
  await runToolCommand();
  expect(JSON.parse(output.join(""))).toMatchObject({ status: "blocked", nextAction: "configure-github-auth", message: expect.stringContaining('account "work"') });
  expect(forge.createOrReuseIssue).not.toHaveBeenCalled();
});
