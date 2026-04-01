import { appendFileSync } from "node:fs";
import { TestSuggestionsInput } from "@git-ai/contracts";
import { generateTestSuggestions } from "@git-ai/core";
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

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function collectLikelyLocations(
  suggestions: Awaited<ReturnType<typeof generateTestSuggestions>>["suggestedTests"]
): string[] {
  const locations = new Set<string>();
  for (const suggestion of suggestions) {
    for (const location of suggestion.likelyLocations ?? []) {
      locations.add(location);
    }
  }

  return [...locations];
}

function buildCommentBody(
  suggestions: Awaited<ReturnType<typeof generateTestSuggestions>>
): string {
  const lines: string[] = [
    "## AI Test Suggestions",
    "",
    "### Overview",
    suggestions.summary,
    "",
    "### Suggested test areas",
    "",
  ];

  for (const suggestion of suggestions.suggestedTests) {
    lines.push(`#### ${suggestion.area}`);
    lines.push(`- Priority: ${toTitleCase(suggestion.priority)}`);
    lines.push(`- Why it matters: ${suggestion.value}`);
    if (suggestion.likelyLocations?.length) {
      lines.push(
        `- Likely locations: ${suggestion.likelyLocations
          .map((location) => `\`${location}\``)
          .join(", ")}`
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

async function run(): Promise<void> {
  const input = TestSuggestionsInput.parse({
    diff: getRequiredInlineOrFileInput("diff", "diff_file"),
    prTitle: getOptionalInput("pr_title"),
    prBody: getOptionalInput("pr_body"),
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
