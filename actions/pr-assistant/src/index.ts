import { appendFileSync } from "node:fs";
import { PRAssistantInput } from "@git-ai/contracts";
import { generatePRAssistant } from "@git-ai/core";
import { OpenAIProvider } from "@git-ai/providers";
import {
  getOptionalInlineOrFileInput,
  getOptionalInput,
  getRequiredInlineOrFileInput,
  getRequiredInput,
} from "../../shared/src/inputs";
import {
  buildPRAssistantSection,
  mergePRAssistantSection,
  stripManagedPRAssistantSection,
} from "./body";

function setOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }

  const delimiter = `EOF_${name.toUpperCase()}`;
  const payload = `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  appendFileSync(outputPath, payload);
}

async function run(): Promise<void> {
  const prBody = getOptionalInput("pr_body");
  const promptBody = stripManagedPRAssistantSection(prBody);

  const input = PRAssistantInput.parse({
    diff: getRequiredInlineOrFileInput("diff", "diff_file"),
    commitMessages: getOptionalInlineOrFileInput("commit_messages", "commit_messages_file"),
    prTitle: getOptionalInput("pr_title"),
    prBody: promptBody,
  });

  const provider = new OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url"),
  });

  const result = await generatePRAssistant(provider, input);
  const section = buildPRAssistantSection(result);
  const body = mergePRAssistantSection(prBody, section);

  setOutput("summary", result.summary);
  setOutput("section", section);
  setOutput("body", body);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
