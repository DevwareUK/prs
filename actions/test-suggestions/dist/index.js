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
function toTitleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function collectLikelyLocations(suggestions) {
  const locations = /* @__PURE__ */ new Set();
  for (const suggestion of suggestions) {
    for (const location of suggestion.likelyLocations ?? []) {
      locations.add(location);
    }
  }
  return [...locations];
}
function buildCommentBody(suggestions) {
  const lines = [
    "## AI Test Suggestions",
    "",
    "### Overview",
    suggestions.summary,
    "",
    "### Suggested test areas",
    ""
  ];
  for (const suggestion of suggestions.suggestedTests) {
    lines.push(`#### ${suggestion.area}`);
    lines.push(`- Priority: ${toTitleCase(suggestion.priority)}`);
    lines.push(`- Why it matters: ${suggestion.value}`);
    if (suggestion.likelyLocations?.length) {
      lines.push(
        `- Likely locations: ${suggestion.likelyLocations.map((location) => `\`${location}\``).join(", ")}`
      );
    }
    lines.push("");
  }
  if (suggestions.edgeCases?.length) {
    lines.push("### Edge cases");
    lines.push(...suggestions.edgeCases.map((edgeCase) => `- ${edgeCase}`));
    lines.push("");
  }
  const likelyLocations = collectLikelyLocations(suggestions.suggestedTests);
  if (likelyLocations.length > 0) {
    lines.push("### Likely places to add tests");
    lines.push(...likelyLocations.map((location) => `- \`${location}\``));
    lines.push("");
  }
  while (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}
async function run() {
  const input = import_contracts.TestSuggestionsInput.parse({
    diff: getRequiredInlineOrFileInput("diff", "diff_file"),
    prTitle: getOptionalInput("pr_title"),
    prBody: getOptionalInput("pr_body")
  });
  const provider = new import_providers.OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url")
  });
  const result = await (0, import_core.generateTestSuggestions)(provider, input);
  setOutput("summary", result.summary);
  setOutput("body", buildCommentBody(result));
}
run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
