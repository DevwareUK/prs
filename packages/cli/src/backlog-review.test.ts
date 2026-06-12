import { describe, expect, it, vi } from "vitest";
import { DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS } from "../../core/src/repository-config";
import {
  REPO_ROOT,
  createTestBacklogAnalysis,
  createFeatureBacklogAnalysis,
  createPRReviewResult,
  createFetchResponse,
  captureStdout,
  parseJsonPayloadFromOutput,
  withRepositoryConfig,
  withoutRepositoryConfig,
  loadCli,
} from "./index-test-support";

describe("Backlog and review commands", () => {
  it("filters excluded paths from commit diffs", async () => {
    await withRepositoryConfig(
      JSON.stringify(
        {
          aiContext: {
            excludePaths: ["generated/**"],
          },
        },
        null,
        2
      ),
      async () => {
        const { run, execFileSync, generateCommitMessage } = await loadCli({
          commitMessageResult: {
            title: "feat: keep source diff only",
          },
          execFileSyncImpl: (command, args) => {
            if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
              return "src/index.ts\ngenerated/app.js\n";
            }

            if (
              command === "git" &&
              args[0] === "diff" &&
              args[1] === "--cached" &&
              args[2] === "--" &&
              args[3] === "src/index.ts"
            ) {
              return [
                "diff --git a/src/index.ts b/src/index.ts",
                "+++ b/src/index.ts",
                "@@ -0,0 +1 @@",
                "+export const value = 1;",
              ].join("\n");
            }

            throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
          },
        });

        process.env.OPENAI_API_KEY = "test-key";
        process.argv = ["node", "prs", "commit"];

        const stdout = captureStdout();
        await run();

        expect(execFileSync).toHaveBeenCalledWith(
          "git",
          ["-C", REPO_ROOT, "diff", "--name-only", "--cached"],
          expect.any(Object)
        );
        expect(execFileSync).toHaveBeenCalledWith(
          "git",
          ["-C", REPO_ROOT, "diff", "--cached", "--", "src/index.ts"],
          expect.any(Object)
        );
        expect(generateCommitMessage).toHaveBeenCalledWith(
          expect.any(Object),
          expect.stringContaining("src/index.ts")
        );
        expect(generateCommitMessage).toHaveBeenCalledWith(
          expect.any(Object),
          expect.not.stringContaining("generated/app.js")
        );
        expect(stdout.output()).toContain("feat: keep source diff only");
      }
    );
  });

  it("reads review diffs for automation with repo exclusions applied", async () => {
    await withRepositoryConfig(
      JSON.stringify(
        {
          aiContext: {
            excludePaths: ["generated/**"],
          },
        },
        null,
        2
      ),
      async () => {
        const { readReviewDiffForAutomation, execFileSync } = await loadCli({
          execFileSyncImpl: (command, args) => {
            if (
              command === "git" &&
              args[0] === "diff" &&
              args[1] === "--name-only" &&
              args[2] === "--unified=3" &&
              args[3] === "origin/main...HEAD"
            ) {
              return "src/index.ts\ngenerated/app.js\n";
            }

            if (
              command === "git" &&
              args[0] === "diff" &&
              args[1] === "--unified=3" &&
              args[2] === "origin/main...HEAD" &&
              args[3] === "--" &&
              args[4] === "src/index.ts"
            ) {
              return [
                "diff --git a/src/index.ts b/src/index.ts",
                "+++ b/src/index.ts",
                "@@ -0,0 +1 @@",
                "+export const value = 1;",
              ].join("\n");
            }

            throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
          },
        });

        const diff = readReviewDiffForAutomation("origin/main", "HEAD");

        expect(diff).toContain("src/index.ts");
        expect(diff).not.toContain("generated/app.js");
        expect(execFileSync).toHaveBeenCalledWith(
          "git",
          ["-C", REPO_ROOT, "diff", "--name-only", "--unified=3", "origin/main...HEAD"],
          expect.any(Object)
        );
      }
    );
  });

  it("runs test-backlog in JSON mode and reuses duplicate GitHub issues", async () => {
    const analysis = createTestBacklogAnalysis();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 41,
            title: analysis.findings[0].issueTitle,
            html_url: "https://github.com/DevwareUK/prs/issues/41",
          },
        ])
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 42,
          title: analysis.findings[1].issueTitle,
          html_url: "https://github.com/DevwareUK/prs/issues/42",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 43,
          title: analysis.findings[2].issueTitle,
          html_url: "https://github.com/DevwareUK/prs/issues/43",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, analyzeTestBacklog } = await loadCli({
      analysisResult: analysis,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "remote") {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    await withoutRepositoryConfig(async () => {
      process.env.GITHUB_TOKEN = "test-token";
      process.argv = [
        "node",
        "prs",
        "test-backlog",
        "--format",
        "json",
        "--top",
        "3",
        "--create-issues",
        "--max-issues",
        "3",
        "--label",
        "tests",
      ];

      const stdout = captureStdout();
      await run();

      expect(analyzeTestBacklog).toHaveBeenCalledWith({
        excludePaths: [...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS],
        repoRoot: REPO_ROOT,
        maxFindings: 3,
      });

      const output = JSON.parse(stdout.output()) as {
        findings: Array<{ issueTitle: string }>;
        createdIssues: Array<{ number: number; title: string; status: string }>;
      };

      expect(output.findings.map((finding) => finding.issueTitle)).toEqual(
        analysis.findings.map((finding) => finding.issueTitle)
      );
      expect(output.createdIssues).toEqual([
        {
          number: 41,
          title: analysis.findings[0].issueTitle,
          url: "https://github.com/DevwareUK/prs/issues/41",
          status: "existing",
        },
        {
          number: 42,
          title: analysis.findings[1].issueTitle,
          url: "https://github.com/DevwareUK/prs/issues/42",
          status: "created",
        },
        {
          number: 43,
          title: analysis.findings[2].issueTitle,
          url: "https://github.com/DevwareUK/prs/issues/43",
          status: "created",
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it("renders test-backlog markdown output", async () => {
    const analysis = createTestBacklogAnalysis();
    const { run, analyzeTestBacklog } = await loadCli({
      analysisResult: analysis,
    });

    await withoutRepositoryConfig(async () => {
      process.argv = ["node", "prs", "test-backlog", "--top", "2"];

      const stdout = captureStdout();
      await run();

      expect(analyzeTestBacklog).toHaveBeenCalledWith({
        excludePaths: [...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS],
        repoRoot: REPO_ROOT,
        maxFindings: 2,
      });
      expect(stdout.output()).toContain("# AI Test Backlog");
      expect(stdout.output()).toContain("## Summary");
      expect(stdout.output()).toContain("- Status: Partial");
      expect(stdout.output()).toContain("- CI integration: Partial");
      expect(stdout.output()).toContain("- Recommended framework: Vitest");
      expect(stdout.output()).toContain(
        "- Recommendation rationale: Vitest fits package-level TypeScript and CLI integration tests."
      );
      expect(stdout.output()).toContain("### Missing CLI integration coverage for issue prepare");
      expect(stdout.output()).toContain(
        "- Draft issue title: Add CLI integration coverage for prs issue prepare"
      );
    });
  });

  it("prompts to create selected test-backlog issues after interactive markdown output", async () => {
    const analysis = createTestBacklogAnalysis();
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFetchResponse([]))
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 42,
          title: analysis.findings[0].issueTitle,
          html_url: "https://github.com/DevwareUK/prs/issues/42",
        })
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 43,
          title: analysis.findings[2].issueTitle,
          html_url: "https://github.com/DevwareUK/prs/issues/43",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { run, createInterface } = await loadCli({
        analysisResult: analysis,
        readlineAnswers: ["", "1,3"],
        execFileSyncImpl: (command, args) => {
          if (command === "git" && args[0] === "remote") {
            return "git@github.com:DevwareUK/prs.git\n";
          }

          throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
        },
      });

      await withoutRepositoryConfig(async () => {
        process.env.GITHUB_TOKEN = "test-token";
        process.argv = ["node", "prs", "test-backlog", "--top", "3"];

        const stdout = captureStdout();
        await run();

        expect(stdout.output()).toContain("# AI Test Backlog");
        expect(stdout.output()).toContain("## Issue results");
        expect(stdout.output()).toContain(
          "Created #42: Add CLI integration coverage for prs issue prepare"
        );
        expect(stdout.output()).toContain(
          "Created #43: Add failure coverage for prs issue finalize"
        );
        expect(createInterface.mock.results[0]?.value.question).toHaveBeenCalledWith(
          "Do you want to create GitHub issues now? (Y/n): "
        );
        expect(createInterface.mock.results[1]?.value.question).toHaveBeenCalledWith(
          "Which issues would you like to create? (ALL/1,2,3): "
        );
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it("renders test-backlog markdown output when no findings are detected", async () => {
    const analysis = {
      ...createTestBacklogAnalysis(),
      summary: "No prioritized testing backlog gaps were detected.",
      notableCoverageGaps: [],
      findings: [],
    };
    const { run } = await loadCli({
      analysisResult: analysis,
    });

    await withoutRepositoryConfig(async () => {
      process.argv = ["node", "prs", "test-backlog"];

      const stdout = captureStdout();
      await run();

      expect(stdout.output()).toContain("## Prioritized findings");
      expect(stdout.output()).toContain(
        "No prioritized testing backlog findings were detected for this repository."
      );
    });
  });

  it("runs review in markdown mode with linked issue context", async () => {
    const review = createPRReviewResult();
    const { run, generatePRReview } = await loadCli({
      prReviewResult: review,
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "diff") {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -410,0 +412,1 @@",
            "+const issueNumber = rawValue;",
          ].join("\n");
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

        if (command === "codex" && args[0] === "--version") {
          return { status: 1, error: new Error("codex is unavailable") };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse({
          title: "Implement AI-Powered Pull Request Review Functionality",
          body: "Review pull requests line by line and use the linked issue as context.",
          html_url: "https://github.com/DevwareUK/prs/issues/50",
        })
      )
      .mockResolvedValueOnce(createFetchResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    process.env.OPENAI_API_KEY = "test-key";
    process.env.GITHUB_TOKEN = "test-token";
    process.argv = ["node", "prs", "review", "--issue-number", "50"];

    const stdout = captureStdout();
    await run();

    expect(generatePRReview).toHaveBeenCalledWith(expect.any(Object), {
      diff: expect.stringContaining("packages/cli/src/index.ts"),
      issueNumber: 50,
      issueTitle: "Implement AI-Powered Pull Request Review Functionality",
      issueBody: "Review pull requests line by line and use the linked issue as context.",
      issueUrl: "https://github.com/DevwareUK/prs/issues/50",
    });
    expect(stdout.output()).toContain("# AI PR Pre-Review Signal");
    expect(stdout.output()).toContain("## Top Risks");
    expect(stdout.output()).toContain("README.md");
    expect(stdout.output()).toContain("## Linked issue");
    expect(stdout.output()).toContain("packages/cli/src/index.ts:412");
    expect(stdout.output()).toContain("Signal: High severity, High confidence Correctness");
    expect(stdout.output()).toContain(
      "Why it matters: Malformed input should fail as a clear validation error"
    );
  });

  it("passes configured excludePaths into test-backlog analysis", async () => {
    await withRepositoryConfig(
      JSON.stringify(
        {
          aiContext: {
            excludePaths: ["web/themes/**/css/**"],
          },
        },
        null,
        2
      ),
      async () => {
        const analysis = createTestBacklogAnalysis();
        const { run, analyzeTestBacklog } = await loadCli({
          analysisResult: analysis,
        });

        process.argv = ["node", "prs", "test-backlog", "--top", "1"];

        const stdout = captureStdout();
        await run();

        expect(analyzeTestBacklog).toHaveBeenCalledWith({
          excludePaths: [
            "**/node_modules/**",
            "**/vendor/**",
            "**/dist/**",
            "**/build/**",
            "*.map",
            "web/themes/**/css/**",
          ],
          repoRoot: REPO_ROOT,
          maxFindings: 1,
        });
        expect(stdout.output()).toContain("# AI Test Backlog");
      }
    );
  });

  it("fails test-backlog issue creation clearly when no GitHub token is configured", async () => {
    const { run } = await loadCli({
      analysisResult: createTestBacklogAnalysis(),
    });

    process.env.GITHUB_TOKEN = "";
    process.env.GH_TOKEN = "";
    process.argv = ["node", "prs", "test-backlog", "--create-issues"];

    await expect(run()).rejects.toThrow(
      "Creating GitHub issues requires GH_TOKEN or GITHUB_TOKEN to be set."
    );
  });

  it("runs feature-backlog in JSON mode and prompts for issue details before creating issues", async () => {
    const analysis = createFeatureBacklogAnalysis();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createFetchResponse([
          {
            number: 51,
            title: analysis.suggestions[0].issueTitle,
            html_url: "https://github.com/DevwareUK/prs/issues/51",
          },
        ])
      )
      .mockResolvedValueOnce(
        createFetchResponse({
          number: 52,
          title: "Custom release automation title",
          html_url: "https://github.com/DevwareUK/prs/issues/52",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { run, analyzeFeatureBacklog } = await loadCli({
      featureAnalysisResult: analysis,
      readlineAnswers: [
        "1,2",
        "",
        "",
        "",
        "Custom release automation title",
        "Prioritize npm package publishing and changelog generation.",
        "release,automation",
      ],
      execFileSyncImpl: (command, args) => {
        if (
          command === "git" &&
          (args[0] === "-C" || args[0] === "remote")
        ) {
          return "git@github.com:DevwareUK/prs.git\n";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    await withoutRepositoryConfig(async () => {
      process.env.GITHUB_TOKEN = "test-token";
      process.argv = [
        "node",
        "prs",
        "feature-backlog",
        ".",
        "--format",
        "json",
        "--create-issues",
        "--max-issues",
        "2",
        "--label",
        "product",
      ];

      const stdout = captureStdout();
      await run();

      expect(analyzeFeatureBacklog).toHaveBeenCalledWith(
        expect.objectContaining({
          excludePaths: expect.arrayContaining([
            ...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
          ]),
          repoRoot: process.cwd(),
          maxSuggestions: 5,
        })
      );

      const output = parseJsonPayloadFromOutput(stdout.output()) as {
        suggestions: Array<{ issueTitle: string }>;
        createdIssues: Array<{ number: number; title: string; status: string }>;
      };

      expect(output.suggestions.map((suggestion) => suggestion.issueTitle)).toEqual(
        analysis.suggestions.map((suggestion) => suggestion.issueTitle)
      );
      expect(output.createdIssues).toEqual([
        {
          number: 51,
          title: analysis.suggestions[0].issueTitle,
          url: "https://github.com/DevwareUK/prs/issues/51",
          status: "existing",
        },
        {
          number: 52,
          title: "Custom release automation title",
          url: "https://github.com/DevwareUK/prs/issues/52",
          status: "created",
        },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("renders feature-backlog markdown output", async () => {
    const analysis = createFeatureBacklogAnalysis();
    const { run, analyzeFeatureBacklog } = await loadCli({
      featureAnalysisResult: analysis,
    });

    await withoutRepositoryConfig(async () => {
      process.argv = ["node", "prs", "feature-backlog", ".", "--top", "2"];

      const stdout = captureStdout();
      await run();

      expect(analyzeFeatureBacklog).toHaveBeenCalledWith(
        expect.objectContaining({
          excludePaths: expect.arrayContaining([
            ...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
          ]),
          repoRoot: process.cwd(),
          maxSuggestions: 2,
        })
      );
      expect(stdout.output()).toContain("# AI Feature Backlog");
      expect(stdout.output()).toContain("## Repository signals");
      expect(stdout.output()).toContain(
        "### Add guided issue templates for feature requests and bug reports"
      );
      expect(stdout.output()).toContain(
        "- Draft issue title: Add guided issue templates for feature requests and bug reports"
      );
    });
  });

});
