import { PRDescriptionInput } from "@ai-actions/contracts";
import { generatePRDescription } from "@ai-actions/core";
import { OpenAIProvider } from "@ai-actions/providers";

function getRequiredInput(name: string): string {
  const envName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new Error(`Missing required input: ${name}`);
  }
  return value;
}

function getOptionalInput(name: string): string | undefined {
  const envName = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  const value = process.env[envName]?.trim();
  return value ? value : undefined;
}

function setOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }

  const delimiter = `EOF_${name.toUpperCase()}`;
  const payload = `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  require("node:fs").appendFileSync(outputPath, payload);
}

async function run(): Promise<void> {
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

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
