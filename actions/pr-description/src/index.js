const fs = require("node:fs");
const { PRDescriptionInput } = require("@ai-actions/contracts");
const { generatePRDescription } = require("@ai-actions/core");
const { OpenAIProvider } = require("@ai-actions/providers");

function getRequiredInput(name) {
  const envName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const value = (process.env[envName] || "").trim();
  if (!value) {
    throw new Error(`Missing required input: ${name}`);
  }
  return value;
}

function getOptionalInput(name) {
  const envName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const value = (process.env[envName] || "").trim();
  return value || undefined;
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }

  const delimiter = `EOF_${name.toUpperCase()}`;
  fs.appendFileSync(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function run() {
  const input = PRDescriptionInput.parse({
    diff: getRequiredInput("diff"),
    issueTitle: getOptionalInput("issue_title"),
    issueBody: getOptionalInput("issue_body"),
  });

  const provider = new OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url"),
  });

  const result = await generatePRDescription(provider, input);

  setOutput("title", result.title);
  setOutput("body", result.body);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
