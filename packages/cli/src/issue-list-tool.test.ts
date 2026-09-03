import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listIssuesTool } from "./issue-list-tool";

beforeEach(() => vi.stubGlobal("fetch", () => { throw new Error("Direct HTTP must not be used"); }));
afterEach(() => vi.unstubAllGlobals());

describe("issue list tool", () => {
  it("returns a structured blocked result when GitHub auth is unavailable", async () => {
    const request = vi.fn();

    await expect(
      listIssuesTool({
        actionable: true,
        env: {},
        request,
        repoRoot: "/repo",
        runCommand: (command) => {
          if (command === "gh") {
            throw new Error("gh unavailable");
          }

          return "git@github.com:DevwareUK/prs.git";
        },
        spawnSyncImpl: () => ({ status: 1, error: new Error("gh unavailable") }),
      })
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "github-auth-required",
      message: expect.stringContaining(
        "GitHub authentication is required for `prs tool issue list --actionable --json`."
      ),
      nextAction:
        "Install gh and authenticate with gh auth login --hostname github.com for the selected account.",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("lists and filters actionable issues for the authenticated user", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ login: "me" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            number: 1,
            title: "Owned by me",
            html_url: "https://github.com/DevwareUK/prs/issues/1",
            user: { login: "me" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-10T10:00:00Z",
          },
          {
            number: 2,
            title: "Already has a PR",
            html_url: "https://github.com/DevwareUK/prs/issues/2",
            user: { login: "me" },
            assignees: [{ login: "me" }],
            labels: [{ name: "ready" }],
            updated_at: "2026-05-11T10:00:00Z",
          },
          {
            number: 3,
            title: "Planned issue",
            html_url: "https://github.com/DevwareUK/prs/issues/3",
            user: { login: "someone-else" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-12T10:00:00Z",
          },
          {
            number: 4,
            title: "Pull request returned by issues endpoint",
            html_url: "https://github.com/DevwareUK/prs/pull/4",
            user: { login: "me" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-12T11:00:00Z",
            pull_request: {},
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            number: 9,
            title: "Implementation PR",
            body: "Fixes #2",
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            body: [
              "<!-- prs:issue-plan -->",
              "Plan",
            ].join("\n"),
          },
        ]),
      });

    await expect(
      listIssuesTool({
        actionable: true,
        env: { GH_TOKEN: "token" },
        request,
        spawnSyncImpl: () => ({ status: 0 }),
        repoRoot: "/repo",
        runCommand: () => "git@github.com:DevwareUK/prs.git",
      })
    ).resolves.toMatchObject({
      status: "ready",
      actionable: true,
      currentUser: "me",
      issues: [
        {
          number: 3,
          url: "https://github.com/DevwareUK/prs/issues/3",
          hasPrsPlan: true,
          hasLinkedOpenPullRequest: false,
        },
        {
          number: 1,
          url: "https://github.com/DevwareUK/prs/issues/1",
          author: "me",
          hasLinkedOpenPullRequest: false,
        },
      ],
    });
  });

  it("skips issues without usable GitHub URLs", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ login: "me" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          {
            number: 1,
            title: "Valid issue",
            html_url: "https://github.com/DevwareUK/prs/issues/1",
            user: { login: "me" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-10T10:00:00Z",
          },
          {
            number: 2,
            title: "Malformed URL",
            html_url: "not-a-github-url",
            user: { login: "me" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-11T10:00:00Z",
          },
          {
            number: 3,
            title: "Missing URL",
            user: { login: "me" },
            assignees: [],
            labels: [],
            updated_at: "2026-05-12T10:00:00Z",
          },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      });

    await expect(
      listIssuesTool({
        actionable: false,
        env: { GH_TOKEN: "token" },
        request,
        spawnSyncImpl: () => ({ status: 0 }),
        repoRoot: "/repo",
        runCommand: () => "git@github.com:DevwareUK/prs.git",
      })
    ).resolves.toMatchObject({
      status: "ready",
      issues: [
        {
          number: 1,
          url: "https://github.com/DevwareUK/prs/issues/1",
        },
      ],
    });
  });
});

it("uses the project account for both viewer identity and actionable filtering", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "prs-list-account-"));
  mkdirSync(join(root, ".prs"));
  writeFileSync(join(root, ".prs/config.local.json"), JSON.stringify({ forge: { githubAccount: "work" } }));
  const result = await listIssuesTool({ actionable: true, repoRoot: root,
    env: { GH_TOKEN: "personal-secret" }, spawnSyncImpl: () => ({ status: 0 }),
    runCommand: () => "git@github.com:DevwareUK/prs.git",
    runGitHubCommand: (_command, args, options) => {
      if (args[0] === "auth") return "work-secret";
      expect(options.env.GH_TOKEN).toBe("work-secret");
      const payload = args[1] === "user" ? { login: "work" }
        : args[1].includes("/issues?") ? [{ number: 1, title: "Work task", html_url: "https://github.com/DevwareUK/prs/issues/1", user: { login: "work" }, updated_at: "2026-09-03T09:00:00Z" }]
        : [];
      return `HTTP/2.0 200 OK\n\n${JSON.stringify(payload)}`;
    },
  });
  expect(result).toMatchObject({ status: "ready", currentUser: "work", issues: [{ number: 1, author: "work" }] });
});
