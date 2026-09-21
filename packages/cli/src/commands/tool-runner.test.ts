import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { GitHubAuthFailure } from "../github-auth-failure";
import { makeUsageFixture } from "../token-usage.test-support";
const forge = vi.hoisted(() => ({
  type: "github",
  isAuthenticated: vi.fn(),
  createOrReuseIssue: vi.fn(),
  fetchIssueDetails: vi.fn(),
  updateIssue: vi.fn(),
  fetchIssueComments: vi.fn(),
  fetchIssuePlanComment: vi.fn(),
  createIssuePlanComment: vi.fn(),
  updateIssueComment: vi.fn(),
  updateIssuePlanComment: vi.fn(),
  fetchIssueIdentity: vi.fn(),
  fetchIssueParent: vi.fn(),
  fetchIssueChildren: vi.fn(),
  addIssueChild: vi.fn(),
}));
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

it("records a bounded Copilot hook payload without loading forge configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "prs-copilot-hook-runner-")), home = join(root, "home"), repo = join(root, "repo");
  mkdirSync(home); mkdirSync(repo); execFileSync("git", ["init", "-q", repo]);
  state.root = repo; state.localOnly = true;
  state.args = ["tool", "token-usage", "bind-copilot-session", "--json"];
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });
  const payload = { sessionId: "runner-session", timestamp: Date.parse("2026-09-17T12:23:49Z"), cwd: repo, toolName: "bash", toolArgs: { command: "prs tool token-usage capture --host copilot --output .prs/runs/run/usage-evidence.json --json" } };
  try {
    await runToolCommand({ stdin: Readable.from([JSON.stringify(payload)]), copilotBridge: { home, now: () => "2026-09-17T12:23:49Z" } });
    expect(JSON.parse(output.join(""))).toEqual({ status: "recorded" });
    await expect(runToolCommand({ stdin: Readable.from(["x".repeat(1024 * 1024 + 1)]), copilotBridge: { home } })).rejects.toThrow(/1 MiB/);
  } finally {
    state.root = "/repo"; state.localOnly = false;
    state.args = ["tool", "issue", "create", "--draft-file", "draft.md", "--json"];
    rmSync(root, { recursive: true, force: true });
  }
});

