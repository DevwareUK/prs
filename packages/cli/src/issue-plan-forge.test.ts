import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UNATTENDED_GITHUB_OUTPUT_NOTE } from "@prs/contracts";
import {
  REPO_ROOT,
  cleanupTargets,
  getRepositoryIssueUrl,
  createIssueResolutionPlanResult,
  createFetchResponse,
  listRunDirectories,
  readLatestRunMetadata,
  loadGitHubForge,
  createMockCodexSuperpowersHome,
  withRepositoryConfig,
  loadCli,
} from "./index-test-support";

describe("Issue plan and GitHub forge workflows", () => {
  it("generates an issue resolution plan comment when none exists", async () => {
    const issueNumber = 42;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Add Command to Generate and Modify Issue Resolution Plan",
          body: "Create a plan comment and reuse it in later issue runs.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 501,
          body: "<!-- prs:issue-plan -->\n## Issue Resolution Plan",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-501`,
          updated_at: "2026-03-18T11:11:41Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const issuePlan = createIssueResolutionPlanResult();
    const { run, generateIssueResolutionPlan } = await loadCli({
      issueResolutionPlanResult: issuePlan,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 1, error: new Error("codex is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "issue", "plan", String(issueNumber)];

    await run();

    expect(generateIssueResolutionPlan).toHaveBeenCalledWith(expect.any(Object), {
      issueNumber,
      issueTitle: "Add Command to Generate and Modify Issue Resolution Plan",
      issueBody: "Create a plan comment and reuse it in later issue runs.",
      issueUrl: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `https://api.github.com/repos/DevwareUK/prs/issues/${issueNumber}/comments`
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: expect.stringMatching(/^Bearer /),
      }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining("<!-- prs:issue-plan -->"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.not.stringContaining(UNATTENDED_GITHUB_OUTPUT_NOTE),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining(issuePlan.summary),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining("### Acceptance criteria"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining("### Likely files"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining("### Test plan"),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining("### Done definition"),
    });
  });

  it("reuses an existing edited issue resolution plan comment", async () => {
    const issueNumber = 42;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 777,
            body: [
              "<!-- prs:issue-plan -->",
              "## Issue Resolution Plan",
              "",
              "Edited on GitHub by a collaborator.",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-777`,
            updated_at: "2026-03-18T12:00:00Z",
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, generateIssueResolutionPlan } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "plan", String(issueNumber)];

    await run();

    expect(generateIssueResolutionPlan).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes an existing managed issue resolution plan comment when requested", async () => {
    const issueNumber = 42;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 777,
            body: [
              "<!-- prs:issue-plan -->",
              "## Issue Resolution Plan",
              "",
              "Edited on GitHub by a collaborator.",
            ].join("\n"),
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-777`,
            updated_at: "2026-03-18T12:00:00Z",
          },
        ])
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Add Command to Generate and Modify Issue Resolution Plan",
          body: "Create a plan comment and reuse it in later issue runs.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 777,
          body: "<!-- prs:issue-plan -->\n## Issue Resolution Plan",
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-777`,
          updated_at: "2026-03-18T12:05:00Z",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const issuePlan = createIssueResolutionPlanResult();
    const { run, generateIssueResolutionPlan } = await loadCli({
      issueResolutionPlanResult: issuePlan,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex" && args[0] === "--version") {
          return { status: 1, error: new Error("codex is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "issue", "plan", String(issueNumber), "--refresh"];

    await run();

    expect(generateIssueResolutionPlan).toHaveBeenCalledWith(expect.any(Object), {
      issueNumber,
      issueTitle: "Add Command to Generate and Modify Issue Resolution Plan",
      issueBody: "Create a plan comment and reuse it in later issue runs.",
      issueUrl: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `https://api.github.com/repos/DevwareUK/prs/issues/comments/777`
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "PATCH",
      headers: expect.objectContaining({
        Authorization: expect.stringMatching(/^Bearer /),
      }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      body: expect.stringContaining("### Done definition"),
    });
  });

  it("creates a managed issue plan comment from a Superpowers plan artifact", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 42;
    let runtimePrompt = "";
    createMockCodexSuperpowersHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Add Superpowers issue plans",
          body: "Create implementation plans through Codex Superpowers.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        return createFetchResponse({
          id: 90210,
          body: JSON.parse(String(init.body)).body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-90210`,
          updated_at: "2026-04-26T10:20:00Z",
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await withRepositoryConfig(
      JSON.stringify(
        {
          ai: {
            issue: {
              useCodexSuperpowers: true,
            },
            runtime: {
              type: "codex",
            },
          },
        },
        null,
        2
      ),
      async () => {
        const { run, generateIssueResolutionPlan } = await loadCli({
          execFileSyncImpl: (command, args) => {
            if (command === "git" && args[0] === "remote") {
              return "git@github.com:DevwareUK/prs.git\n";
            }

            throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
          },
          spawnSyncImpl: (command, args) => {
            if (command === "gh" && args[0] === "--version") {
              return { status: 1, error: new Error("gh is unavailable") };
            }

            if (command === "codex" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "codex") {
              const { metadata, runDir } = readLatestRunMetadata();
              runtimePrompt = readFileSync(
                resolve(REPO_ROOT, metadata.promptFile as string),
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.runDir as string, "superpowers-plan.md"),
                "# Superpowers Plan\n\n- Use the run-local implementation plan.\n",
                "utf8"
              );
              cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
              return { status: 0 };
            }

            throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
          },
        });

        process.env.GH_TOKEN = "";
        process.env.GITHUB_TOKEN = "test-token";
        process.argv = ["node", "prs", "issue", "plan", String(issueNumber)];
        await run();

        expect(generateIssueResolutionPlan).not.toHaveBeenCalled();
      }
    );

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(runtimePrompt).toContain("use `superpowers:brainstorming`");
    expect(runtimePrompt).toContain("use `superpowers:writing-plans`");
    expect(runtimePrompt).toContain(`Write the Superpowers spec artifact to \`.prs/runs/${createdRunDir}/superpowers-spec.md\`.`);
    expect(runtimePrompt).toContain(`Write the Superpowers plan artifact to \`.prs/runs/${createdRunDir}/superpowers-plan.md\`.`);

    const planCommentCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/issues/${issueNumber}/comments`) &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(planCommentCall).toBeDefined();
    expect(JSON.parse(String((planCommentCall?.[1] as RequestInit).body))).toEqual({
      body: "<!-- prs:issue-plan -->\n# Superpowers Plan\n\n- Use the run-local implementation plan.\n",
    });
  });

  it("lists issue comments through the GitHub repository forge adapter", async () => {
    const issueNumber = 42;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse([
        {
          id: 3001,
          body: "First refinement note.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3001`,
          created_at: "2026-04-24T10:00:00Z",
          updated_at: "2026-04-24T10:05:00Z",
          user: {
            login: "alice",
            type: "User",
          },
        },
        {
          id: 3002,
          body: "Automated summary.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3002`,
          created_at: "2026-04-24T10:06:00Z",
          updated_at: "2026-04-24T10:06:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { createGitHubRepositoryForge } = await loadGitHubForge();
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect((forge as any).fetchIssueComments(issueNumber)).resolves.toEqual([
      {
        id: 3001,
        body: "First refinement note.",
        url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3001`,
        createdAt: "2026-04-24T10:00:00Z",
        updatedAt: "2026-04-24T10:05:00Z",
        author: "alice",
        isBot: false,
      },
      {
        id: 3002,
        body: "Automated summary.",
        url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3002`,
        createdAt: "2026-04-24T10:06:00Z",
        updatedAt: "2026-04-24T10:06:00Z",
        author: "prs-bot",
        isBot: true,
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.github.com/repos/DevwareUK/prs/issues/${issueNumber}/comments?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
  });

  it("fetches pull request review threads with lifecycle state through GraphQL", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: {
                  hasNextPage: false,
                  endCursor: null,
                },
                nodes: [
                  {
                    id: "PRRT_kwDO_thread",
                    isResolved: false,
                    isOutdated: true,
                    comments: {
                      nodes: [
                        {
                          databaseId: 9001,
                          body: "Handle lookup failures.",
                          path: "src/migrate.ts",
                          line: 42,
                          originalLine: 40,
                          startLine: null,
                          originalStartLine: null,
                          diffHunk: "@@ -40,3 +42,4 @@",
                          url: "https://github.com/DevwareUK/prs/pull/133#discussion_r9001",
                          author: {
                            login: "github-actions[bot]",
                          },
                          createdAt: "2026-05-14T10:00:00Z",
                          updatedAt: "2026-05-14T10:05:00Z",
                          replyTo: null,
                          commit: {
                            oid: "abc123",
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createGitHubRepositoryForge } = await loadGitHubForge({
      spawnSyncImpl: () => ({ status: 1 }),
    });
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect(forge.fetchPullRequestReviewThreads?.(133)).resolves.toEqual([
      {
        threadId: 9001,
        nodeId: "PRRT_kwDO_thread",
        isResolved: false,
        isOutdated: true,
        comments: [
          {
            id: 9001,
            body: "Handle lookup failures.",
            path: "src/migrate.ts",
            line: 42,
            originalLine: 40,
            startLine: undefined,
            originalStartLine: undefined,
            diffHunk: "@@ -40,3 +42,4 @@",
            url: "https://github.com/DevwareUK/prs/pull/133#discussion_r9001",
            author: "github-actions[bot]",
            authorIsBot: true,
            createdAt: "2026-05-14T10:00:00Z",
            updatedAt: "2026-05-14T10:05:00Z",
            inReplyToId: undefined,
            commitOid: "abc123",
          },
        ],
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("fetches audit comments through the GitHub repository forge adapter", async () => {
    const issueNumber = 42;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse({ number: issueNumber }))
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 3101,
            body: "Ordinary issue discussion.",
            html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3101`,
            created_at: "2026-04-24T11:00:00Z",
            updated_at: "2026-04-24T11:01:00Z",
            user: {
              login: "alice",
              type: "User",
            },
          },
          {
            id: 3102,
            body: "<!-- prs:audit -->\n# Issue #42 stale audit\n",
            html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3102`,
            created_at: "2026-04-24T11:02:00Z",
            updated_at: "2026-04-24T11:03:00Z",
            user: {
              login: "prs-bot",
              type: "Bot",
            },
          },
          {
            id: 3103,
            body: "<!-- prs:audit -->\n# Issue #42 newer audit\n",
            html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3103`,
            created_at: "2026-04-24T10:02:00Z",
            updated_at: "2026-04-24T11:04:00Z",
            user: {
              login: "prs-bot",
              type: "Bot",
            },
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { createGitHubRepositoryForge } = await loadGitHubForge();
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect(
      (forge as any).fetchAuditComment({ type: "issue", number: issueNumber })
    ).resolves.toEqual({
      id: 3103,
      body: "<!-- prs:audit -->\n# Issue #42 newer audit\n",
      url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3103`,
      createdAt: "2026-04-24T10:02:00Z",
      updatedAt: "2026-04-24T11:04:00Z",
      author: "prs-bot",
      isBot: true,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.github.com/repos/DevwareUK/prs/issues/${issueNumber}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.github.com/repos/DevwareUK/prs/issues/${issueNumber}/comments?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
  });

  it("fetches audit comments from paginated GitHub issue comments", async () => {
    const issueNumber = 43;
    const ordinaryComments = Array.from({ length: 100 }, (_, index) => ({
      id: 3300 + index,
      body: `Ordinary comment ${index + 1}.`,
      html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-${3300 + index}`,
      created_at: "2026-04-24T11:00:00Z",
      updated_at: "2026-04-24T11:00:00Z",
      user: {
        login: "alice",
        type: "User",
      },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse({ number: issueNumber }))
      .mockResolvedValueOnce(createFetchResponse(ordinaryComments))
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 3401,
            body: "<!-- prs:audit -->\n# Issue #43 audit\n",
            html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3401`,
            created_at: "2026-04-24T12:00:00Z",
            updated_at: "2026-04-24T12:01:00Z",
            user: {
              login: "prs-bot",
              type: "Bot",
            },
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { createGitHubRepositoryForge } = await loadGitHubForge();
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect(
      (forge as any).fetchAuditComment({ type: "pull-request", number: issueNumber })
    ).resolves.toEqual({
      id: 3401,
      body: "<!-- prs:audit -->\n# Issue #43 audit\n",
      url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3401`,
      createdAt: "2026-04-24T12:00:00Z",
      updatedAt: "2026-04-24T12:01:00Z",
      author: "prs-bot",
      isBot: true,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.github.com/repos/DevwareUK/prs/pulls/${issueNumber}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.github.com/repos/DevwareUK/prs/issues/${issueNumber}/comments?per_page=100`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `https://api.github.com/repos/DevwareUK/prs/issues/${issueNumber}/comments?per_page=100&page=2`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
  });

  it("creates audit comments through the GitHub repository forge adapter", async () => {
    const prNumber = 88;
    const body = "<!-- prs:audit -->\n# Pull request #88 audit\n";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse({ number: prNumber }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 3201,
          body,
          html_url: `https://github.com/DevwareUK/prs/pull/${prNumber}#issuecomment-3201`,
          created_at: "2026-04-24T12:00:00Z",
          updated_at: "2026-04-24T12:00:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { createGitHubRepositoryForge } = await loadGitHubForge();
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect(
      (forge as any).createAuditComment({ type: "pull-request", number: prNumber }, body)
    ).resolves.toEqual({
      id: 3201,
      body,
      url: `https://github.com/DevwareUK/prs/pull/${prNumber}#issuecomment-3201`,
      createdAt: "2026-04-24T12:00:00Z",
      updatedAt: "2026-04-24T12:00:00Z",
      author: "prs-bot",
      isBot: true,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.github.com/repos/DevwareUK/prs/pulls/${prNumber}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `https://api.github.com/repos/DevwareUK/prs/issues/${prNumber}/comments`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "User-Agent": "prs-cli",
        }),
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      body,
    });
  });

  it("creates audit comments with a resolved gh token when gh is outside PATH", async () => {
    const issueNumber = 199;
    const body = "<!-- prs:audit -->\n# Issue #199 audit\n";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse({ number: issueNumber }))
      .mockResolvedValueOnce(
        createFetchResponse({
          id: 3202,
          body,
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-3202`,
          created_at: "2026-05-13T12:00:00Z",
          updated_at: "2026-05-13T12:00:00Z",
          user: {
            login: "prs-bot",
            type: "Bot",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "";
    process.env.PATH = "/usr/bin:/bin";

    const { createGitHubRepositoryForge, execFileSync } = await loadGitHubForge({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        if (command === "/opt/homebrew/bin/gh" && args.join(" ") === "auth token") {
          return "resolved-gh-token\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable on PATH") };
        }

        if (command === "/usr/bin/gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable on PATH") };
        }

        if (command === "/bin/gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable on PATH") };
        }

        if (command === "/opt/homebrew/bin/gh" && args[0] === "--version") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect(
      (forge as any).createAuditComment({ type: "issue", number: issueNumber }, body)
    ).resolves.toMatchObject({
      id: 3202,
      body,
    });

    expect(execFileSync).toHaveBeenCalledWith(
      "/opt/homebrew/bin/gh",
      ["auth", "token"],
      expect.any(Object)
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer resolved-gh-token",
      }),
    });
  });

  it("rejects issue audit targets that resolve to pull requests", async () => {
    const issueNumber = 88;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: issueNumber,
        pull_request: {
          url: `https://api.github.com/repos/DevwareUK/prs/pulls/${issueNumber}`,
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { createGitHubRepositoryForge } = await loadGitHubForge();
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect(
      (forge as any).fetchAuditComment({ type: "issue", number: issueNumber })
    ).rejects.toThrow(`Use --pr ${issueNumber} for audit publication.`);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("updates issue bodies through the GitHub repository forge adapter", async () => {
    const issueNumber = 42;
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: issueNumber,
        title: "Refined title",
        html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { createGitHubRepositoryForge } = await loadGitHubForge();
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect(
      (forge as any).updateIssue(
        issueNumber,
        "Refined title",
        "<!-- prs:managed-issue -->\n\n## Summary\nRefined body."
      )
    ).resolves.toEqual({
      number: issueNumber,
      title: "Refined title",
      url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
      status: "existing",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.github.com/repos/DevwareUK/prs/issues/${issueNumber}`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          "User-Agent": "prs-cli",
        }),
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      title: "Refined title",
      body: "<!-- prs:managed-issue -->\n\n## Summary\nRefined body.",
    });
  });

  it("lists open pull requests with changed files through the GitHub repository forge adapter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 123,
            title: "Existing issue workflow change",
            html_url: "https://github.com/DevwareUK/prs/pull/123",
            base: { ref: "main" },
            head: { ref: "feat/existing-issue-workflow-change" },
          },
        ])
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          { filename: "packages/cli/src/index.ts" },
          { filename: "README.md" },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { createGitHubRepositoryForge } = await loadGitHubForge();
    const forge = createGitHubRepositoryForge(REPO_ROOT);

    await expect((forge as any).listOpenPullRequestChanges()).resolves.toEqual([
      {
        number: 123,
        title: "Existing issue workflow change",
        url: "https://github.com/DevwareUK/prs/pull/123",
        baseRefName: "main",
        headRefName: "feat/existing-issue-workflow-change",
        files: ["packages/cli/src/index.ts", "README.md"],
      },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/DevwareUK/prs/pulls?state=open&per_page=100",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/DevwareUK/prs/pulls/123/files?per_page=100",
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer test-token",
          "User-Agent": "prs-cli",
        },
      }
    );
  });

});
