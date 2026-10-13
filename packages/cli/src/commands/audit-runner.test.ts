import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({root: "", target: "issue", content: ""}));
vi.mock("../cli-context", () => ({
  getDefaultRepoRoot: () => state.root,
  getCliArgs: () => ["audit", "publish", state.target === "issue" ? "--issue" : "--pr", "373", "--file", "report.md", "--section", "completion"],
  getIssueTracker: () => {
    if (state.target !== "issue") throw new Error("PR audits must not access a tracker");
    return {type: "github", isAuthenticated: () => true, fetchAuditComment: async () => undefined,
      createAuditComment: async (_target: unknown, body: string) => {state.content = body; return {url: "https://example.test/comment"};},
      updateIssueComment: async () => {throw new Error("No existing comment");}};
  },
  getRepositoryForge: () => {
    if (state.target !== "pull-request") throw new Error("Issue audits must not access a forge");
    return {type: "github", isAuthenticated: () => true, fetchAuditComment: async () => undefined,
      createAuditComment: async (_target: unknown, body: string) => {state.content = body; return {url: "https://example.test/comment"};},
      updateComment: async () => {throw new Error("No existing comment");}};
  },
}));
import { runAuditCommand } from "./audit-runner";
afterEach(() => vi.restoreAllMocks());
it.each(["issue", "pull-request"])("publishes %s audit without constructing the unrelated integration", async target => {
  state.root = mkdtempSync(join(tmpdir(), "prs-audit-routing-")); state.target = target;
  mkdirSync(join(state.root, ".prs"));
  writeFileSync(join(state.root, "report.md"), "# Completion\n\nVerified.");
  vi.spyOn(console, "log").mockImplementation(() => {});
  await runAuditCommand();
  expect(state.content).toContain("Verified.");
  expect(state.content).toContain("<!-- prs:audit:completion:start -->");
});
