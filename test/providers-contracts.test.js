const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRDescriptionInput,
  TestBacklogOutput,
  TestSuggestionsOutput,
} = require("../packages/contracts/dist");
const { OpenAIProvider } = require("../packages/providers/dist");

test("PRDescriptionInput trims optional and required strings", () => {
  const parsed = PRDescriptionInput.parse({
    diff: "  diff --git a/file.ts b/file.ts  ",
    issueTitle: "  Add tests  ",
    issueBody: "  Cover actions  ",
  });

  assert.deepEqual(parsed, {
    diff: "diff --git a/file.ts b/file.ts",
    issueTitle: "Add tests",
    issueBody: "Cover actions",
  });
});

test("contract schemas parse representative backlog payloads", () => {
  const parsed = TestBacklogOutput.parse({
    summary: "Repository has an initial test harness.",
    currentTestingSetup: {
      status: "established",
      hasTests: true,
      testFileCount: 4,
      frameworks: ["node:test"],
      evidence: ['test script "test" in package.json'],
      testDirectories: ["test"],
      notes: [],
    },
    notableCoverageGaps: ["CLI command coverage (medium)"],
    findings: [
      {
        id: "cli",
        title: "CLI command coverage",
        priority: "medium",
        rationale: "The CLI remains a high-leverage entry point.",
        suggestedTestTypes: ["cli", "integration"],
        relatedPaths: ["packages/cli", "package.json"],
        issueTitle: "Add CLI command coverage",
        issueBody: "## Summary\nAdd CLI command coverage",
      },
    ],
  });

  assert.equal(parsed.currentTestingSetup.frameworks[0], "node:test");
});

test("OpenAIProvider posts the request body and returns the first response message", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  let capturedUrl;
  let capturedOptions;
  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "  generated text  ",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }
    );
  };

  const provider = new OpenAIProvider({
    apiKey: "test-key",
    model: "gpt-test",
    baseUrl: "https://example.com/v1",
  });

  const result = await provider.generateText({
    systemPrompt: "System prompt",
    prompt: "User prompt",
    temperature: 0.4,
  });

  assert.equal(result, "generated text");
  assert.equal(capturedUrl, "https://example.com/v1/chat/completions");
  assert.equal(capturedOptions.method, "POST");

  const payload = JSON.parse(capturedOptions.body);
  assert.equal(payload.model, "gpt-test");
  assert.equal(payload.messages[0].role, "system");
  assert.equal(payload.messages[1].content, "User prompt");
  assert.equal(payload.temperature, 0.4);
});

test("OpenAIProvider rejects empty prompts and upstream failures", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  const provider = new OpenAIProvider({
    apiKey: "test-key",
    baseUrl: "https://example.com/v1",
  });

  await assert.rejects(
    provider.generateText({ prompt: "   " }),
    /requires a non-empty prompt/
  );

  global.fetch = async () =>
    new Response("bad request", {
      status: 400,
    });

  await assert.rejects(
    provider.generateText({ prompt: "Generate output" }),
    /OpenAI request failed with status 400: bad request/
  );

  const parsed = TestSuggestionsOutput.parse({
    summary: "Add smoke tests.",
    suggestedTests: [
      {
        area: "Action smoke coverage",
        priority: "high",
        value: "Protects entry points.",
      },
    ],
  });

  assert.equal(parsed.suggestedTests[0].area, "Action smoke coverage");
});
