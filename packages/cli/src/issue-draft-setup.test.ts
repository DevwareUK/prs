import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  REPO_ROOT,
  cleanupTargets,
  getRepositoryIssueUrl,
  createFetchResponse,
  captureStdout,
  listIssueDraftFiles,
  listRunDirectories,
  readLatestRunMetadata,
  createMockCodexHome,
  createMockCodexSuperpowersHome,
  withRepositoryConfig,
  loadCli,
} from "./index-test-support";

describe("Issue draft and setup workflows", () => {
  it("runs setup with repo-aware defaults without creating AGENTS guidance by default", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-setup-node-"));
    cleanupTargets.add(repoRoot);
    createMockCodexHome();
    mkdirSync(resolve(repoRoot, ".github", "workflows"), { recursive: true });
    mkdirSync(resolve(repoRoot, "coverage"), { recursive: true });
    writeFileSync(resolve(repoRoot, "package.json"), JSON.stringify({
      name: "fixture-node-repo",
      scripts: {
        build: "tsup",
        test: "vitest",
      },
    }, null, 2));
    writeFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "");
    writeFileSync(resolve(repoRoot, "tsconfig.json"), "{}\n");
    writeFileSync(resolve(repoRoot, ".gitignore"), "node_modules/\n");

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      readlineAnswers: ["", "", "", "", ""],
      execFileSyncImpl: (command, args) => {
        if (
          command === "git" &&
          args[0] === "symbolic-ref" &&
          args[1] === "refs/remotes/origin/HEAD"
        ) {
          return "refs/remotes/origin/main\n";
        }

        if (
          command === "git" &&
          args[0] === "remote" &&
          args[1] === "get-url" &&
          args[2] === "origin"
        ) {
          return "git@github.com:acme/fixture-node-repo.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "claude" && args[0] === "--version") {
          return { status: 1, error: new Error("claude unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "setup"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });

    await run();

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toEqual({
      ai: {
        issue: {
          useCodexSuperpowers: false,
        },
        runtime: {
          type: "codex",
        },
      },
      aiContext: {
        excludePaths: ["**/coverage/**"],
      },
      baseBranch: "main",
      buildCommand: ["pnpm", "build"],
      forge: {
        type: "github",
      },
      githubActions: {
        workflows: {
          "pr-assistant": {
            enabled: true,
          },
          "pr-review": {
            enabled: true,
          },
          "test-suggestions": {
            enabled: true,
          },
        },
      },
    });
    expect(readFileSync(resolve(repoRoot, ".gitignore"), "utf8")).toBe("node_modules/\n");
    expect(readFileSync(resolve(repoRoot, ".prs", ".gitignore"), "utf8")).toBe(
      ["runs/", "issues/", "worktrees/", "batches/", ""].join("\n")
    );
    expect(
      readFileSync(resolve(repoRoot, ".github", "workflows", "prs-pr-review.yml"), "utf8")
    ).toContain("DevwareUK/prs/actions/pr-review@main");

    expect(existsSync(resolve(repoRoot, "AGENTS.md"))).toBe(false);
    expect(messages.join("\n")).toContain("Next step: create `.env`");
    expect(messages.join("\n")).toContain("OPENAI_API_KEY` repository secret");
  });

  it("updates an existing AGENTS managed section during setup and keeps manual guidance", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-setup-drupal-"));
    cleanupTargets.add(repoRoot);
    createMockCodexHome();
    mkdirSync(resolve(repoRoot, "web", "themes", "custom", "site", "css"), {
      recursive: true,
    });
    mkdirSync(resolve(repoRoot, "web", "themes", "custom", "site", "js"), {
      recursive: true,
    });
    mkdirSync(resolve(repoRoot, "web", "sites", "default", "files"), {
      recursive: true,
    });
    writeFileSync(resolve(repoRoot, "composer.json"), JSON.stringify({
      name: "acme/drupal-site",
      scripts: {
        test: ["phpunit"],
      },
    }, null, 2));
    writeFileSync(resolve(repoRoot, ".gitignore"), ".prs/\n");
    writeFileSync(
      resolve(repoRoot, "AGENTS.md"),
      [
        "# Repository Notes",
        "",
        "Keep this manual guidance.",
        "",
        "<!-- prs:setup:start -->",
        "Old managed setup guidance.",
        "<!-- prs:setup:end -->",
        "",
      ].join("\n")
    );

    const { run } = await loadCli({
      runtimeRepoRoot: repoRoot,
      readlineAnswers: ["n", "develop", "none", "codex", "", "", "n", "y"],
      execFileSyncImpl: (command, args) => {
        if (
          command === "git" &&
          args[0] === "symbolic-ref" &&
          args[1] === "refs/remotes/origin/HEAD"
        ) {
          return "refs/remotes/origin/main\n";
        }

        if (
          command === "git" &&
          args[0] === "remote" &&
          args[1] === "get-url" &&
          args[2] === "origin"
        ) {
          return "git@gitlab.com:acme/drupal-site.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "claude" && args[0] === "--version") {
          return { status: 1, error: new Error("claude unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "setup"];
    await run();

    expect(
      JSON.parse(readFileSync(resolve(repoRoot, ".prs", "config.json"), "utf8"))
    ).toEqual({
      ai: {
        issue: {
          useCodexSuperpowers: false,
        },
        runtime: {
          type: "codex",
        },
      },
      aiContext: {
        excludePaths: [
          "web/sites/default/files/**",
          "web/themes/**/css/**",
          "web/themes/**/js/**",
        ],
      },
      baseBranch: "develop",
      buildCommand: ["composer", "test"],
      forge: {
        type: "none",
      },
    });

    const gitignoreContent = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
    expect(gitignoreContent.match(/\.prs\//g) ?? []).toHaveLength(1);

    const agentsContent = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsContent).toContain("# Repository Notes");
    expect(agentsContent).toContain("Keep this manual guidance.");
    expect(agentsContent).not.toContain("Old managed setup guidance.");
    expect(agentsContent).toContain("## Repository guidance for agents");
    expect(agentsContent).toContain("Protected paths or files:");
    expect(agentsContent).not.toContain("Detected stack:");
    expect(agentsContent).not.toContain("`composer test`");
  });

  it("ingests a skill-produced issue draft without launching a runtime", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const inputDir = mkdtempSync(resolve(tmpdir(), "prs-skill-draft-"));
    cleanupTargets.add(inputDir);
    const draftInputPath = resolve(inputDir, "draft.md");
    const roughIdeaPath = resolve(inputDir, "rough-idea.md");
    const contextPath = resolve(inputDir, "context.md");
    writeFileSync(
      draftInputPath,
      "# Preserve caller context for issue drafts\n\n## Summary\nSave the active Codex skill's completed draft without opening another AI session.\n",
      "utf8"
    );
    writeFileSync(
      roughIdeaPath,
      "The current Codex thread already has the project context and completed draft.",
      "utf8"
    );
    writeFileSync(
      contextPath,
      "Caller context: screenshots, previous replies, and the active checkout should stay attached.",
      "utf8"
    );

    const { run, spawnSync } = await loadCli({
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = [
      "node",
      "prs",
      "issue",
      "draft",
      "--draft-file",
      draftInputPath,
      "--rough-idea-file",
      roughIdeaPath,
      "--context-file",
      contextPath,
    ];
    const stdout = captureStdout();
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      draftProducer?: string;
      featureIdea?: string;
      caller?: {
        context?: { source?: string; content?: string }[];
      };
      runtime?: unknown;
    };
    expect(metadata).toMatchObject({
      draftProducer: "caller",
      featureIdea:
        "The current Codex thread already has the project context and completed draft.",
      caller: {
        context: [
          {
            source: contextPath,
            content:
              "Caller context: screenshots, previous replies, and the active checkout should stay attached.",
          },
        ],
      },
    });
    expect(metadata.runtime).toBeUndefined();

    const prompt = readFileSync(
      resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "prompt.md"),
      "utf8"
    );
    expect(prompt).toContain("active prs:create skill");
    expect(prompt).toContain("The current Codex thread already has the project context");
    expect(prompt).toContain("Caller context: screenshots");

    expect(stdout.output()).toContain("Generated issue draft");
    expect(stdout.output()).toContain("# Preserve caller context for issue drafts");
    expect(spawnSync.mock.calls.some(([command]) => command === "codex")).toBe(false);
  });

  it("ingests a skill-produced issue set without launching a runtime", async () => {
    const beforeRuns = listRunDirectories();
    const inputDir = mkdtempSync(resolve(tmpdir(), "prs-skill-issue-set-"));
    cleanupTargets.add(inputDir);
    writeFileSync(
      resolve(inputDir, "contract.md"),
      "# Add Issue Set Contract\n\n## Summary\nDefine the manifest contract.\n",
      "utf8"
    );
    writeFileSync(
      resolve(inputDir, "cli.md"),
      "# Apply Issue Set Manifest\n\n## Summary\nCreate linked issues from manifests.\n",
      "utf8"
    );
    const issueSetPath = resolve(inputDir, "issue-set.json");
    writeFileSync(
      issueSetPath,
      `${JSON.stringify(
        {
          version: 1,
          mode: "multiple",
          linkingStrategy: "Split manifest contracts from CLI apply behavior.",
          issues: [
            { id: "contract", draftFile: "contract.md", blocks: ["cli"] },
            { id: "cli", draftFile: "cli.md", dependsOn: ["contract"] },
          ],
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const { run, spawnSync } = await loadCli({
      spawnSyncImpl: (command, args) => {
        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "draft", "--issue-set-file", issueSetPath];
    const stdout = captureStdout();
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const ingestedManifest = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "issue-set.json"),
        "utf8"
      )
    ) as { issues: { draftFile: string }[] };
    expect(ingestedManifest.issues).toHaveLength(2);
    for (const issue of ingestedManifest.issues) {
      expect(issue.draftFile).toContain(`.prs/runs/${createdRunDir}/`);
    }
    expect(stdout.output()).toContain("Generated issue draft set");
    expect(stdout.output()).toContain("Add Issue Set Contract");
    expect(spawnSync.mock.calls.some(([command]) => command === "codex")).toBe(false);
  });

  it("requires issue draft to receive a skill-produced draft or explicit runtime opt-in", async () => {
    process.env.GIT_AI_DISABLE_AUTO_RUN = "1";
    const { parseIssueCommandArgs } = await loadCli();

    expect(() => parseIssueCommandArgs(["issue", "draft"])).toThrow(
      /Pass --draft-file <path>/
    );
  });

  it("launches the explicit issue draft runtime workflow and saves the draft under .prs/issues", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    let runtimePrompt = "";
    createMockCodexHome();

    const { run } = await loadCli({
      readlineAnswers: [
        "Combine PR description and review summary into a single PR assistant action.",
      ],
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          runtimePrompt = readFileSync(
            resolve(REPO_ROOT, metadata.promptFile as string),
            "utf8"
          );
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            [
              "# Merge PR description and review summary into one PR assistant action",
              "",
              "## Summary",
              "Draft a single implementation path for combining the repository's PR description and review summary generation flows.",
              "",
              "## Requirements",
              "- Reuse the existing PR assistant and body-merging patterns where possible.",
              "- Preserve manual pull request body content outside the managed section.",
              "",
              "## Acceptance criteria",
              "- Running the action updates a single managed PR assistant section.",
              "- Existing non-managed PR body content is preserved.",
              "",
            ].join("\n"),
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command.startsWith("vim ")) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "draft", "--runtime"];
    await run();

    expect(runtimePrompt).toContain(
      "Combine PR description and review summary into a single PR assistant action."
    );
    expect(runtimePrompt).toContain("ask the user targeted clarifying questions");
    expect(runtimePrompt).toContain(
      "avoid asking questions that are already answerable from the codebase"
    );
    expect(runtimePrompt).toContain("Write the final Markdown issue draft");
    expect(runtimePrompt).toContain("write an issue-set manifest");

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      flow: string;
      featureIdea: string;
      draftFile: string;
      issueSetFile: string;
      promptFile: string;
      runDir: string;
      runtime?: {
        type: string;
      };
    };
    expect(metadata).toMatchObject({
      flow: "issue-draft",
      featureIdea:
        "Combine PR description and review summary into a single PR assistant action.",
      draftFile: `.prs/issues/${createdDraft}`,
      issueSetFile: `.prs/runs/${createdRunDir}/issue-set.json`,
      promptFile: `.prs/runs/${createdRunDir}/prompt.md`,
      runDir: `.prs/runs/${createdRunDir}`,
      runtime: {
        type: "codex",
      },
    });

    const content = readFileSync(
      resolve(REPO_ROOT, ".prs", "issues", createdDraft as string),
      "utf8"
    );
    expect(content).toContain("# Merge PR description and review summary into one PR assistant action");
    expect(content).toContain("## Acceptance criteria");
  });

  it("uses the configured Claude Code runtime for issue draft workflows", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    let runtimePrompt = "";
    createMockCodexHome();

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
        const { run } = await loadCli({
          readlineAnswers: ["Draft the Claude Code runtime support issue."],
          spawnSyncImpl: (command, args) => {
            if (command === "claude" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "claude") {
              const { metadata } = readLatestRunMetadata();
              runtimePrompt = readFileSync(
                resolve(REPO_ROOT, metadata.promptFile as string),
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.draftFile as string),
                "# Add Claude Code runtime support\n\n## Summary\nLaunch Claude Code for local issue drafting.\n",
                "utf8"
              );
              return { status: 0 };
            }

            if (command === "gh" && args[0] === "--version") {
              return { status: 1, error: new Error("gh is unavailable") };
            }

            throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
          },
        });

        process.argv = ["node", "prs", "issue", "draft", "--runtime"];
        await run();
      }
    );

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(runtimePrompt).toContain("Draft the Claude Code runtime support issue.");

    const metadata = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "metadata.json"),
        "utf8"
      )
    ) as {
      runtime?: {
        type?: string;
        command?: string;
      };
    };
    expect(metadata).toMatchObject({
      runtime: {
        type: "claude-code",
        command: "claude",
      },
    });
  });

  it("requires the codex CLI for issue draft workflows", async () => {
    createMockCodexHome();
    const { run } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs."],
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 1, error: new Error("codex is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "draft", "--runtime"];

    await expect(run()).rejects.toThrow(
      'Configured runtime "Codex" is unavailable because the `codex` CLI is not available on PATH. Install the missing dependency before running interactive prs workflows.'
    );
  });

  it("adds Superpowers-specific instructions to the Codex draft prompt when enabled", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    let runtimePrompt = "";
    let runtimeMetadata:
      | {
          superpowers?: {
            enabled?: boolean;
            specFile?: string;
            planFile?: string;
          };
        }
      | undefined;
    let outputLog = "";
    const codexHome = createMockCodexHome();
    const pluginRoot = resolve(
      codexHome,
      "plugins",
      "cache",
      "openai-curated",
      "superpowers",
      "test-version"
    );
    mkdirSync(resolve(pluginRoot, "skills", "brainstorming"), { recursive: true });
    mkdirSync(resolve(pluginRoot, "skills", "writing-plans"), { recursive: true });
    writeFileSync(resolve(pluginRoot, "skills", "brainstorming", "SKILL.md"), "# test\n");
    writeFileSync(resolve(pluginRoot, "skills", "writing-plans", "SKILL.md"), "# test\n");

    await withRepositoryConfig(
      JSON.stringify(
        {
          ai: {
            issueDraft: {
              useCodexSuperpowers: true,
            },
          },
        },
        null,
        2
      ),
      async () => {
        const { run } = await loadCli({
          readlineAnswers: ["Add an optional Superpowers-backed Codex mode."],
          spawnSyncImpl: (command, args) => {
            if (command === "codex" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "codex") {
              const { metadata } = readLatestRunMetadata();
              runtimePrompt = readFileSync(
                resolve(REPO_ROOT, metadata.promptFile as string),
                "utf8"
              );
              runtimeMetadata = JSON.parse(
                readFileSync(resolve(REPO_ROOT, metadata.runDir as string, "metadata.json"), "utf8")
              ) as {
                superpowers?: {
                  enabled?: boolean;
                  specFile?: string;
                  planFile?: string;
                };
              };
              outputLog = readFileSync(
                resolve(REPO_ROOT, metadata.outputLog as string),
                "utf8"
              );
              writeFileSync(resolve(REPO_ROOT, metadata.draftFile as string), "# Draft\n", "utf8");
              return { status: 0 };
            }

            if (command === "gh" && args[0] === "--version") {
              return { status: 1, error: new Error("gh is unavailable") };
            }

            throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
          },
        });

        process.argv = ["node", "prs", "issue", "draft", "--runtime"];
        await run();
      }
    );

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const expectedSpecFile = `.prs/runs/${createdRunDir}/superpowers-spec.md`;
    const expectedPlanFile = `.prs/runs/${createdRunDir}/superpowers-plan.md`;

    expect(runtimePrompt).toContain("use `superpowers:brainstorming` first");
    expect(runtimePrompt).toContain("use `superpowers:writing-plans` discipline");
    expect(runtimePrompt).toContain(`Write the final Markdown issue draft to \`.prs/issues/${createdDraft}\`.`);
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
  });

  it("creates managed issue spec and plan comments from Superpowers draft artifacts", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const createdIssueNumber = 101;
    createMockCodexSuperpowersHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/issues") && init?.method === "POST") {
        return createFetchResponse({
          number: createdIssueNumber,
          title: "Superpowers draft title",
          html_url: getRepositoryIssueUrl(createdIssueNumber),
        });
      }

      if (url.includes(`/issues/${createdIssueNumber}/comments?`)) {
        return createFetchResponse([]);
      }

      if (url.endsWith(`/issues/${createdIssueNumber}/comments`) && init?.method === "POST") {
        const requestBody = JSON.parse(String(init.body)) as { body: string };
        const isSpec = requestBody.body.includes("<!-- prs:issue-spec -->");
        return createFetchResponse({
          id: isSpec ? 9000 : 9001,
          body: requestBody.body,
          html_url:
            `https://github.com/DevwareUK/prs/issues/${createdIssueNumber}#issuecomment-${isSpec ? 9000 : 9001}`,
          updated_at: "2026-04-26T09:30:00Z",
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
          readlineAnswers: ["Draft a Superpowers issue.", "y"],
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
                "# Superpowers draft title\n\n## Summary\nDraft body.\n\n## Requirements\n- Full requirement belongs in the spec comment.\n",
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.runDir as string, "superpowers-spec.md"),
                "## Superpowers Spec\n\n- Publish this spec.\n",
                "utf8"
              );
              writeFileSync(
                resolve(REPO_ROOT, metadata.runDir as string, "superpowers-plan.md"),
                "## Superpowers Plan\n\n- Publish this plan.\n",
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
        process.argv = ["node", "prs", "issue", "draft", "--runtime"];
        await run();
      }
    );

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const issueCreateCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/issues") &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(issueCreateCall).toBeDefined();
    expect(JSON.parse(String(issueCreateCall?.[1] && (issueCreateCall[1] as RequestInit).body))).toEqual({
      title: "Superpowers draft title",
      body:
        "## Summary\n\nDraft body.\n\nThe settled specification and implementation plan are maintained in managed issue comments.",
      labels: [],
    });

    const specCommentCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/issues/${createdIssueNumber}/comments`) &&
        (init as RequestInit | undefined)?.method === "POST" &&
        String((init as RequestInit).body).includes("prs:issue-spec")
    );
    expect(specCommentCall).toBeDefined();
    expect(JSON.parse(String(specCommentCall?.[1] && (specCommentCall[1] as RequestInit).body))).toEqual({
      body: "<!-- prs:issue-spec -->\n## Superpowers Spec\n\n- Publish this spec.\n",
    });

    const planCommentCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith(`/issues/${createdIssueNumber}/comments`) &&
        (init as RequestInit | undefined)?.method === "POST" &&
        String((init as RequestInit).body).includes("prs:issue-plan")
    );
    expect(planCommentCall).toBeDefined();
    expect(JSON.parse(String(planCommentCall?.[1] && (planCommentCall[1] as RequestInit).body))).toEqual({
      body: "<!-- prs:issue-plan -->\n## Superpowers Plan\n\n- Publish this plan.\n",
    });
  });

  it("skips Superpowers draft plan publication when the plan artifact is missing", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const createdIssueNumber = 102;
    const messages: string[] = [];
    createMockCodexSuperpowersHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/issues") && init?.method === "POST") {
        return createFetchResponse({
          number: createdIssueNumber,
          title: "Missing plan draft title",
          html_url: getRepositoryIssueUrl(createdIssueNumber),
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
          readlineAnswers: ["Draft a Superpowers issue without a plan.", "y"],
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
                "# Missing plan draft title\n\n## Summary\nDraft body.\n",
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
        process.env.GH_TOKEN = "";
        process.env.GITHUB_TOKEN = "test-token";
        process.argv = ["node", "prs", "issue", "draft", "--runtime"];
        await run();
      }
    );

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(messages.join("\n")).toContain(
      `Superpowers plan publication skipped because .prs/runs/${createdRunDir}/superpowers-plan.md does not exist.`
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(`/issues/${createdIssueNumber}/comments`),
      expect.any(Object)
    );
    expect(
      readFileSync(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string, "output.log"), "utf8")
    ).toContain("Superpowers plan publication skipped");
  });

  it("falls back to the standard Codex draft prompt when Superpowers is configured but unavailable", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    let runtimePrompt = "";
    createMockCodexHome();

    await withRepositoryConfig(
      JSON.stringify(
        {
          ai: {
            issueDraft: {
              useCodexSuperpowers: true,
            },
          },
        },
        null,
        2
      ),
      async () => {
        const { run } = await loadCli({
          readlineAnswers: ["Add an optional Superpowers-backed Codex mode."],
          spawnSyncImpl: (command, args) => {
            if (command === "codex" && args[0] === "--version") {
              return { status: 0 };
            }

            if (command === "codex") {
              const { metadata } = readLatestRunMetadata();
              runtimePrompt = readFileSync(
                resolve(REPO_ROOT, metadata.promptFile as string),
                "utf8"
              );
              writeFileSync(resolve(REPO_ROOT, metadata.draftFile as string), "# Draft\n", "utf8");
              return { status: 0 };
            }

            if (command === "gh" && args[0] === "--version") {
              return { status: 1, error: new Error("gh is unavailable") };
            }

            throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
          },
        });

        process.argv = ["node", "prs", "issue", "draft", "--runtime"];
        const stdout = captureStdout();
        const messages: string[] = [];
        vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
          messages.push(String(message ?? ""));
        });
        await run();
        expect(messages.join("\n")).toContain(
          "Codex Superpowers-backed issue workflows are enabled in .prs/config.json, but Superpowers is not available in the current Codex installation. Falling back to the standard issue-draft prompt."
        );
        expect(stdout.output()).toContain("# Draft");
      }
    );

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(runtimePrompt).not.toContain("use `superpowers:brainstorming` first");
    expect(runtimePrompt).toContain("ask the user targeted clarifying questions");
  });

  it("previews the generated issue draft and creates it without opening an editor by default", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const issueTitle = "Merge PR description and review summary into one PR assistant action";
    createMockCodexHome();
    const { run, execFileSync, spawnSync } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "create") {
          return "https://github.com/DevwareUK/prs/issues/99\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${issueTitle}\n\n## Summary\nUnify the managed PR assistant outputs into one reviewed draft.\n`,
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "draft", "--runtime"];
    const stdout = captureStdout();
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        "DevwareUK/prs",
        "--title",
        issueTitle,
        "--body",
        expect.stringContaining("## Summary"),
      ],
      expect.any(Object)
    );
    expect(stdout.output()).toContain("Generated issue draft");
    expect(stdout.output()).toContain(`# ${issueTitle}`);
    expect(
      spawnSync.mock.calls.some(([command]) => String(command).startsWith("vim "))
    ).toBe(false);
  });

  it("opens the issue draft in an editor only when modify is selected", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    createMockCodexHome();
    const initialTitle = "Merge PR description and review summary into one PR assistant action";
    const updatedTitle = "Unify the PR assistant draft creation flow";
    const { run, execFileSync, spawnSync } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "m", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        if (command === "gh" && args[0] === "issue" && args[1] === "create") {
          return "https://github.com/DevwareUK/prs/issues/100\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${initialTitle}\n\n## Summary\nUnify the managed PR assistant outputs into one reviewed draft.\n`,
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command.startsWith("vim ")) {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${updatedTitle}\n\n## Summary\nCreate one managed PR assistant artifact.\n`,
            "utf8"
          );
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "draft", "--runtime"];
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(execFileSync).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        "DevwareUK/prs",
        "--title",
        updatedTitle,
        "--body",
        expect.stringContaining("## Summary"),
      ],
      expect.any(Object)
    );
    expect(
      spawnSync.mock.calls.filter(([command]) => String(command).startsWith("vim "))
    ).toHaveLength(1);
  });

  it("keeps the reviewed issue draft on disk when creation is declined", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    createMockCodexHome();
    const issueTitle = "Merge PR description and review summary into one PR assistant action";
    const { run, execFileSync } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${issueTitle}\n\n## Summary\nUnify the managed PR assistant outputs into one reviewed draft.\n`,
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "draft", "--runtime"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    const createdDraftPath = resolve(REPO_ROOT, ".prs", "issues", createdDraft as string);
    cleanupTargets.add(createdDraftPath);

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(readFileSync(createdDraftPath, "utf8")).toContain(issueTitle);
    expect(messages.join("\n")).toContain(`Draft kept at .prs/issues/${createdDraft}`);
    expect(execFileSync).not.toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["issue", "create"]),
      expect.anything()
    );
  });

  it("rejects empty modified issue drafts and lets the user cancel safely", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    createMockCodexHome();
    const { run, execFileSync } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "m", "n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            "# Valid title\n\n## Summary\nStart with a valid draft.\n",
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "auth" && args[1] === "status") {
          return { status: 0 };
        }

        if (command.startsWith("vim ")) {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(resolve(REPO_ROOT, metadata.draftFile as string), "", "utf8");
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "draft", "--runtime"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(messages.join("\n")).toContain("Issue draft cannot be empty.");
    expect(execFileSync).not.toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["issue", "create"]),
      expect.anything()
    );
  });

  it("creates a draft issue with a GitHub token when gh is unavailable", async () => {
    const beforeDrafts = listIssueDraftFiles();
    const beforeRuns = listRunDirectories();
    const issueTitle = "Merge PR description and review summary into one PR assistant action";
    createMockCodexHome();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createFetchResponse({
        number: 109,
        title: issueTitle,
        html_url: "https://github.com/DevwareUK/prs/issues/109",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { run } = await loadCli({
      readlineAnswers: ["Unify PR assistant outputs.", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "codex") {
          const { metadata } = readLatestRunMetadata();
          writeFileSync(
            resolve(REPO_ROOT, metadata.draftFile as string),
            `# ${issueTitle}\n\n## Summary\nUnify the managed PR assistant outputs into one reviewed draft.\n`,
            "utf8"
          );

          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command.startsWith("vim ")) {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "issue", "draft", "--runtime"];

    await run();

    const createdDraft = listIssueDraftFiles().find((entry) => !beforeDrafts.includes(entry));
    expect(createdDraft).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "issues", createdDraft as string));

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/DevwareUK/prs/issues",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      title: issueTitle,
      body: expect.stringContaining("## Summary"),
      labels: [],
    });
  });

  it("creates multiple linked draft issues from an issue set manifest", async () => {
    const beforeRuns = listRunDirectories();
    createMockCodexHome();
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method;

      if (url.endsWith("/issues") && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { title: string };
        const issueNumber = body.title.includes("Contract") ? 201 : 202;
        return createFetchResponse({
          number: issueNumber,
          title: body.title,
          html_url: getRepositoryIssueUrl(issueNumber),
        });
      }

      if (url.endsWith("/issues/201") && method === "PATCH") {
        return createFetchResponse({
          number: 201,
          title: "Add Issue Set Contract",
          html_url: getRepositoryIssueUrl(201),
        });
      }

      if (url.endsWith("/issues/202") && method === "PATCH") {
        return createFetchResponse({
          number: 202,
          title: "Apply Issue Set Manifest",
          html_url: getRepositoryIssueUrl(202),
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      readlineAnswers: ["Split draft workflow support.", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex") {
          const { metadata, runDir } = readLatestRunMetadata();
          const runDirPath = resolve(REPO_ROOT, metadata.runDir as string);
          writeFileSync(
            resolve(runDirPath, "contract.md"),
            "# Add Issue Set Contract\n\n## Summary\nDefine and validate manifest contracts.\n",
            "utf8"
          );
          writeFileSync(
            resolve(runDirPath, "cli.md"),
            "# Apply Issue Set Manifest\n\n## Summary\nCreate linked issues from manifests.\n",
            "utf8"
          );
          writeFileSync(
            resolve(REPO_ROOT, metadata.issueSetFile as string),
            `${JSON.stringify(
              {
                version: 1,
                mode: "multiple",
                linkingStrategy: "Split manifest contracts from CLI apply behavior.",
                issues: [
                  {
                    id: "contract",
                    draftFile: `.prs/runs/${runDir}/contract.md`,
                    blocks: ["cli"],
                    related: ["cli"],
                  },
                  {
                    id: "cli",
                    draftFile: `.prs/runs/${runDir}/cli.md`,
                    dependsOn: ["contract"],
                    related: ["contract"],
                  },
                ],
              },
              null,
              2
            )}\n`,
            "utf8"
          );
          cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "draft", "--runtime"];
    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    const createdRunDir = listRunDirectories().find((entry) => !beforeRuns.includes(entry));
    expect(createdRunDir).toBeDefined();
    cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", createdRunDir as string));

    const patchBodies = fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { body: string });
    expect(patchBodies).toHaveLength(2);
    expect(patchBodies[0]?.body).toContain("## Linked Issues");
    expect(patchBodies[0]?.body).toContain("Blocks: #202");
    expect(patchBodies[0]?.body).toContain("Related: #202");
    expect(patchBodies[1]?.body).toContain("Depends on: #201");
    expect(patchBodies[1]?.body).toContain("Related: #201");
    expect(messages.join("\n")).toContain("Created issue: https://github.com/DevwareUK/prs/issues/201");
    expect(messages.join("\n")).toContain("Created issue: https://github.com/DevwareUK/prs/issues/202");
  });

  it("rejects invalid issue-set manifests before creating draft issues", async () => {
    createMockCodexHome();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "test-token";

    const { run } = await loadCli({
      readlineAnswers: ["Split draft workflow support."],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "codex" && args[0] === "--version") {
          return { status: 0 };
        }

        if (command === "gh" && args[0] === "--version") {
          return { status: 1, error: new Error("gh is unavailable") };
        }

        if (command === "codex") {
          const { metadata, runDir } = readLatestRunMetadata();
          const runDirPath = resolve(REPO_ROOT, metadata.runDir as string);
          writeFileSync(
            resolve(runDirPath, "one.md"),
            "# One\n\n## Summary\nValid markdown draft.\n",
            "utf8"
          );
          writeFileSync(
            resolve(REPO_ROOT, metadata.issueSetFile as string),
            `${JSON.stringify({
              version: 1,
              mode: "multiple",
              issues: [
                { id: "duplicate", draftFile: `.prs/runs/${runDir}/one.md` },
                { id: "duplicate", draftFile: `.prs/runs/${runDir}/one.md` },
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

    process.argv = ["node", "prs", "issue", "draft", "--runtime"];
    await expect(run()).rejects.toThrow(/duplicate issue id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing draft files",
      expected: /does not exist/,
      writeArtifacts: (metadata: { issueSetFile?: string; runDir?: string }, runDir: string) => {
        writeFileSync(
          resolve(REPO_ROOT, metadata.issueSetFile as string),
          `${JSON.stringify({
            version: 1,
            mode: "multiple",
            issues: [
              { id: "one", draftFile: `.prs/runs/${runDir}/missing-one.md` },
              { id: "two", draftFile: `.prs/runs/${runDir}/missing-two.md` },
            ],
          })}\n`,
          "utf8"
        );
      },
    },
    {
      name: "draft files outside the run directory",
      expected: /must stay inside/,
      writeArtifacts: (metadata: { issueSetFile?: string; runDir?: string }, runDir: string) => {
        const outsideDraft = resolve(REPO_ROOT, ".prs", "issues", "outside-run.md");
        writeFileSync(outsideDraft, "# Outside\n\n## Summary\nOutside run directory.\n", "utf8");
        cleanupTargets.add(outsideDraft);
        writeFileSync(
          resolve(REPO_ROOT, metadata.issueSetFile as string),
          `${JSON.stringify({
            version: 1,
            mode: "multiple",
            issues: [
              { id: "outside", draftFile: ".prs/issues/outside-run.md" },
              { id: "missing", draftFile: `.prs/runs/${runDir}/missing.md` },
            ],
          })}\n`,
          "utf8"
        );
      },
    },
    {
      name: "malformed markdown drafts",
      expected: /Issue draft must start with a top-level markdown heading/,
      writeArtifacts: (metadata: { issueSetFile?: string; runDir?: string }, runDir: string) => {
        const runDirPath = resolve(REPO_ROOT, metadata.runDir as string);
        writeFileSync(resolve(runDirPath, "bad.md"), "## Bad\n\nNo top-level heading.\n", "utf8");
        writeFileSync(resolve(runDirPath, "good.md"), "# Good\n\n## Summary\nValid.\n", "utf8");
        writeFileSync(
          resolve(REPO_ROOT, metadata.issueSetFile as string),
          `${JSON.stringify({
            version: 1,
            mode: "multiple",
            issues: [
              { id: "bad", draftFile: `.prs/runs/${runDir}/bad.md` },
              { id: "good", draftFile: `.prs/runs/${runDir}/good.md` },
            ],
          })}\n`,
          "utf8"
        );
      },
    },
    {
      name: "unknown relationship targets",
      expected: /references unknown issue/,
      writeArtifacts: (metadata: { issueSetFile?: string; runDir?: string }, runDir: string) => {
        const runDirPath = resolve(REPO_ROOT, metadata.runDir as string);
        writeFileSync(resolve(runDirPath, "one.md"), "# One\n\n## Summary\nValid.\n", "utf8");
        writeFileSync(resolve(runDirPath, "two.md"), "# Two\n\n## Summary\nValid.\n", "utf8");
        writeFileSync(
          resolve(REPO_ROOT, metadata.issueSetFile as string),
          `${JSON.stringify({
            version: 1,
            mode: "multiple",
            issues: [
              {
                id: "one",
                draftFile: `.prs/runs/${runDir}/one.md`,
                dependsOn: ["missing"],
              },
              { id: "two", draftFile: `.prs/runs/${runDir}/two.md` },
            ],
          })}\n`,
          "utf8"
        );
      },
    },
  ])(
    "rejects multi-issue draft validation errors for $name before network writes",
    async ({ expected, writeArtifacts }) => {
      createMockCodexHome();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      process.env.GH_TOKEN = "";
      process.env.GITHUB_TOKEN = "test-token";

      const { run } = await loadCli({
        readlineAnswers: ["Split draft workflow support."],
        execFileSyncImpl: (command, args) => {
          if (command === "git" && args[0] === "remote") {
            return "git@github.com:DevwareUK/prs.git\n";
          }

          throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
        },
        spawnSyncImpl: (command, args) => {
          if (command === "codex" && args[0] === "--version") {
            return { status: 0 };
          }

          if (command === "gh" && args[0] === "--version") {
            return { status: 1, error: new Error("gh is unavailable") };
          }

          if (command === "codex") {
            const { metadata, runDir } = readLatestRunMetadata();
            writeArtifacts(metadata, runDir);
            cleanupTargets.add(resolve(REPO_ROOT, ".prs", "runs", runDir));
            return { status: 0 };
          }

          throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
        },
      });

      process.argv = ["node", "prs", "issue", "draft", "--runtime"];
      await expect(run()).rejects.toThrow(expected);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

});
