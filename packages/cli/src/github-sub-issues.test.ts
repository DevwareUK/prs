import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));
import { createGitHubRepositoryForge } from "./github";
import type { RepositoryForge } from "./forge";
import { ensureIssueHierarchy } from "./workflows/issue/hierarchy";

const execMock = vi.mocked(execFileSync);
const spawnMock = vi.mocked(spawnSync);
const http = (body: unknown, status = 200, text = "OK") =>
  `HTTP/2.0 ${status} ${text}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`;
let root: string;
let requests: Array<{ endpoint: string; method: string; body?: unknown }>;
let respond: (endpoint: string, method: string, body?: unknown) => string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prs-github-sub-issues-"));
  mkdirSync(join(root, ".prs"));
  writeFileSync(join(root, ".prs/config.local.json"), JSON.stringify({ forge: { githubAccount: "work" } }));
  requests = [];
  spawnMock.mockImplementation(() => ({ status: 0, stdout: "", stderr: "" }) as ReturnType<typeof spawnSync>);
  execMock.mockImplementation((command, args, options) => {
    if (command === "git") return "git@github.com:DevwareUK/prs.git\n";
    if (args?.[0] === "auth") return "work-credential";
    if (args?.[0] === "api") {
      const method = String(args[args.indexOf("--method") + 1]);
      const input = (options as { input?: string }).input;
      const body = input ? JSON.parse(input) : undefined;
      const endpoint = String(args[1]);
      requests.push({ endpoint, method, body });
      return respond(endpoint, method, body);
    }
    throw new Error("Unexpected operation");
  });
});

afterEach(() => vi.resetAllMocks());

describe("GitHub native sub-issues", () => {
  it("uses a child's database id when attaching it to a parent", async () => {
    respond = (endpoint, method) => {
      if (endpoint.endsWith("/issues/42") && method === "GET") {
        return http({ id: 9001, number: 42, html_url: "https://github.com/DevwareUK/prs/issues/42" });
      }
      return http({}, 201, "Created");
    };
    const forge = createGitHubRepositoryForge(root);

    const child = await forge.fetchIssueIdentity(42);
    await forge.addIssueChild(7, child.id);

    expect(requests).toContainEqual({
      endpoint: "repos/DevwareUK/prs/issues/7/sub_issues",
      method: "POST",
      body: { sub_issue_id: 9001 },
    });
  });

  it("reads a missing parent distinctly from an API failure", async () => {
    respond = endpoint => endpoint.endsWith("/parent")
      ? http({ message: "Not Found" }, 404, "Not Found")
      : http({ id: 1042, number: 42, html_url: "https://github.com/DevwareUK/prs/issues/42" });
    await expect(createGitHubRepositoryForge(root).fetchIssueParent(42)).resolves.toBeNull();
  });

  it("paginates children and returns real issue identities", async () => {
    const issue = (number: number) => ({ id: number + 1000, number, html_url: `https://github.com/DevwareUK/prs/issues/${number}` });
    respond = endpoint => endpoint.endsWith("page=2")
      ? http([issue(142)])
      : http(Array.from({ length: 100 }, (_, index) => issue(index + 1)));

    const children = await createGitHubRepositoryForge(root).fetchIssueChildren(7);

    expect(children).toHaveLength(101);
    expect(children.at(-1)).toEqual({ id: 1142, number: 142, url: "https://github.com/DevwareUK/prs/issues/142" });
    expect(requests.map(request => request.endpoint)).toEqual([
      "repos/DevwareUK/prs/issues/7/sub_issues?per_page=100",
      "repos/DevwareUK/prs/issues/7/sub_issues?per_page=100&page=2",
    ]);
  });

  it("does not mutate explicitly flat sets", async () => {
    const addIssueChild = vi.fn();
    const result = await ensureIssueHierarchy({
      forge: { addIssueChild } as unknown as RepositoryForge,
      issueSet: { mode: "multiple", orchestration: { mode: "flat", reason: "Independent" }, issues: [] },
      issues: [],
    });
    expect(result).toEqual({ mode: "flat", reason: "Independent", relationships: [] });
    expect(addIssueChild).not.toHaveBeenCalled();
  });

  it("reports a foreign parent conflict without reparenting", async () => {
    const addIssueChild = vi.fn();
    const forge = {
      fetchIssueIdentity: vi.fn(async (number: number) => ({ id: number + 1000, number, url: `https://example.test/issues/${number}` })),
      fetchIssueParent: vi.fn(async () => ({ id: 1099, number: 99, url: "https://example.test/issues/99" })),
      fetchIssueChildren: vi.fn(async () => []),
      addIssueChild,
    } as unknown as RepositoryForge;
    const result = await ensureIssueHierarchy({
      forge,
      issueSet: {
        mode: "multiple",
        orchestration: { mode: "parent", orchestratorId: "parent" },
        issues: [
          { id: "parent", draftFilePath: "", specFilePath: "", planFilePath: "", title: "Parent", body: "", specMarkdown: "", planMarkdown: "", dependsOn: [], blocks: [], related: [] },
          { id: "child", parentId: "parent", draftFilePath: "", specFilePath: "", planFilePath: "", title: "Child", body: "", specMarkdown: "", planMarkdown: "", dependsOn: [], blocks: [], related: [] },
        ],
      },
      issues: [
        { id: "parent", number: 7, title: "Parent", url: "https://example.test/issues/7", status: "existing" },
        { id: "child", number: 42, title: "Child", url: "https://example.test/issues/42", status: "created" },
      ],
    });
    expect(result.relationships[0]).toMatchObject({ status: "conflict", parentNumber: 7, childNumber: 42 });
    expect(result.relationships[0]?.message).toMatch(/#99/);
    expect(addIssueChild).not.toHaveBeenCalled();
  });

  it("reconciles an uncertain add response by reading both directions", async () => {
    let added = false;
    const forge = {
      fetchIssueIdentity: vi.fn(async (number: number) => ({ id: number + 1000, number, url: `https://example.test/issues/${number}` })),
      fetchIssueParent: vi.fn(async (number: number) => added && number === 42 ? ({ id: 1007, number: 7, url: "https://example.test/issues/7" }) : null),
      fetchIssueChildren: vi.fn(async () => added ? [{ id: 1042, number: 42, url: "https://example.test/issues/42" }] : []),
      addIssueChild: vi.fn(async () => { added = true; throw new Error("connection lost"); }),
    } as unknown as RepositoryForge;
    const result = await ensureIssueHierarchy({
      forge,
      issueSet: {
        mode: "multiple",
        orchestration: { mode: "parent", orchestratorId: "parent" },
        issues: [
          { id: "parent", draftFilePath: "", specFilePath: "", planFilePath: "", title: "Parent", body: "", specMarkdown: "", planMarkdown: "", dependsOn: [], blocks: [], related: [] },
          { id: "child", parentId: "parent", draftFilePath: "", specFilePath: "", planFilePath: "", title: "Child", body: "", specMarkdown: "", planMarkdown: "", dependsOn: [], blocks: [], related: [] },
        ],
      },
      issues: [
        { id: "parent", number: 7, title: "Parent", url: "https://example.test/issues/7", status: "created" },
        { id: "child", number: 42, title: "Child", url: "https://example.test/issues/42", status: "created" },
      ],
    });
    expect(result.relationships[0]).toMatchObject({ status: "verified", parentNumber: 7, childNumber: 42 });
  });
});
