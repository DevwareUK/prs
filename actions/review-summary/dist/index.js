"use strict";

// src/index.ts
var import_node_fs = require("fs");
var import_contracts = require("@git-ai/contracts");
var import_core = require("@git-ai/core");
var import_providers = require("@git-ai/providers");
function getRequiredInput(name) {
  const envName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new Error(`Missing required input: ${name}`);
  }
  return value;
}
function getOptionalInput(name) {
  const envName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const value = process.env[envName]?.trim();
  return value ? value : void 0;
}
function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }
  const delimiter = `EOF_${name.toUpperCase()}`;
  const payload = `${name}<<${delimiter}
${value}
${delimiter}
`;
  (0, import_node_fs.appendFileSync)(outputPath, payload);
}
function renderBulletSection(title, items) {
  if (!items || items.length === 0) {
    return [];
  }
  return [`### ${title}`, ...items.map((item) => `- ${item}`), ""];
}
function buildCommentBody(summary) {
  const lines = ["## AI Review Summary", "", "### What changed", summary.summary, ""];
  lines.push(...renderBulletSection("Risk areas", summary.riskAreas));
  lines.push(...renderBulletSection("Suggested reviewer focus", summary.reviewerFocus));
  lines.push(...renderBulletSection("Possible missing tests", summary.missingTests));
  while (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}
async function run() {
  const input = import_contracts.ReviewSummaryInput.parse({
    diff: getRequiredInput("diff"),
    prTitle: getOptionalInput("pr_title"),
    prBody: getOptionalInput("pr_body")
  });
  const provider = new import_providers.OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url")
  });
  const result = await (0, import_core.generateReviewSummary)(provider, input);
  setOutput("summary", result.summary);
  setOutput("body", buildCommentBody(result));
}
run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
