import { appendFileSync } from "node:fs";
import { TestSuggestionsInput } from "@prs/contracts";
import {
  assessAddressedTestSuggestions,
  generateTestSuggestions,
} from "@prs/core";
import { OpenAIProvider } from "@prs/providers";
import {
  getOptionalInlineOrFileInput,
  getOptionalInput,
  getRequiredInput,
} from "../../shared/src/inputs";
import {
  applyAddressedSuggestionUpdates,
  buildCommentBody,
  parseChecklistCommentBody,
} from "./comment";

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

function parseOptionalJsonInput(name: string): unknown {
  const rawValue = getOptionalInput(name);
  if (!rawValue) {
    return undefined;
  }

  try {
    return JSON.parse(rawValue) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON for ${name}: ${message}`);
  }
}

async function run(): Promise<void> {
  const existingComment = getOptionalInlineOrFileInput(
    "existing_comment",
    "existing_comment_file"
  );
  const diff = getOptionalInlineOrFileInput("diff", "diff_file");
  const prTitle = getOptionalInput("pr_title");
  const prBody = getOptionalInput("pr_body");

  if (existingComment) {
    const parsedComment = parseChecklistCommentBody(existingComment);
    const uncheckedSuggestions = parsedComment.suggestions.filter(
      (suggestion) => !suggestion.addressed
    );

    if (uncheckedSuggestions.length === 0) {
      setOutput(
        "summary",
        parsedComment.overview || "All managed AI test suggestions are already addressed."
      );
      setOutput("body", existingComment);
      return;
    }

    const input = {
      diff: diff ?? "",
      prTitle,
      prBody,
      suggestions: parsedComment.suggestions,
    };

    const provider = new OpenAIProvider({
      apiKey: getRequiredInput("openai_api_key"),
      model: getOptionalInput("openai_model"),
      baseUrl: getOptionalInput("openai_base_url"),
    });
    const result = await assessAddressedTestSuggestions(provider, input);
    const addressedIds = result.addressedSuggestions.map(
      (suggestion) => suggestion.suggestionId
    );

    setOutput("summary", parsedComment.overview);
    setOutput("body", applyAddressedSuggestionUpdates(existingComment, addressedIds));
    return;
  }

  const input = TestSuggestionsInput.parse({
    diff: diff ?? "",
    prTitle,
    prBody,
    resolvedSuggestions: parseOptionalJsonInput("resolved_suggestions"),
  });

  const provider = new OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url"),
  });
  const result = await generateTestSuggestions(provider, input);

  setOutput("summary", result.summary);
  setOutput("body", buildCommentBody(result));
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
