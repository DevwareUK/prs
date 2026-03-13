const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");

const {
  createTempDir,
  parseGitHubOutput,
  readJsonFile,
  runNodeScript,
} = require("./helpers");

test("pr-description action writes title and body outputs", async () => {
  const tempDir = createTempDir("git-ai-pr-description-");
  const outputPath = join(tempDir, "github-output.txt");
  const capturePath = join(tempDir, "fetch-capture.json");
  const result = await runNodeScript("actions/pr-description/dist/index.js", [], {
    NODE_OPTIONS: `--require ${join(__dirname, "action-fetch-mock.cjs")}`,
    GITHUB_OUTPUT: outputPath,
    GIT_AI_FETCH_CAPTURE_PATH: capturePath,
    GIT_AI_FETCH_RESPONSE_CONTENT: JSON.stringify({
      title: "test: add action smoke coverage",
      body: [
        "## Summary",
        "Adds a smoke test harness for the published GitHub actions.",
        "",
        "## Changes",
        "- Add end-to-end action execution tests with a mocked fetch layer.",
        "",
        "## Testing",
        "- Run pnpm test.",
        "",
        "## Risk",
        "- Low risk because the change is test-only.",
      ].join("\n"),
      testingNotes: null,
      riskNotes: null,
    }),
    INPUT_DIFF: "diff --git a/file.ts b/file.ts\n+console.log('test');",
    INPUT_ISSUE_TITLE: "Add smoke coverage",
    INPUT_OPENAI_API_KEY: "test-key",
    INPUT_OPENAI_BASE_URL: "https://example.com/v1",
  });

  assert.equal(result.code, 0, result.stderr);

  const capture = readJsonFile(capturePath);
  assert.equal(capture.url, "https://example.com/v1/chat/completions");
  assert.equal(capture.options.body.model, "gpt-4o-mini");
  assert.equal(capture.options.body.messages[0].role, "system");

  const outputs = parseGitHubOutput(outputPath);
  assert.equal(outputs.title, "test: add action smoke coverage");
  assert.match(outputs.body, /## Summary/);
  assert.match(outputs.body, /## Testing/);
});

test("review-summary action renders a markdown comment body", async () => {
  const tempDir = createTempDir("git-ai-review-summary-");
  const outputPath = join(tempDir, "github-output.txt");
  const result = await runNodeScript("actions/review-summary/dist/index.js", [], {
    NODE_OPTIONS: `--require ${join(__dirname, "action-fetch-mock.cjs")}`,
    GITHUB_OUTPUT: outputPath,
    GIT_AI_FETCH_RESPONSE_CONTENT: JSON.stringify({
      summary: "Adds initial review-summary smoke coverage for the action entry point.",
      riskAreas: ["GitHub output formatting"],
      reviewerFocus: ["Confirm the action writes the expected markdown sections."],
      missingTests: null,
    }),
    INPUT_DIFF: "diff --git a/file.ts b/file.ts\n+export const value = 1;",
    INPUT_PR_TITLE: "Add review summary smoke test",
    INPUT_OPENAI_API_KEY: "test-key",
    INPUT_OPENAI_BASE_URL: "https://example.com/v1",
  });

  assert.equal(result.code, 0, result.stderr);

  const outputs = parseGitHubOutput(outputPath);
  assert.match(
    outputs.summary,
    /Adds initial review-summary smoke coverage/
  );
  assert.match(outputs.body, /## AI Review Summary/);
  assert.match(outputs.body, /### Risk areas/);
  assert.match(outputs.body, /### Suggested reviewer focus/);
  assert.doesNotMatch(outputs.body, /Possible missing tests/);
});

test("test-suggestions action renders suggested test areas and likely locations", async () => {
  const tempDir = createTempDir("git-ai-test-suggestions-");
  const outputPath = join(tempDir, "github-output.txt");
  const result = await runNodeScript("actions/test-suggestions/dist/index.js", [], {
    NODE_OPTIONS: `--require ${join(__dirname, "action-fetch-mock.cjs")}`,
    GITHUB_OUTPUT: outputPath,
    GIT_AI_FETCH_RESPONSE_CONTENT: JSON.stringify({
      summary: "The diff introduces new automation entry points that should get smoke coverage.",
      suggestedTests: [
        {
          area: "Action entry point execution",
          priority: "high",
          value: "Confirms required inputs, provider calls, and output formatting remain wired correctly.",
          likelyLocations: ["actions/test-suggestions"],
        },
        {
          area: "CLI backlog generation",
          priority: "medium",
          value: "Protects the repository-level smoke path for test planning output.",
          likelyLocations: null,
        },
      ],
      edgeCases: ["Missing optional PR metadata should not break rendering."],
    }),
    INPUT_DIFF: "diff --git a/file.ts b/file.ts\n+export const ready = true;",
    INPUT_PR_TITLE: "Add smoke coverage",
    INPUT_OPENAI_API_KEY: "test-key",
    INPUT_OPENAI_BASE_URL: "https://example.com/v1",
  });

  assert.equal(result.code, 0, result.stderr);

  const outputs = parseGitHubOutput(outputPath);
  assert.match(outputs.summary, /automation entry points/);
  assert.match(outputs.body, /## AI Test Suggestions/);
  assert.match(outputs.body, /#### Action entry point execution/);
  assert.match(outputs.body, /Priority: High/);
  assert.match(outputs.body, /### Edge cases/);
  assert.match(outputs.body, /### Likely places to add tests/);
  assert.match(outputs.body, /`actions\/test-suggestions`/);
});
