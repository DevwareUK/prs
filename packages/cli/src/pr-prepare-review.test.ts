import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  REPO_ROOT,
  cleanupTargets,
  captureStdout,
  createFetchResponse,
  listRunDirectories,
  loadCli,
} from "./index-test-support";

describe("PR prepare-review workflow", () => {
  it("rejects the retired prs codex prepare-review launcher with migration guidance", async () => {
    const { run } = await loadCli();

    process.argv = ["node", "prs", "codex", "pr", "prepare-review", "87"];

    await expect(run()).rejects.toThrow(
      "`prs codex ...` has been retired because prs is skill-first."
    );
  });

  it("runs prs tool pr prepare-review as deterministic JSON without launching Codex", async () => {
    const beforeRuns = listRunDirectories();
    const branchName = "feat/tool-pr-review";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 87,
        title: "Prepare a review workspace",
        body: "Set up a reviewer-ready local workspace for this pull request.",
        html_url: "https://github.com/DevwareUK/prs/pull/87",
        base: { ref: "main" },
        head: { ref: branchName },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run, spawnSync } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return "";
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "pnpm" && args[0] === "--version") {
          return { status: 0, stdout: "9.0.0\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === `refs/heads/${branchName}`
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "checkout" && args[1] === branchName) {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (command === "git" && args[0] === "fetch" && args[1] === "origin" && args[2] === "main") {
          return { status: 0, stdout: "", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "rev-parse" &&
          (args[1] === "origin/main" ||
            (args[1] === "--verify" && args[2] === "refs/remotes/origin/main"))
        ) {
          return { status: 0, stdout: "base-tip-87\n", stderr: "" };
        }

        if (
          command === "git" &&
          args[0] === "merge-base" &&
          args[1] === "--is-ancestor" &&
          args[2] === "base-tip-87" &&
          args[3] === "HEAD"
        ) {
          return { status: 0, stdout: "", stderr: "" };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "tool", "pr", "prepare-review", "87", "--json"];
    const stdout = captureStdout();

    await run();

    expect(stdout.output().trimStart()).toMatch(/^\{/);
    const result = JSON.parse(stdout.output()) as {
      status: string;
      prNumber: number;
      nextAction: string;
      reviewBriefFilePath?: string;
      snapshotFilePath?: string;
      checkout: { source: string; branchName: string };
    };
    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    if (createdRunDir) {
      cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir));
    }

    expect(result).toMatchObject({
      status: "ready",
      prNumber: 87,
      nextAction: "review-current-checkout",
      checkout: {
        source: "local-head",
        branchName,
      },
    });
    expect(result.reviewBriefFilePath).toBeUndefined();
    expect(result.snapshotFilePath).toMatch(/pr-review-prepare\.md$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(spawnSync).not.toHaveBeenCalledWith("codex", expect.anything(), expect.anything());
  });

  it("runs prs tool pr list actionable as deterministic JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          login: "me",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 115,
            title: "Needs my review",
            html_url: "https://github.com/DevwareUK/prs/pull/115",
            user: { login: "someone-else" },
            assignees: [],
            requested_reviewers: [{ login: "me" }],
            head: { ref: "codex/review-me" },
            labels: [{ name: "ready" }],
            updated_at: "2026-05-11T10:00:00Z",
            mergeable: true,
          },
          {
            number: 116,
            title: "Unrelated PR",
            html_url: "https://github.com/DevwareUK/prs/pull/116",
            user: { login: "someone-else" },
            assignees: [],
            requested_reviewers: [],
            head: { ref: "feature/unrelated" },
            labels: [],
            updated_at: "2026-05-11T11:00:00Z",
            mergeable: true,
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") {
          return `${REPO_ROOT}\n`;
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "tool", "pr", "list", "--actionable", "--json"];
    const stdout = captureStdout();

    await run();

    expect(stdout.output().trimStart()).toMatch(/^\{/);
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: "ready",
      actionable: true,
      currentUser: "me",
      pullRequests: [
        {
          number: 115,
          url: "https://github.com/DevwareUK/prs/pull/115",
          reviewRequestedFrom: ["me"],
        },
      ],
      source: "github-api",
    });
  });

  it("runs prs tool issue list actionable as deterministic JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          login: "me",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 151,
            title: "Planned issue",
            html_url: "https://github.com/DevwareUK/prs/issues/151",
            user: { login: "someone-else" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-12T10:00:00Z",
          },
          {
            number: 152,
            title: "Pull request returned by issues endpoint",
            html_url: "https://github.com/DevwareUK/prs/pull/152",
            user: { login: "me" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-12T11:00:00Z",
            pull_request: {},
          },
        ])
      )
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            body: "<!-- prs:issue-plan -->\nPlan",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") {
          return `${REPO_ROOT}\n`;
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "tool", "issue", "list", "--actionable", "--json"];
    const stdout = captureStdout();

    await run();

    expect(stdout.output().trimStart()).toMatch(/^\{/);
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: "ready",
      actionable: true,
      currentUser: "me",
      issues: [
        {
          number: 151,
          url: "https://github.com/DevwareUK/prs/issues/151",
          hasPrsPlan: true,
        },
      ],
      source: "github-api",
    });
  });

  it("loads repository .env before running prs tool pr list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          login: "me",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 117,
            title: "Review me from env",
            html_url: "https://github.com/DevwareUK/prs/pull/117",
            user: { login: "someone-else" },
            assignees: [],
            requested_reviewers: [{ login: "me" }],
            head: { ref: "codex/env-token" },
            labels: [],
            updated_at: "2026-05-11T12:00:00Z",
            mergeable: true,
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const dotenvConfig = vi.fn((options?: { path?: string }) => {
      expect(options?.path).toBe(resolve(REPO_ROOT, ".env"));
      process.env.GITHUB_TOKEN = "test-token";
      return { parsed: { GITHUB_TOKEN: "test-token" } };
    });
    const { run } = await loadCli({
      dotenvConfigImpl: dotenvConfig,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "rev-parse") {
          return `${REPO_ROOT}\n`;
        }

        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "tool", "pr", "list", "--actionable", "--json"];
    const stdout = captureStdout();

    await run();

    expect(dotenvConfig).toHaveBeenCalledWith({ path: resolve(REPO_ROOT, ".env"), quiet: true });
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: "ready",
      actionable: true,
      pullRequests: [
        {
          number: 117,
          url: "https://github.com/DevwareUK/prs/pull/117",
          reviewRequestedFrom: ["me"],
        },
      ],
    });
  });
});
