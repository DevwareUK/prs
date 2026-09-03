import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPullRequestsTool } from "./pr-list-tool";

beforeEach(() => vi.stubGlobal("fetch", () => { throw new Error("Direct HTTP must not be used"); }));
afterEach(() => vi.unstubAllGlobals());

describe("PR list tool", () => {
  it("returns a structured blocked result when GitHub auth is unavailable", async () => {
    const request = vi.fn();

    await expect(
      listPullRequestsTool({
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
        "GitHub authentication is required for `prs tool pr list --actionable --json`."
      ),
      nextAction:
        "Install gh and authenticate with gh auth login --hostname github.com for the selected account.",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("lists and filters actionable pull requests for the authenticated user", async () => {
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
            number: 10,
            title: "Owned by me",
            html_url: "https://github.com/DevwareUK/prs/pull/10",
            user: { login: "me" },
            assignees: [],
            requested_reviewers: [],
            head: { ref: "codex/owned-by-me" },
            labels: [],
            updated_at: "2026-05-10T10:00:00Z",
            mergeable: true,
          },
          {
            number: 11,
            title: "Needs my review",
            html_url: "https://github.com/DevwareUK/prs/pull/11",
            user: { login: "someone-else" },
            assignees: [],
            requested_reviewers: [{ login: "me" }],
            head: { ref: "feature/review-me" },
            labels: [{ name: "ready" }],
            updated_at: "2026-05-11T10:00:00Z",
            mergeable_state: "dirty",
          },
          {
            number: 12,
            title: "Not mine",
            html_url: "https://github.com/DevwareUK/prs/pull/12",
            user: { login: "someone-else" },
            assignees: [],
            requested_reviewers: [],
            head: { ref: "feature/unrelated" },
            labels: [],
            updated_at: "2026-05-11T11:00:00Z",
            mergeable: true,
          },
        ]),
      });

    await expect(
      listPullRequestsTool({
        actionable: true,
        env: { GITHUB_TOKEN: "token" },
        request,
        spawnSyncImpl: () => ({ status: 0 }),
        repoRoot: "/repo",
        runCommand: () => "git@github.com:DevwareUK/prs.git",
      })
    ).resolves.toMatchObject({
      status: "ready",
      actionable: true,
      currentUser: "me",
      pullRequests: [
        {
          number: 11,
          url: "https://github.com/DevwareUK/prs/pull/11",
          reviewRequestedFrom: ["me"],
          hasConflicts: true,
        },
        {
          number: 10,
          url: "https://github.com/DevwareUK/prs/pull/10",
          author: "me",
        },
      ],
    });
  });

  it("skips pull requests without usable GitHub URLs", async () => {
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
            number: 10,
            title: "Valid PR",
            html_url: "https://github.com/DevwareUK/prs/pull/10",
            user: { login: "me" },
            assignees: [],
            requested_reviewers: [],
            head: { ref: "codex/valid-pr" },
            labels: [],
            updated_at: "2026-05-10T10:00:00Z",
            mergeable: true,
          },
          {
            number: 11,
            title: "Malformed URL",
            html_url: "not-a-github-url",
            user: { login: "me" },
            assignees: [],
            requested_reviewers: [],
            head: { ref: "codex/malformed-url" },
            labels: [],
            updated_at: "2026-05-11T10:00:00Z",
            mergeable: true,
          },
          {
            number: 12,
            title: "Missing URL",
            user: { login: "me" },
            assignees: [],
            requested_reviewers: [],
            head: { ref: "codex/missing-url" },
            labels: [],
            updated_at: "2026-05-12T10:00:00Z",
            mergeable: true,
          },
        ]),
      });

    await expect(
      listPullRequestsTool({
        actionable: false,
        env: { GITHUB_TOKEN: "token" },
        request,
        spawnSyncImpl: () => ({ status: 0 }),
        repoRoot: "/repo",
        runCommand: () => "git@github.com:DevwareUK/prs.git",
      })
    ).resolves.toMatchObject({
      status: "ready",
      pullRequests: [
        {
          number: 10,
          url: "https://github.com/DevwareUK/prs/pull/10",
        },
      ],
    });
  });
});