it("reconciles linked issue identities, comments, and native hierarchy after a partial run", async () => {
  const root = mkdtempSync(join(tmpdir(), "prs-linked-runner-"));
  const runDir = join(root, ".prs/runs/linked");
  mkdirSync(runDir, { recursive: true });
  for (const id of ["parent", "first", "second"]) {
    writeFileSync(join(runDir, `${id}.md`), `# ${id}\n\n${id} body\n`);
    writeFileSync(join(runDir, `${id}-spec.md`), `# ${id} spec\n`);
    writeFileSync(join(runDir, `${id}-plan.md`), `# ${id} plan\n`);
  }
  writeFileSync(join(runDir, "set.json"), JSON.stringify({
    version: 2,
    mode: "multiple",
    orchestration: { mode: "parent", orchestratorId: "parent" },
    issues: [
      { id: "parent", draftFile: ".prs/runs/linked/parent.md", specFile: ".prs/runs/linked/parent-spec.md", planFile: ".prs/runs/linked/parent-plan.md" },
      { id: "first", parentId: "parent", draftFile: ".prs/runs/linked/first.md", specFile: ".prs/runs/linked/first-spec.md", planFile: ".prs/runs/linked/first-plan.md" },
      { id: "second", parentId: "parent", draftFile: ".prs/runs/linked/second.md", specFile: ".prs/runs/linked/second-spec.md", planFile: ".prs/runs/linked/second-plan.md" },
    ],
  }));

  const issueByNumber = new Map<number, { title: string; body: string; url: string }>();
  const comments = new Map<number, { spec?: { id: number; body: string; url: string; updatedAt: string }; plan?: { id: number; body: string; url: string; updatedAt: string } }>();
  const parentByChild = new Map<number, number>();
  let nextIssueNumber = 40;
  let nextCommentId = 100;
  let secondLinkAttempts = 0;

  forge.isAuthenticated.mockReturnValue(true);
  forge.createOrReuseIssue.mockImplementation(async (title: string, body: string) => {
    const number = ++nextIssueNumber;
    const url = `https://example.test/issues/${number}`;
    issueByNumber.set(number, { title, body, url });
    return { number, title, url, status: "created" as const };
  });
  forge.fetchIssueDetails.mockImplementation(async (number: number) => issueByNumber.get(number));
  forge.updateIssue.mockImplementation(async (number: number, title: string, body: string) => {
    const url = `https://example.test/issues/${number}`;
    issueByNumber.set(number, { title, body, url });
    return { number, title, url, status: "existing" as const };
  });
  forge.fetchIssueComments.mockImplementation(async (number: number) => {
    const spec = comments.get(number)?.spec;
    return spec ? [{ ...spec, createdAt: spec.updatedAt, author: "owner", isBot: false }] : [];
  });
  forge.fetchIssuePlanComment.mockImplementation(async (number: number) => comments.get(number)?.plan);
  forge.createIssuePlanComment.mockImplementation(async (number: number, body: string) => {
    const id = ++nextCommentId;
    const comment = { id, body, url: `https://example.test/comments/${id}`, updatedAt: "2026-09-15T00:00:00Z" };
    const issueComments = comments.get(number) ?? {};
    if (body.startsWith("<!-- prs:issue-spec -->")) issueComments.spec = comment;
    else issueComments.plan = comment;
    comments.set(number, issueComments);
    return comment;
  });
  forge.updateIssueComment.mockImplementation(async (id: number, body: string) => ({ id, body, url: `https://example.test/comments/${id}`, createdAt: "2026-09-15T00:00:00Z", updatedAt: "2026-09-15T00:00:00Z", author: "owner", isBot: false }));
  forge.updateIssuePlanComment.mockImplementation(async (id: number, body: string) => ({ id, body, url: `https://example.test/comments/${id}`, updatedAt: "2026-09-15T00:00:00Z" }));
  forge.fetchIssueIdentity.mockImplementation(async (number: number) => ({ id: number + 1000, number, url: `https://example.test/issues/${number}` }));
  forge.fetchIssueParent.mockImplementation(async (number: number) => {
    const parentNumber = parentByChild.get(number);
    return parentNumber ? { id: parentNumber + 1000, number: parentNumber, url: `https://example.test/issues/${parentNumber}` } : null;
  });
  forge.fetchIssueChildren.mockImplementation(async (number: number) => [...parentByChild.entries()]
    .filter(([, parentNumber]) => parentNumber === number)
    .map(([childNumber]) => ({ id: childNumber + 1000, number: childNumber, url: `https://example.test/issues/${childNumber}` })));
  forge.addIssueChild.mockImplementation(async (parentNumber: number, childId: number) => {
    const childNumber = childId - 1000;
    if (childNumber === 43 && secondLinkAttempts++ === 0) throw new Error("temporary hierarchy failure");
    parentByChild.set(childNumber, parentNumber);
  });

  state.root = root;
  state.args = ["tool", "issue", "create", "--issue-set", ".prs/runs/linked/set.json", "--run-dir", ".prs/runs/linked", "--json"];
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });
  try {
    await runToolCommand();
    expect(JSON.parse(output.at(-1) ?? "{}")).toMatchObject({ status: "partial" });

    process.exitCode = undefined;
    await runToolCommand();
    const retried = JSON.parse(output.at(-1) ?? "{}");
    expect(retried).toMatchObject({ status: "ok" });
    expect(forge.createOrReuseIssue).toHaveBeenCalledTimes(3);
    expect(new Set([...comments.values()].flatMap(value => [value.spec?.id, value.plan?.id]).filter(Boolean)).size).toBe(6);
    expect(new Set(parentByChild.keys())).toEqual(new Set([42, 43]));
    expect(retried.hierarchy.relationships).toEqual([
      expect.objectContaining({ childNumber: 42, status: "verified" }),
      expect.objectContaining({ childNumber: 43, status: "verified" }),
    ]);
  } finally {
    process.exitCode = undefined;
    state.root = "/repo";
    state.args = ["tool", "issue", "create", "--draft-file", "draft.md", "--json"];
    rmSync(root, { recursive: true, force: true });
  }
});
