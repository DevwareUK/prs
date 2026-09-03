import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));
import { createGitHubRepositoryForge, listIssueLinkedPullRequestsForRepoRoot } from "./github";

const execMock = vi.mocked(execFileSync);
const spawnMock = vi.mocked(spawnSync);
const http = (body: unknown) => `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`;
let root: string;
let requests: Array<{ endpoint: string; body?: unknown }>;
let respond: (endpoint: string, body?: unknown) => unknown;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prs-github-integration-"));
  mkdirSync(join(root, ".prs"));
  writeFileSync(join(root, ".prs/config.local.json"), JSON.stringify({ forge: { githubAccount: "work" } }));
  requests = [];
  vi.stubGlobal("fetch", () => { throw new Error("Direct HTTP must not be used"); });
  spawnMock.mockImplementation(() => ({ status: 0, stdout: "", stderr: "" }) as ReturnType<typeof spawnSync>);
  execMock.mockImplementation((command, args, options) => {
    if (command === "git") return "git@github.com:DevwareUK/prs.git\n";
    if (args?.[0] === "auth" && args[1] === "token") return "work-credential";
    if (args?.[0] === "api") {
      const opts = options as { env: Record<string, string>; input?: string };
      expect(opts.env.GH_TOKEN).toBe("work-credential");
      const body: unknown = opts.input ? JSON.parse(opts.input) : undefined;
      requests.push({ endpoint: String(args[1]), body });
      return http(respond(String(args[1]), body));
    }
    if (args?.[0] === "pr" && args[1] === "create") {
      expect(args[args.indexOf("--repo") + 1]).toBe("DevwareUK/prs");
      expect((options as { env: Record<string, string> }).env.GH_TOKEN).toBe("work-credential");
      return "https://github.com/DevwareUK/prs/pull/501\n";
    }
    throw new Error("Unexpected GitHub operation");
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("GitHub operations through the selected CLI account", () => {
  it("paginates timeline cross-references and preserves open/merged state", async () => {
    const event = (number: number, merged: boolean) => ({ event: "cross-referenced", source: { issue: {
      number, title: `PR ${number}`, html_url: `https://github.com/DevwareUK/prs/pull/${number}`,
      state: merged ? "closed" : "open", pull_request: { merged_at: merged ? "2026-08-27T12:00:00Z" : null },
    } } });
    respond = endpoint => endpoint.endsWith("&page=2") ? [event(402, true)] : Array.from({ length: 100 }, () => event(401, false));
    expect(await listIssueLinkedPullRequestsForRepoRoot(root, 324)).toEqual([
      { number: 401, title: "PR 401", url: "https://github.com/DevwareUK/prs/pull/401", state: "open" },
      { number: 402, title: "PR 402", url: "https://github.com/DevwareUK/prs/pull/402", state: "merged" },
    ]);
    expect(requests.map(request => request.endpoint)).toEqual([
      "repos/DevwareUK/prs/issues/324/timeline?per_page=100", "repos/DevwareUK/prs/issues/324/timeline?per_page=100&page=2",
    ]);
  });

  it("creates an issue with exact multiline content and reuses it without a second write", async () => {
    respond = (_endpoint, body) => body ? { number: 88, title: "Example", html_url: "https://github.com/DevwareUK/prs/issues/88" } : [];
    const forge = createGitHubRepositoryForge(root);
    const body = "First line\n\nLiteral `code` and $(text)";
    expect(await forge.createOrReuseIssue("Example", body, ["bug"])).toMatchObject({ number: 88, status: "created" });
    expect(await forge.createOrReuseIssue("Example", body, ["bug"])).toMatchObject({ number: 88, status: "existing" });
    expect(requests.filter(request => request.body)).toEqual([{ endpoint: "repos/DevwareUK/prs/issues", body: { title: "Example", body, labels: ["bug"] } }]);
  });

  it("sends GraphQL variables and preserves GraphQL error messages", async () => {
    respond = () => ({ errors: [{ message: "Thread does not exist" }] });
    const forge = createGitHubRepositoryForge(root);
    await expect(forge.replyToPullRequestReviewThread("thread-1", "line 1\nline 2")).rejects.toThrow("Thread does not exist");
    expect(requests[0]).toMatchObject({ endpoint: "graphql", body: { variables: { threadId: "thread-1", body: "line 1\nline 2" } } });
  });

  it("uses the same identity for PR creation and keeps credentials out of its log", async () => {
    const log = join(root, "pr.log");
    const result = await createGitHubRepositoryForge(root).createPullRequest({ branchName: "feature", title: "Example", body: "Body", baseBranch: "main", outputLogPath: log });
    expect(result.url).toBe("https://github.com/DevwareUK/prs/pull/501");
    expect(readFileSync(log, "utf8")).not.toContain("work-credential");
  });
});

it("accepts installation credentials for repo access without requiring a user profile", () => {
  writeFileSync(join(root, ".prs/config.local.json"), "{}");
  vi.stubEnv("GITHUB_TOKEN", "installation-credential");
  execMock.mockImplementation((command, args, options) => {
    if (command === "git") return "git@github.com:DevwareUK/prs.git\n";
    expect((options as { env: Record<string, string> }).env.GITHUB_TOKEN).toBe("installation-credential");
    if (args?.[0] === "api" && args[1] === "repos/DevwareUK/prs") return "123";
    throw new Error("Installation token has no user profile");
  });
  try { expect(createGitHubRepositoryForge(root).isAuthenticated()).toBe(true); } finally { vi.unstubAllEnvs(); }
});
