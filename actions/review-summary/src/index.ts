import { appendFileSync } from "node:fs";
import { ReviewSummaryInput } from "@git-ai/contracts";
import { generateReviewSummary } from "@git-ai/core";
import { OpenAIProvider } from "@git-ai/providers";

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
  appendFileSync(outputPath, payload);
}

function renderBulletSection(title: string, items: string[] | undefined): string[] {
  if (!items || items.length === 0) {
    return [];
  }

  return [`### ${title}`, ...items.map((item) => `- ${item}`), ""];
}

function buildCommentBody(summary: Awaited<ReturnType<typeof generateReviewSummary>>): string {
  const lines: string[] = ["## AI Review Summary", "", "### What changed", summary.summary, ""];

  lines.push(...renderBulletSection("Risk areas", summary.riskAreas));
  lines.push(...renderBulletSection("Suggested reviewer focus", summary.reviewerFocus));
  lines.push(...renderBulletSection("Possible missing tests", summary.missingTests));

  while (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

async function run(): Promise<void> {
  const input = ReviewSummaryInput.parse({
    diff: getRequiredInput("diff"),
    prTitle: getOptionalInput("pr_title"),
    prBody: getOptionalInput("pr_body"),
  });

  const provider = new OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url"),
  });

  const result = await generateReviewSummary(provider, input);

  setOutput("summary", result.summary);
  setOutput("body", buildCommentBody(result));
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
