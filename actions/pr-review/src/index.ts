import { appendFileSync } from "node:fs";
import { PRReviewInput } from "@git-ai/contracts";
import { formatPRReviewMarkdown, generatePRReview } from "@git-ai/core";
import { OpenAIProvider } from "@git-ai/providers";
import {
  getOptionalInput,
  getRequiredInlineOrFileInput,
  getRequiredInput,
} from "../../shared/src/inputs";

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

function parseOptionalIssueNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid issue_number input: "${value}"`);
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid issue_number input: "${value}"`);
  }

  return parsed;
}

function buildCommentBody(
  review: Awaited<ReturnType<typeof generatePRReview>>,
  issue: {
    number?: number;
    title?: string;
    url?: string;
  }
): string {
  return formatPRReviewMarkdown(review, issue);
}

async function run(): Promise<void> {
  const issueNumber = parseOptionalIssueNumber(getOptionalInput("issue_number"));
  const input = PRReviewInput.parse({
    diff: getRequiredInlineOrFileInput("diff", "diff_file"),
    prTitle: getOptionalInput("pr_title"),
    prBody: getOptionalInput("pr_body"),
    issueNumber,
    issueTitle: getOptionalInput("issue_title"),
    issueBody: getOptionalInput("issue_body"),
    issueUrl: getOptionalInput("issue_url"),
  });

  const provider = new OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url"),
  });

  const result = await generatePRReview(provider, input);

  setOutput("summary", result.summary);
  setOutput(
    "body",
    buildCommentBody(result, {
      number: issueNumber,
      title: input.issueTitle,
      url: input.issueUrl,
    })
  );
  setOutput("findings_json", JSON.stringify(result.findings, null, 2));
  setOutput("comments_json", JSON.stringify(result.comments, null, 2));
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
