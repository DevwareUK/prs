import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
vi.mock("node:child_process", () => ({execFileSync: vi.fn(), spawnSync: vi.fn()}));
import { createIssueTracker } from "./issue-tracker";
import { createRepositoryForge } from "./forge";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prs-independent-github-"));
  mkdirSync(join(root, ".prs"));
  writeFileSync(join(root, ".prs/config.local.json"), JSON.stringify({forge: {githubAccount: "work"}}));
  vi.mocked(spawnSync).mockReturnValue({status: 0} as ReturnType<typeof spawnSync>);
  vi.mocked(execFileSync).mockImplementation((command, args, options) => {
    if (command === "git") return "git@github.com:DevwareUK/prs.git";
    if (args?.[0] === "auth") return "work-credential";
    expect((options as {env: Record<string, string>}).env.GH_TOKEN).toBe("work-credential");
    const endpoint = String(args?.[1]);
    const payload = endpoint.includes("/pulls/") ? {
      number: 400, title: "PR", body: "", html_url: "https://github.com/DevwareUK/prs/pull/400",
      base: {ref: "main"}, head: {ref: "feature", sha: "abc"},
    } : {number: 373, id: 500, title: "Split", body: "Approved", html_url: "https://github.com/DevwareUK/prs/issues/373"};
    return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(payload)}`;
  });
});
afterEach(() => vi.resetAllMocks());

it.each(["github", "none"] as const)("tracker issue reads and qualified references do not depend on forge=%s", async forgeType => {
  const tracker = createIssueTracker(root, resolveRepositoryConfig({forge: {type: forgeType}, issueTracker: {type: "github"}}));
  expect(await tracker.fetchIssueDetails(373)).toEqual({title: "Split", body: "Approved", url: "https://github.com/DevwareUK/prs/issues/373"});
  expect(tracker.getIssueReference(373)).toEqual({provider: "github", scope: "DevwareUK/prs", key: "373", url: "https://github.com/DevwareUK/prs/issues/373"});
  expect(() => tracker.getIssueReference(0)).toThrow("positive");
});

it.each(["github", "none"] as const)("forge PR reads do not depend on tracker=%s", async trackerType => {
  const forge = createRepositoryForge(root, resolveRepositoryConfig({forge: {type: "github"}, issueTracker: {type: trackerType}}));
  expect(await forge.fetchPullRequestDetails(400)).toMatchObject({number: 400, title: "PR", baseRefName: "main", headRefName: "feature"});
});

it("rejects an audit target belonging to the other integration before authentication or network calls", async () => {
  const tracker = createIssueTracker(root, resolveRepositoryConfig());
  const forge = createRepositoryForge(root, resolveRepositoryConfig());
  await expect(tracker.fetchAuditComment({type: "pull-request", number: 400})).rejects.toThrow("other integration");
  await expect(forge.createAuditComment({type: "issue", number: 373}, "Body")).rejects.toThrow("other integration");
  expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
});

it("honors the resolved factory configuration for listing instead of reloading disk defaults", async () => {
  const tracker = createIssueTracker(root, resolveRepositoryConfig({forge: {type: "none"}, issueTracker: {type: "github"}}));
  expect(await tracker.listIssues({actionable: true})).toMatchObject({status: "blocked", reason: "issue-pr-links-unavailable"});
  expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
});

it("filters actionable issues using real same-repository link evidence without cross-repository number collisions", async () => {
  const linked = (scope: string, state: "open" | "closed") => ({event: "cross-referenced", source: {issue: {
    number: 42, title: "Implementation", html_url: `https://github.com/${scope}/pull/42`, state, pull_request: {merged_at: null},
  }}});
  vi.mocked(execFileSync).mockImplementation((command, args) => {
    if (command === "git") return "git@github.com:DevwareUK/prs.git";
    if (args?.[0] === "auth") return "work-credential";
    const endpoint = String(args?.[1]);
    const payload = endpoint === "user" ? {login: "work"}
      : endpoint.includes("/issues?") ? [1, 2, 3].map(number => ({number, title: `Issue ${number}`, html_url: `https://github.com/DevwareUK/prs/issues/${number}`, user: {login: "work"}, updated_at: "2026-10-13T00:00:00Z"}))
      : endpoint.includes("/issues/2/timeline?") ? [linked("DevwareUK/prs", "open"), linked("Other/repo", "closed")]
      : endpoint.includes("/issues/3/timeline?") ? [linked("Other/repo", "open")]
      : [];
    return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(payload)}`;
  });
  const tracker = createIssueTracker(root, resolveRepositoryConfig());
  const result = await tracker.listIssues({actionable: true});
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.issues.map(issue => issue.number).sort()).toEqual([1, 3]);
    expect(result.issues.every(issue => !issue.hasLinkedOpenPullRequest)).toBe(true);
  }
});

it("owns issue-start updates even when the PR forge is disabled", async () => {
  vi.mocked(execFileSync).mockImplementation((command, args, options) => {
    if (command === "git") return "git@github.com:DevwareUK/prs.git";
    if (args?.[0] === "auth") return "work-credential";
    expect((options as {env: Record<string, string>}).env.GH_TOKEN).toBe("work-credential");
    const endpoint = String(args?.[1]);
    const payload = endpoint === "user" ? {login: "work"}
      : endpoint === "orgs/DevwareUK/issue-fields" ? []
      : {assignees: [{login: "work"}]};
    return `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(payload)}`;
  });
  const tracker = createIssueTracker(root, resolveRepositoryConfig({forge: {type: "none"}, issueTracker: {type: "github"}}));
  expect(await tracker.startIssueWork(373)).toEqual({assignee: {status: "already-set", value: "work"}, issueStatus: {status: "unavailable", reason: "Status issue field is not configured"}});
});

it("disabled tracker cannot start issue work", async () => {
  const tracker = createIssueTracker(root, resolveRepositoryConfig({issueTracker: {type: "none"}}));
  await expect(tracker.startIssueWork(373)).rejects.toThrow("issueTracker.type");
  expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
});
