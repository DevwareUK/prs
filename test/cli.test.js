const test = require("node:test");
const assert = require("node:assert/strict");

const { runNodeScript } = require("./helpers");

test("test-backlog command emits JSON for the current repository", async () => {
  const result = await runNodeScript("packages/cli/dist/index.js", [
    "test-backlog",
    "--format",
    "json",
    "--top",
    "1",
  ]);

  assert.equal(result.code, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.findings.length, 1);
  assert.equal(typeof payload.summary, "string");
  assert.equal(typeof payload.currentTestingSetup.status, "string");
  assert.ok(payload.currentTestingSetup.frameworks.includes("node:test"));
});
