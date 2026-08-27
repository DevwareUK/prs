import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

import { listIssueLinkedPullRequestsForRepoRoot } from "./github";

const execFileSyncMock = vi.mocked(execFileSync);
const spawnSyncMock = vi.mocked(spawnSync);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
});

describe("listIssueLinkedPullRequestsForRepoRoot", () => {
  it("reads public timeline cross-references without requiring a GraphQL token", async () => {
    execFileSyncMock.mockImplementation((command, args) => {
      if (command === "git" && args?.[2] === "remote") {
        return "git@github.com:DevwareUK/prs.git\n";
      }
      if (command === "gh" && args?.[0] === "auth" && args?.[1] === "token") {
        throw new Error("no oauth token found");
      }
      throw new Error(`Unexpected command: ${String(command)} ${args?.join(" ")}`);
    });
    spawnSyncMock.mockImplementation((command, args) => {
      if (command === "gh" && args?.[0] === "--version") {
        return { status: 0 } as ReturnType<typeof spawnSync>;
      }
      return { status: 1 } as ReturnType<typeof spawnSync>;
    });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            event: "cross-referenced",
            source: {
              issue: {
                number: 401,
                title: "Open contract PR",
                html_url: "https://github.com/DevwareUK/prs/pull/401",
                state: "open",
                pull_request: { merged_at: null },
              },
            },
          },
          {
            event: "cross-referenced",
            source: {
              issue: {
                number: 402,
                title: "Merged contract PR",
                html_url: "https://github.com/DevwareUK/prs/pull/402",
                state: "closed",
                pull_request: { merged_at: "2026-08-27T12:00:00Z" },
              },
            },
          },
          { event: "commented" },
        ]),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listIssueLinkedPullRequestsForRepoRoot("/tmp/prs-repo", 324)
    ).resolves.toEqual([
      {
        number: 401,
        title: "Open contract PR",
        url: "https://github.com/DevwareUK/prs/pull/401",
        state: "open",
      },
      {
        number: 402,
        title: "Merged contract PR",
        url: "https://github.com/DevwareUK/prs/pull/402",
        state: "merged",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/DevwareUK/prs/issues/324/timeline?per_page=100",
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
      })
    );
  });
});
