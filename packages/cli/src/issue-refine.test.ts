import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getIssueRefineSessionStateFilePath,
  loadIssueRefineSessionState,
  writeIssueRefineSessionState,
} from "./run-artifacts";
import {
  REPO_ROOT,
  cleanupTargets,
  getRepositoryIssueUrl,
  createTestBacklogAnalysis,
  createFetchResponse,
  captureStdout,
  listRunDirectories,
  readLatestRunMetadata,
  createMockCodexHome,
  createMockCodexSuperpowersHome,
  writeMockCodexSession,
  withRepositoryConfig,
  loadCli,
} from "./index-test-support";

describe("Issue refine workflow", () => {
  it("prompts for requested issue changes and starts a fresh issue refine session", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 55;
    let runtimePrompt = "";
    createMockCodexHome();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Improve release automation",
          body: "Current issue body with a short summary.",
          html_url: getRepositoryIssueUrl(issueNumber),
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            id: 1,
            body: "Customer impact is deployment safety.",
            html_url:
              `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-1`,
            created_at: "2026-04-24T10:00:00Z",
            updated_at: "2026-04-24T10:00:00Z",
            user: {
              login: "customer-user",
              type: "User",
            },
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      readlineAnswers: ["y", "Clarify the rollback plan and edge cases.", "n"],
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
          runtimePrompt = readFileSync(resolve(REPO_ROOT, metadata.promptFile as string), "utf8");
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Improve release automation\n\n## Summary\nRefined spec.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    expect(runtimePrompt).toContain("What changes should be made to the original requirements?");
    expect(runtimePrompt).toContain("Clarify the rollback plan and edge cases.");
    expect(runtimePrompt).toContain("Current issue body with a short summary.");
    expect(runtimePrompt).toContain("@customer-user");
    expect(runtimePrompt).toContain("Customer impact is deployment safety.");

    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      flow?: string;
      requestedChanges?: string;
      draftFile?: string;
      questionsFile?: string;
    };
    expect(metadata).toMatchObject({
      flow: "issue-refine",
      requestedChanges: "Clarify the rollback plan and edge cases.",
      draftFile: `.prs/runs/${createdRunDir}/issue-refine-${issueNumber}.md`,
      questionsFile: `.prs/runs/${createdRunDir}/issue-refine-questions.md`,
    });
    expect(
      readFileSync(resolve(REPO_ROOT, metadata.draftFile as string), "utf8")
    ).toBe("# Improve release automation\n\n## Summary\nRefined spec.");
    expect(loadIssueRefineSessionState(REPO_ROOT, issueNumber)).toMatchObject({
      issueNumber,
      latestDraftFile: resolve(
        REPO_ROOT,
        ".prs",
        "runs",
        createdRunDir as string,
        `issue-refine-${issueNumber}.md`
      ),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh issue refine session without requested changes when declined by default", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 156;
    let runtimePrompt = "";
    createMockCodexHome();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Refine without extra changes",
          body: "Original requirements already describe the implementation.",
          html_url: getRepositoryIssueUrl(issueNumber),
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      readlineAnswers: ["", "n"],
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
          runtimePrompt = readFileSync(resolve(REPO_ROOT, metadata.promptFile as string), "utf8");
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Refine without extra changes\n\n## Summary\nImplementation-ready draft.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    expect(runtimePrompt).not.toContain("What changes should be made to the original requirements?");
    expect(runtimePrompt).toContain("Original requirements already describe the implementation.");

    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      requestedChanges?: string;
    };
    expect(metadata.requestedChanges).toBeUndefined();
  });

  it("retries the issue refine change gate after invalid yes-no input", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 157;
    let runtimePrompt = "";
    const messages: string[] = [];
    createMockCodexHome();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Retry refine gate",
          body: "Original requirements.",
          html_url: getRepositoryIssueUrl(issueNumber),
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      readlineAnswers: ["maybe", "yes", "Add rollout details.", "n"],
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
          runtimePrompt = readFileSync(resolve(REPO_ROOT, metadata.promptFile as string), "utf8");
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Retry refine gate\n\n## Summary\nRefined draft.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    expect(messages.join("\n")).toContain("Choose yes or no.");
    expect(runtimePrompt).toContain("Add rollout details.");
  });

  it("posts brainstorming questions instead of publishing artifacts when requirements are unresolved", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 158;
    let runtimePrompt = "";
    createMockCodexSuperpowersHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`) && init?.method === "PATCH") {
        throw new Error("Issue refinement should not update the issue body.");
      }

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Loose order information request",
          body: "Can we capture extra information on an order?",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        return createFetchResponse({
          id: 9158,
          body: body.body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9158`,
          updated_at: "2026-04-26T09:35:00Z",
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
          },
        },
        null,
        2
      ),
      async () => {
        const { run } = await loadCli({
          readlineAnswers: ["n", "y"],
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
                resolve(REPO_ROOT, metadata.questionsFile as string),
                [
                  "Before I write the spec and implementation plan, I need to pin down the intended order workflow.",
                  "",
                  "- Who can view and edit the extra order information?",
                  "- Should it appear in confirmation emails, exports, reports, or admin screens?",
                  "- Is this information required at checkout or optional?",
                  "",
                ].join("\n"),
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
        process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
        await run();
      }
    );

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    expect(runtimePrompt).toContain("superpowers:brainstorming");
    expect(runtimePrompt).toContain("write only the GitHub issue comment body");
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      tokenUsage?: {
        artifactFile?: string;
        mode?: string;
        workflow?: { name?: string; role?: string; sourceIssueNumber?: number };
        auditPublication?: {
          target?: string;
          issueNumber?: number;
          section?: string;
          publishWhen?: string[];
        };
      };
    };
    expect(metadata.tokenUsage).toMatchObject({
      artifactFile: `.prs/runs/${createdRunDir}/codex-token-usage.json`,
      mode: "issue-token-usage-ledger",
      workflow: {
        name: "issue-refine",
        role: "planner",
        sourceIssueNumber: issueNumber,
      },
      auditPublication: {
        target: "issue",
        issueNumber,
        section: "token-usage",
        publishWhen: [
          "questions-posted",
          "published-artifacts",
          "refinement-complete",
        ],
      },
    });
    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/issues/${issueNumber}`) &&
        (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCall).toBeUndefined();
    const commentBodies = fetchMock.mock.calls
      .filter(
        ([input, init]) =>
          String(input).endsWith(`/issues/${issueNumber}/comments`) &&
          (init as RequestInit | undefined)?.method === "POST"
      )
      .map(
        ([, init]) => (JSON.parse(String((init as RequestInit).body)) as { body: string }).body
      );
    expect(commentBodies).toEqual([
      [
        "<!-- prs:issue-refinement-questions -->",
        "Before I write the spec and implementation plan, I need to pin down the intended order workflow.",
        "",
        "- Who can view and edit the extra order information?",
        "- Should it appear in confirmation emails, exports, reports, or admin screens?",
        "- Is this information required at checkout or optional?",
        "",
      ].join("\n"),
    ]);
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      completionMode: "questions-posted",
    });
  });

  it("adds Superpowers instructions to issue refine runs and publishes the plan artifact", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 155;
    let runtimePrompt = "";
    let outputLog = "";
    let runtimeMetadata:
      | {
          superpowers?: {
            enabled?: boolean;
            specFile?: string;
            planFile?: string;
          };
        }
      | undefined;
    createMockCodexSuperpowersHome();
    const postedComments: Array<{
      id: number;
      body: string;
      html_url: string;
      created_at: string;
      updated_at: string;
      user: { login: string; type: string };
    }> = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`) && init?.method === "PATCH") {
        return createFetchResponse({
          number: issueNumber,
          title: "Superpowers refine title",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Superpowers refine title",
          body: "<!-- prs:managed-issue -->\n\nOriginal managed issue body.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse(postedComments);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        const id = 9155 + postedComments.length;
        const comment = {
          id,
          body: body.body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-${id}`,
          created_at: "2026-04-26T09:35:00Z",
          updated_at: "2026-04-26T09:35:00Z",
          user: { login: "prs-bot", type: "Bot" },
        };
        postedComments.push(comment);
        return createFetchResponse(comment);
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
          },
        },
        null,
        2
      ),
      async () => {
        const { run } = await loadCli({
          readlineAnswers: ["y", "Make it implementation ready.", "y", "y", "y"],
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
              runtimeMetadata = JSON.parse(
                readFileSync(resolve(REPO_ROOT, metadata.runDir as string, "metadata.json"), "utf8")
              ) as typeof runtimeMetadata;
              outputLog = readFileSync(
                resolve(REPO_ROOT, metadata.outputLog as string),
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.draftFile as string),
                "# Superpowers refine title\n\n## Summary\nRefined body.\n",
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.runDir as string, "superpowers-spec.md"),
                "## Settled Specification\n\nRefined body.\n",
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.runDir as string, "superpowers-plan.md"),
                "## Refine Plan\n\n- Apply the refined work.\n",
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
        process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
        await run();
      }
    );

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    const expectedSpecFile = `.prs/runs/${createdRunDir}/superpowers-spec.md`;
    const expectedPlanFile = `.prs/runs/${createdRunDir}/superpowers-plan.md`;
    const finalOutputLog = readFileSync(
      resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "output.log"),
      "utf8"
    );

    expect(runtimePrompt).toContain("use `superpowers:brainstorming` first");
    expect(runtimePrompt).toContain("only use `superpowers:writing-plans`");
    expect(runtimePrompt).toContain(`Write the Superpowers spec artifact to \`${expectedSpecFile}\`.`);
    expect(runtimePrompt).toContain(`Write the Superpowers plan artifact to \`${expectedPlanFile}\`.`);
    expect(runtimePrompt).toContain("do not create `docs/superpowers/specs/");
    expect(runtimePrompt).toContain("do not create `docs/superpowers/plans/");
    expect(runtimeMetadata).toMatchObject({
      superpowers: {
        enabled: true,
        specFile: expectedSpecFile,
        planFile: expectedPlanFile,
      },
    });
    expect(outputLog).toContain(`Superpowers spec file: ${expectedSpecFile}`);
    expect(outputLog).toContain(`Superpowers plan file: ${expectedPlanFile}`);
    expect(finalOutputLog).toContain("Automatic estimate created:");

    const commentBodies = fetchMock.mock.calls
      .filter(
        ([input, init]) =>
          String(input).endsWith(`/issues/${issueNumber}/comments`) &&
          (init as RequestInit | undefined)?.method === "POST"
      )
      .map(
        ([, init]) => (JSON.parse(String((init as RequestInit).body)) as { body: string }).body
      );
    expect(commentBodies).toContain(
      "<!-- prs:issue-spec -->\n## Settled Specification\n\nRefined body.\n"
    );
    expect(commentBodies).toContain(
      "<!-- prs:issue-plan -->\n## Refine Plan\n\n- Apply the refined work.\n"
    );
    expect(
      commentBodies.some(
        (body) =>
          body.includes("<!-- prs:token-usage -->") &&
          body.includes("Codex token telemetry ledger")
      )
    ).toBe(true);
    expect(commentBodies).toContain(
      "<!-- prs:issue-refinement-complete -->\nRefinement is complete. The settled specification and implementation plan have been attached to this issue in managed comments, so development can start from those artifacts.\n"
    );
  });

  it("keeps Superpowers refinement artifacts on disk when spec approval is declined", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 159;
    const messages: string[] = [];
    createMockCodexSuperpowersHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`) && init?.method === "PATCH") {
        throw new Error("Issue refinement should not update GitHub before artifact approval.");
      }

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Review generated refinement artifacts",
          body: "<!-- prs:managed-issue -->\n\nOriginal managed issue body.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        throw new Error("Issue refinement should not publish comments before spec approval.");
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await withRepositoryConfig(
      JSON.stringify(
        {
          ai: {
            issue: {
              useCodexSuperpowers: true,
            },
          },
        },
        null,
        2
      ),
      async () => {
        const { run } = await loadCli({
          readlineAnswers: ["n", "y", "n"],
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
              writeFileSync(
                resolve(REPO_ROOT, metadata.draftFile as string),
                "# Review generated refinement artifacts\n\n## Summary\nRefined body.\n",
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.runDir as string, "superpowers-spec.md"),
                "## Settled Specification\n\nRefined spec content.\n",
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.runDir as string, "superpowers-plan.md"),
                "## Implementation Plan\n\n- Implement the refined behavior.\n",
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
        process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
        await run();
      }
    );

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    expect(messages.join("\n")).toContain(
      `Issue specification kept at .prs/runs/${createdRunDir}/superpowers-spec.md.`
    );
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      completionMode: "kept-on-disk",
    });
    const commentCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith(`/issues/${issueNumber}/comments`) &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(commentCalls).toHaveLength(0);
  });

  it("resumes the saved Codex issue refine session when it is still tracked", async () => {
    const issueNumber = 56;
    const sessionId = "019d5002-0000-7111-8222-933344445555";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const sessionStatePath = getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber);
    const existingRunDir = resolve(
      REPO_ROOT,
      ".prs",
      "runs",
      "20260424T110000000Z-issue-refine-56"
    );
    const existingRunDirName = "20260424T110000000Z-issue-refine-56";
    const existingDraftPath = resolve(existingRunDir, `issue-refine-${issueNumber}.md`);
    let runtimePrompt = "";

    writeMockCodexSession(codexHome, sessionId, REPO_ROOT, "2026-04-24T11:00:00.000Z");
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(existingRunDir);
    mkdirSync(existingRunDir, { recursive: true });
    writeFileSync(resolve(existingRunDir, "prompt.md"), "Saved prompt for resumable refine.\n", "utf8");
    writeFileSync(resolve(existingRunDir, "output.log"), "# saved refine log\n", "utf8");
    writeFileSync(
      resolve(existingRunDir, "metadata.json"),
      `${JSON.stringify(
        {
          flow: "issue-refine",
          issueNumber,
          draftFile: `.prs/runs/${existingRunDirName}/issue-refine-${issueNumber}.md`,
          promptFile: `.prs/runs/${existingRunDirName}/prompt.md`,
          outputLog: `.prs/runs/${existingRunDirName}/output.log`,
          runDir: `.prs/runs/${existingRunDirName}`,
          runtime: {
            type: "codex",
            invocation: "new",
            sessionId,
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    writeIssueRefineSessionState(REPO_ROOT, {
      issueNumber,
      runtimeType: "codex",
      runDir: existingRunDir,
      promptFile: resolve(existingRunDir, "prompt.md"),
      outputLog: resolve(existingRunDir, "output.log"),
      latestDraftFile: resolve(existingRunDir, `issue-refine-${issueNumber}.md`),
      sessionId,
      createdAt: "2026-04-24T11:00:00.000Z",
      updatedAt: "2026-04-24T11:00:00.000Z",
    });
    const beforeRuns = listRunDirectories();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Resume issue refine session",
          body: "<!-- prs:managed-issue -->\n\nOriginal managed issue body.",
          html_url: getRepositoryIssueUrl(issueNumber),
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["n"],
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

        if (command === "codex" && args[0] === "resume" && args[1] === sessionId) {
          runtimePrompt = readFileSync(resolve(existingRunDir, "prompt.md"), "utf8");
          writeFileSync(
            existingDraftPath,
            "# Resume issue refine session\n\n## Summary\nRefined draft after resume.\n",
            "utf8"
          );
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeUndefined();

    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", sessionId, "--sandbox", "workspace-write"]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
    expect(JSON.parse(readFileSync(sessionStatePath, "utf8"))).toMatchObject({
      issueNumber,
      runtimeType: "codex",
      sessionId,
      runDir: existingRunDir,
      promptFile: resolve(existingRunDir, "prompt.md"),
      outputLog: resolve(existingRunDir, "output.log"),
      latestDraftFile: existingDraftPath,
    });
    const metadata = JSON.parse(
      readFileSync(resolve(existingRunDir, "metadata.json"), "utf8")
    ) as {
      requestedChanges?: string;
      runtime?: {
        invocation?: string;
        sessionId?: string;
      };
    };
    expect(metadata.requestedChanges).toBeUndefined();
    expect(metadata.runtime).toMatchObject({
      invocation: "resume",
      sessionId,
    });
    expect(runtimePrompt).not.toContain("What changes should be made to the original requirements?");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("warns and starts a fresh Codex refine session when the saved session is stale", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 57;
    const staleSessionId = "019d5003-0000-7111-8222-933344445555";
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const existingRunDir = resolve(
      REPO_ROOT,
      ".prs",
      "runs",
      "20260424T113000000Z-issue-refine-57"
    );
    let runtimePrompt = "";

    createMockCodexHome();
    cleanupTargets.add(sessionStateDir);
    writeIssueRefineSessionState(REPO_ROOT, {
      issueNumber,
      runtimeType: "codex",
      runDir: existingRunDir,
      promptFile: resolve(existingRunDir, "prompt.md"),
      outputLog: resolve(existingRunDir, "output.log"),
      latestDraftFile: resolve(existingRunDir, `issue-refine-${issueNumber}.md`),
      sessionId: staleSessionId,
      createdAt: "2026-04-24T11:30:00.000Z",
      updatedAt: "2026-04-24T11:30:00.000Z",
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Refresh stale refine session",
          body: "<!-- prs:managed-issue -->\n\nOriginal managed issue body.",
          html_url: getRepositoryIssueUrl(issueNumber),
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const messages: string[] = [];
    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["y", "Tighten rollout notes.", "n"],
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

        if (command === "codex" && args[0] === "--sandbox") {
          const { metadata, runDir } = readLatestRunMetadata();
          runtimePrompt = readFileSync(resolve(REPO_ROOT, metadata.promptFile as string), "utf8");
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Refresh stale refine session\n\n## Summary\nStarted fresh after stale session.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const staleSessionWarning =
      `Saved Codex refine session ${staleSessionId} for issue #${issueNumber} is no longer available. Starting a fresh refinement session.`;
    expect(messages.join("\n")).toContain(staleSessionWarning);
    expect(runtimePrompt).toContain("What changes should be made to the original requirements?");
    expect(runtimePrompt).toContain("Tighten rollout notes.");
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      runtime?: {
        warnings?: string[];
      };
      outputLog?: string;
    };
    expect(metadata.runtime?.warnings).toContain(staleSessionWarning);
    expect(
      readFileSync(resolve(REPO_ROOT, metadata.outputLog as string), "utf8")
    ).toContain(staleSessionWarning);
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", staleSessionId]),
      expect.any(Object)
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining([
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        "--cd",
        REPO_ROOT,
      ]),
      expect.objectContaining({
        cwd: REPO_ROOT,
        stdio: "inherit",
      })
    );
  });

  it("warns and starts a fresh refine session when the configured runtime changed", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 58;
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const existingRunDir = resolve(
      REPO_ROOT,
      ".prs",
      "runs",
      "20260424T114500000Z-issue-refine-58"
    );

    cleanupTargets.add(sessionStateDir);
    writeIssueRefineSessionState(REPO_ROOT, {
      issueNumber,
      runtimeType: "codex",
      runDir: existingRunDir,
      promptFile: resolve(existingRunDir, "prompt.md"),
      outputLog: resolve(existingRunDir, "output.log"),
      latestDraftFile: resolve(existingRunDir, `issue-refine-${issueNumber}.md`),
      sessionId: "019d5004-0000-7111-8222-933344445555",
      createdAt: "2026-04-24T11:45:00.000Z",
      updatedAt: "2026-04-24T11:45:00.000Z",
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Switch refine runtime",
          body: "<!-- prs:managed-issue -->\n\nOriginal managed issue body.",
          html_url: getRepositoryIssueUrl(issueNumber),
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const messages: string[] = [];
    await withRepositoryConfig(
      JSON.stringify(
        {
          ai: {
            runtime: {
              type: "claude-code",
            },
          },
        },
        null,
        2
      ),
      async () => {
        const { run, spawnSync } = await loadCli({
          readlineAnswers: ["y", "Use Claude Code for this refinement.", "n"],
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

            if (command === "claude" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "claude") {
              const { metadata, runDir } = readLatestRunMetadata();
              writeFileSync(
                resolve(REPO_ROOT, metadata.draftFile as string),
                "# Switch refine runtime\n\n## Summary\nFresh Claude Code refinement.\n",
                "utf8"
              );
              cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
              return { status: 0 };
            }

            throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
          },
        });
        vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
          messages.push(String(message ?? ""));
        });

        process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
        await run();

        expect(spawnSync).toHaveBeenCalledWith(
          "claude",
          expect.any(Array),
          expect.objectContaining({
            cwd: REPO_ROOT,
            stdio: "inherit",
          })
        );
      }
    );

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const runtimeMismatchWarning =
      "The saved issue-refine session used Codex, but the configured runtime is Claude Code. Starting a fresh refinement session.";
    expect(messages.join("\n")).toContain(runtimeMismatchWarning);
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      runtime?: {
        warnings?: string[];
      };
      outputLog?: string;
    };
    expect(metadata.runtime?.warnings).toContain(runtimeMismatchWarning);
    expect(
      readFileSync(resolve(REPO_ROOT, metadata.outputLog as string), "utf8")
    ).toContain(runtimeMismatchWarning);
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      issueNumber,
      runtimeType: "claude-code",
      runDir: resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string),
    });
  });

  it("publishes artifacts for an existing PRS-managed issue without changing the issue body", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 59;
    createMockCodexHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`) && init?.method === "PATCH") {
        throw new Error("Issue refinement should not update the issue body.");
      }

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Managed refine title",
          body: "<!-- prs:managed-issue -->\n\n## Summary\nOriginal managed issue body.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        return createFetchResponse({
          id: 9059,
          body: body.body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9059`,
          updated_at: "2026-04-26T09:35:00Z",
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.env.OPENAI_API_KEY = "test-key";

    const { run } = await loadCli({
      readlineAnswers: ["y", "Expand the acceptance criteria.", "y"],
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
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Managed refine title\n\n## Summary\nRefined managed issue body.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/issues/${issueNumber}`) &&
        (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCall).toBeUndefined();
    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      tokenUsage?: {
        artifactFile?: string;
        mode?: string;
        workflow?: { name?: string; role?: string; sourceIssueNumber?: number };
        auditPublication?: {
          target?: string;
          issueNumber?: number;
          section?: string;
          publishWhen?: string[];
        };
      };
    };
    expect(metadata.tokenUsage).toMatchObject({
      artifactFile: `.prs/runs/${createdRunDir}/codex-token-usage.json`,
      mode: "issue-token-usage-ledger",
      workflow: {
        name: "issue-refine",
        role: "planner",
        sourceIssueNumber: issueNumber,
      },
      auditPublication: {
        target: "issue",
        issueNumber,
        section: "token-usage",
        publishWhen: [
          "questions-posted",
          "published-artifacts",
          "refinement-complete",
        ],
      },
    });
    const commentBodies = fetchMock.mock.calls
      .filter(
        ([input, init]) =>
          String(input).endsWith(`/issues/${issueNumber}/comments`) &&
          (init as RequestInit | undefined)?.method === "POST"
      )
      .map(
        ([, init]) => (JSON.parse(String((init as RequestInit).body)) as { body: string }).body
      );
    expect(commentBodies[0]).toContain("<!-- prs:issue-spec -->");
    expect(commentBodies[0]).toContain("Refined managed issue body.");
    expect(commentBodies[1]).toContain("<!-- prs:issue-plan -->");
    expect(commentBodies[2]).toContain("<!-- prs:issue-refinement-complete -->");
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      completionMode: "published-artifacts",
      completedIssueNumber: issueNumber,
      completedIssueUrl: getRepositoryIssueUrl(issueNumber),
    });
  });

  it("does not add the PRS-managed issue marker to a non-managed issue body", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 63;
    createMockCodexHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`) && init?.method === "PATCH") {
        throw new Error("Issue refinement should not update the issue body.");
      }

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Customer report about marker text",
          body:
            "The docs literally mention <!-- prs:managed-issue --> in one example, but this source issue is not PRS-managed.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        return createFetchResponse({
          id: 9063,
          body: body.body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9063`,
          updated_at: "2026-04-26T09:35:00Z",
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.env.OPENAI_API_KEY = "test-key";

    const { run } = await loadCli({
      readlineAnswers: ["y", "Turn it into an implementation-ready spec.", "y"],
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
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Customer report about marker text refined\n\n## Summary\nDedicated managed issue body.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/issues/${issueNumber}`) &&
        (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCall).toBeUndefined();

    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/issues") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(createCall).toBeUndefined();
  });

  it("publishes non-managed issue refinement artifacts on the original issue", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 60;
    createMockCodexHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith(`/issues/${issueNumber}`) && init?.method === "PATCH") {
        throw new Error("Issue refinement should not update the issue body.");
      }

      if (url.endsWith(`/issues/${issueNumber}`)) {
        return createFetchResponse({
          title: "Customer request",
          body: "Plain issue body from GitHub.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith("/issues?state=open&per_page=100")) {
        throw new Error("Issue refine should not search for reusable same-title issues.");
      }

      if (url.endsWith(`/issues/${issueNumber}/comments`) && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        return createFetchResponse({
          id: 9060,
          body: body.body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${issueNumber}#issuecomment-9060`,
          updated_at: "2026-04-26T09:35:00Z",
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.env.OPENAI_API_KEY = "test-key";

    const { run } = await loadCli({
      readlineAnswers: ["y", "Turn it into an implementation-ready spec.", "y"],
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
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Customer request refined\n\n## Summary\nRefined linked issue body.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    const patchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/issues/${issueNumber}`) &&
        (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCall).toBeUndefined();

    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/issues") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(createCall).toBeUndefined();
    const commentBodies = fetchMock.mock.calls
      .filter(
        ([input, init]) =>
          String(input).endsWith(`/issues/${issueNumber}/comments`) &&
          (init as RequestInit | undefined)?.method === "POST"
      )
      .map(
        ([, init]) => (JSON.parse(String((init as RequestInit).body)) as { body: string }).body
      );
    expect(commentBodies[0]).toContain("<!-- prs:issue-spec -->");
    expect(commentBodies[0]).toContain("Refined linked issue body.");
    expect(commentBodies[1]).toContain("<!-- prs:issue-plan -->");
    expect(commentBodies[2]).toContain("<!-- prs:issue-refinement-complete -->");
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      completionMode: "published-artifacts",
      completedIssueNumber: issueNumber,
      completedIssueUrl: getRepositoryIssueUrl(issueNumber),
    });
  });

  it("keeps generated issue sets on disk instead of creating linked issues during refinement", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 66;
    createMockCodexHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;

      if (url.endsWith(`/issues/${issueNumber}`) && method !== "PATCH") {
        return createFetchResponse({
          title: "Split customer request",
          body: "Plain source issue body.",
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.includes(`/issues/${issueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith("/issues") && method === "POST") {
        throw new Error("Issue refinement should not create linked issues.");
      }

      if (url.endsWith("/issues/301") && method === "PATCH") {
        throw new Error("Issue refinement should not update linked issues.");
      }

      if (url.endsWith("/issues/302") && method === "PATCH") {
        throw new Error("Issue refinement should not update linked issues.");
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const messages: string[] = [];
    const { run } = await loadCli({
      readlineAnswers: ["n"],
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
          const runDirPath = resolve(REPO_ROOT, metadata.runDir as string);
          writeFileSync(
            resolve(runDirPath, "contract.md"),
            "# Refine Contract Work\n\n## Summary\nCreate the manifest contract.\n",
            "utf8"
          );
          writeFileSync(
            resolve(runDirPath, "cli.md"),
            "# Refine CLI Work\n\n## Summary\nApply linked issue sets.\n",
            "utf8"
          );
          writeFileSync(
            resolve(REPO_ROOT, metadata.issueSetFile as string),
            `${JSON.stringify({
              version: 1,
              mode: "multiple",
              linkingStrategy: "Split the source request into implementation units.",
              sourceIssueNumber: issueNumber,
              issues: [
                {
                  id: "contract",
                  draftFile: `.prs/runs/${runDir}/contract.md`,
                  blocks: ["cli"],
                },
                {
                  id: "cli",
                  draftFile: `.prs/runs/${runDir}/cli.md`,
                  dependsOn: ["contract"],
                },
              ],
            })}\n`,
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    const sourcePatchCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/issues/${issueNumber}`) &&
        (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(sourcePatchCall).toBeUndefined();

    const createIssueCalls = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input).endsWith("/issues") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(createIssueCalls).toHaveLength(0);
    expect(messages.join("\n")).toContain(
      "Issue refinement no longer creates linked issues."
    );
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      completionMode: "kept-on-disk",
    });
  });

  it("starts a fresh refine run after a completed refine state instead of resuming", async () => {
    const issueNumber = 62;
    const sessionId = "019d5005-0000-7111-8222-933344445555";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const existingRunDir = resolve(
      REPO_ROOT,
      ".prs",
      "runs",
      "20260424T120000000Z-issue-refine-62"
    );
    const existingRunDirName = "20260424T120000000Z-issue-refine-62";
    let runtimePrompt = "";

    writeMockCodexSession(codexHome, sessionId, REPO_ROOT, "2026-04-24T12:00:00.000Z");
    cleanupTargets.add(sessionStateDir);
    cleanupTargets.add(existingRunDir);
    mkdirSync(existingRunDir, { recursive: true });
    writeIssueRefineSessionState(REPO_ROOT, {
      issueNumber,
      runtimeType: "codex",
      runDir: existingRunDir,
      promptFile: resolve(existingRunDir, "prompt.md"),
      outputLog: resolve(existingRunDir, "output.log"),
      latestDraftFile: resolve(existingRunDir, `issue-refine-${issueNumber}.md`),
      sessionId,
      completionMode: "kept-on-disk",
      createdAt: "2026-04-24T12:00:00.000Z",
      updatedAt: "2026-04-24T12:00:00.000Z",
    });
    const beforeRuns = listRunDirectories();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Completed refine rerun",
          body: "<!-- prs:managed-issue -->\n\nOriginal managed issue body.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["y", "Start a new refinement after completion.", "n"],
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

        if (command === "codex" && args[0] === "--sandbox") {
          const { metadata, runDir } = readLatestRunMetadata();
          runtimePrompt = readFileSync(resolve(REPO_ROOT, metadata.promptFile as string), "utf8");
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Completed refine rerun\n\n## Summary\nFresh rerun after completion.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    expect(createdRunDir).not.toBe(existingRunDirName);
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(runtimePrompt).toContain("What changes should be made to the original requirements?");
    expect(runtimePrompt).toContain("Start a new refinement after completion.");
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", sessionId]),
      expect.any(Object)
    );
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      runDir: resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string),
      createdAt: expect.not.stringMatching(/^2026-04-24T12:00:00.000Z$/),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("warns and starts a fresh refine session when the saved resumable workspace artifacts are missing", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 64;
    const sessionId = "019d5006-0000-7111-8222-933344445555";
    const codexHome = createMockCodexHome();
    const sessionStateDir = resolve(REPO_ROOT, ".prs", "issues", String(issueNumber));
    const missingRunDir = resolve(
      REPO_ROOT,
      ".prs",
      "runs",
      "20260424T121500000Z-issue-refine-64"
    );
    let runtimePrompt = "";

    writeMockCodexSession(codexHome, sessionId, REPO_ROOT, "2026-04-24T12:15:00.000Z");
    cleanupTargets.add(sessionStateDir);
    writeIssueRefineSessionState(REPO_ROOT, {
      issueNumber,
      runtimeType: "codex",
      runDir: missingRunDir,
      promptFile: resolve(missingRunDir, "prompt.md"),
      outputLog: resolve(missingRunDir, "output.log"),
      latestDraftFile: resolve(missingRunDir, `issue-refine-${issueNumber}.md`),
      sessionId,
      createdAt: "2026-04-24T12:15:00.000Z",
      updatedAt: "2026-04-24T12:15:00.000Z",
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Resume with missing artifacts",
          body: "<!-- prs:managed-issue -->\n\nOriginal managed issue body.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const messages: string[] = [];
    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["y", "Restart from a clean workspace.", "n"],
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

        if (command === "codex" && args[0] === "--sandbox") {
          const { metadata, runDir } = readLatestRunMetadata();
          runtimePrompt = readFileSync(resolve(REPO_ROOT, metadata.promptFile as string), "utf8");
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Resume with missing artifacts\n\n## Summary\nFresh refinement after missing workspace artifacts.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(messages.join("\n")).toContain(
      `Saved issue-refine workspace artifacts for issue #${issueNumber} are missing. Starting a fresh refinement session.`
    );
    expect(runtimePrompt).toContain("What changes should be made to the original requirements?");
    expect(runtimePrompt).toContain("Restart from a clean workspace.");
    expect(spawnSync).not.toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["resume", sessionId]),
      expect.any(Object)
    );
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      runDir: resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string),
      createdAt: expect.not.stringMatching(/^2026-04-24T12:15:00.000Z$/),
    });
  });

  it("keeps non-managed issue refinements on disk when linked issue creation is declined", async () => {
    const beforeRuns = listRunDirectories();
    const issueNumber = 61;
    createMockCodexHome();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Keep linked refine draft on disk",
          body: "Plain issue body from GitHub.",
          html_url: `https://github.com/DevwareUK/prs/issues/${issueNumber}`,
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const messages: string[] = [];
    const { run } = await loadCli({
      readlineAnswers: ["y", "Draft a linked refinement without publishing it.", "n"],
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
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Keep linked refine draft on disk\n\n## Summary\nRefined linked draft kept on disk.\n",
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    process.argv = ["node", "prs", "issue", "refine", String(issueNumber)];
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", String(issueNumber)));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(messages.join("\n")).toContain(
      `.prs/runs/${createdRunDir}/issue-refine-${issueNumber}.md`
    );
    expect(
      JSON.parse(
        readFileSync(getIssueRefineSessionStateFilePath(REPO_ROOT, issueNumber), "utf8")
      )
    ).toMatchObject({
      completionMode: "kept-on-disk",
    });
  });

  it("does not print a launch-stage notice for primary-offer test-backlog runs", async () => {
    const { run } = await loadCli({
      analysisResult: createTestBacklogAnalysis(),
    });

    process.argv = ["node", "prs", "test-backlog", "--format", "json"];

    const stdout = captureStdout();
    await run();

    const output = stdout.output();
    expect(output).not.toContain("WORKFLOW NOTICE");
    expect(output).toContain('"summary"');
  });

});
