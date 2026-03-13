const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateCommitMessage,
  generateDiffSummary,
  generatePRDescription,
  generateReviewSummary,
  generateTestSuggestions,
} = require("../packages/core/dist");

function createProvider(responseText, calls) {
  return {
    async generateText(input) {
      calls.push(input);
      return responseText;
    },
  };
}

test("generateCommitMessage strips fenced JSON and normalizes null body", async () => {
  const calls = [];
  const provider = createProvider(
    '```json\n{"title":"test: add harness","body":null}\n```',
    calls
  );

  const result = await generateCommitMessage(
    provider,
    "diff --git a/file.ts b/file.ts\n+console.log('hello');"
  );

  assert.equal(result.title, "test: add harness");
  assert.equal(result.body, undefined);
  assert.equal(calls[0].temperature, 0.2);
  assert.match(calls[0].prompt, /Generate a git commit message/);
});

test("generateDiffSummary accepts null risk areas and validates the diff prompt", async () => {
  const calls = [];
  const provider = createProvider(
    JSON.stringify({
      summary: "Adds the initial test harness.",
      majorAreas: ["Repository test setup"],
      riskAreas: null,
    }),
    calls
  );

  const result = await generateDiffSummary(provider, {
    diff: "diff --git a/package.json b/package.json\n+\"test\": \"node --test\"",
  });

  assert.equal(result.summary, "Adds the initial test harness.");
  assert.deepEqual(result.majorAreas, ["Repository test setup"]);
  assert.equal(result.riskAreas, undefined);
  assert.match(calls[0].prompt, /Summarize the provided git diff/);
});

test("generatePRDescription includes issue context and normalizes nullable fields", async () => {
  const calls = [];
  const provider = createProvider(
    JSON.stringify({
      title: "test: add harness",
      body: "## Summary\nAdds tests.",
      testingNotes: null,
      riskNotes: null,
    }),
    calls
  );

  const result = await generatePRDescription(provider, {
    diff: "diff --git a/test/file.test.js b/test/file.test.js\n+test('works')",
    issueTitle: "Add smoke coverage",
    issueBody: "Cover the action entry points.",
  });

  assert.equal(result.title, "test: add harness");
  assert.equal(result.body, "## Summary\nAdds tests.");
  assert.equal(result.testingNotes, undefined);
  assert.equal(result.riskNotes, undefined);
  assert.match(calls[0].prompt, /Issue Title: Add smoke coverage/);
  assert.match(calls[0].prompt, /Issue Body: Cover the action entry points\./);
});

test("generateReviewSummary omits nullable missingTests values", async () => {
  const provider = createProvider(
    JSON.stringify({
      summary: "Adds smoke coverage for action wrappers.",
      riskAreas: ["Action output serialization"],
      reviewerFocus: ["Verify output formatting and failure handling."],
      missingTests: null,
    }),
    []
  );

  const result = await generateReviewSummary(provider, {
    diff: "diff --git a/actions/pr-description/src/index.ts b/actions/pr-description/src/index.ts",
    prTitle: "Add action smoke tests",
  });

  assert.equal(result.summary, "Adds smoke coverage for action wrappers.");
  assert.deepEqual(result.riskAreas, ["Action output serialization"]);
  assert.deepEqual(result.reviewerFocus, [
    "Verify output formatting and failure handling.",
  ]);
  assert.equal(result.missingTests, undefined);
});

test("generateTestSuggestions normalizes nullable nested location fields", async () => {
  const provider = createProvider(
    JSON.stringify({
      summary: "Add a few regression tests around the new harness.",
      suggestedTests: [
        {
          area: "Smoke coverage",
          priority: "high",
          value: "Covers published entry points.",
          likelyLocations: null,
        },
      ],
      edgeCases: null,
    }),
    []
  );

  const result = await generateTestSuggestions(provider, {
    diff: "diff --git a/test/core.test.js b/test/core.test.js",
  });

  assert.equal(result.summary, "Add a few regression tests around the new harness.");
  assert.equal(result.edgeCases, undefined);
  assert.deepEqual(result.suggestedTests, [
    {
      area: "Smoke coverage",
      priority: "high",
      value: "Covers published entry points.",
      likelyLocations: undefined,
    },
  ]);
});
