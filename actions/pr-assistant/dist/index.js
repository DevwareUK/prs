"use strict";

// src/index.ts
var import_node_fs2 = require("fs");
var import_contracts = require("@git-ai/contracts");
var import_core = require("@git-ai/core");
var import_providers = require("@git-ai/providers");

// ../shared/src/inputs.ts
var import_node_fs = require("fs");
function toEnvName(name) {
  return `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
}
function normalizeInputValue(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : void 0;
}
function readFileInput(name, filePath) {
  try {
    return (0, import_node_fs.readFileSync)(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${name} at ${filePath}: ${message}`);
  }
}
function getOptionalInput(name) {
  return normalizeInputValue(process.env[toEnvName(name)]);
}
function getRequiredInput(name) {
  const value = getOptionalInput(name);
  if (!value) {
    throw new Error(`Missing required input: ${name}`);
  }
  return value;
}
function getOptionalInlineOrFileInput(inputName, fileInputName) {
  const filePath = getOptionalInput(fileInputName);
  if (filePath) {
    const value = readFileInput(fileInputName, filePath);
    return value.trim() ? value : void 0;
  }
  return getOptionalInput(inputName);
}
function getRequiredInlineOrFileInput(inputName, fileInputName) {
  const value = getOptionalInlineOrFileInput(inputName, fileInputName);
  if (!value) {
    throw new Error(`Missing required input: ${inputName} or ${fileInputName}`);
  }
  return value;
}

// ../../packages/core/src/pr-assistant-body.ts
var PR_ASSISTANT_START_MARKER = "<!-- git-ai:pr-assistant:start -->";
var PR_ASSISTANT_END_MARKER = "<!-- git-ai:pr-assistant:end -->";
var PR_ASSISTANT_SECTION_PATTERN = new RegExp(
  `${escapeRegExp(PR_ASSISTANT_START_MARKER)}[\\s\\S]*?${escapeRegExp(PR_ASSISTANT_END_MARKER)}`,
  "m"
);
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function renderBulletSection(title, items, emptyState) {
  return [
    `### ${title}`,
    ...items.length > 0 ? items.map((item) => `- ${item}`) : [emptyState],
    ""
  ];
}
function stripManagedPRAssistantSection(body) {
  if (!body) {
    return void 0;
  }
  const stripped = body.replace(PR_ASSISTANT_SECTION_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
  return stripped ? stripped : void 0;
}
function buildPRAssistantSection(summary) {
  const lines = ["## PR Assistant", "", "### Summary", summary.summary, ""];
  lines.push(...renderBulletSection("Key changes", summary.keyChanges, "No key changes identified."));
  lines.push(
    ...renderBulletSection(
      "Risk areas",
      summary.riskAreas,
      "No additional diff-grounded risk areas identified."
    )
  );
  lines.push(
    ...renderBulletSection(
      "Reviewer focus",
      summary.reviewerFocus,
      "No additional reviewer focus areas identified."
    )
  );
  while (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}
function mergePRAssistantSection(existingBody, section) {
  const managedSection = [
    PR_ASSISTANT_START_MARKER,
    section,
    PR_ASSISTANT_END_MARKER
  ].join("\n");
  if (!existingBody?.trim()) {
    return managedSection;
  }
  const trimmedBody = existingBody.trim();
  if (PR_ASSISTANT_SECTION_PATTERN.test(trimmedBody)) {
    return trimmedBody.replace(PR_ASSISTANT_SECTION_PATTERN, managedSection).trim();
  }
  return `${trimmedBody}

${managedSection}`;
}

// src/index.ts
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
  (0, import_node_fs2.appendFileSync)(outputPath, payload);
}
async function run() {
  const prBody = getOptionalInput("pr_body");
  const promptBody = stripManagedPRAssistantSection(prBody);
  const input = import_contracts.PRAssistantInput.parse({
    diff: getRequiredInlineOrFileInput("diff", "diff_file"),
    commitMessages: getOptionalInlineOrFileInput("commit_messages", "commit_messages_file"),
    prTitle: getOptionalInput("pr_title"),
    prBody: promptBody
  });
  const provider = new import_providers.OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url")
  });
  const result = await (0, import_core.generatePRAssistant)(provider, input);
  const section = buildPRAssistantSection(result);
  const body = mergePRAssistantSection(prBody, section);
  setOutput("summary", result.summary);
  setOutput("section", section);
  setOutput("body", body);
}
run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
