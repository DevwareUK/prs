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
function parseOptionalIssueNumber(value) {
  if (!value) {
    return void 0;
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
function buildCommentBody(review, issue) {
  const lines = [
    "## AI PR Review",
    "",
    "### Summary",
    review.summary
  ];
  if (issue.title && issue.url) {
    lines.push(
      "",
      "### Linked issue",
      `- ${issue.number !== void 0 ? `#${issue.number}: ` : ""}[${issue.title}](${issue.url})`
    );
  }
  if (review.findings.length > 0) {
    lines.push("", "### Higher-level findings");
    for (const finding of review.findings) {
      lines.push(
        `- ${finding.title} (${toTitleCase(finding.severity)} ${finding.category}): ${finding.body}`
      );
      if (finding.relatedPaths && finding.relatedPaths.length > 0) {
        lines.push(`  Related paths: ${finding.relatedPaths.map((path) => `\`${path}\``).join(", ")}`);
      }
      if (finding.suggestion) {
        lines.push(`  Suggestion: ${finding.suggestion}`);
      }
    }
  }
  lines.push("", "### Line-level findings");
  if (review.comments.length === 0) {
    lines.push("- No actionable line-level concerns identified.");
  } else {
    for (const comment of review.comments) {
      lines.push(
        `- \`${comment.path}:${comment.line}\` (${toTitleCase(comment.severity)} ${comment.category}): ${comment.body}`
      );
      if (comment.suggestion) {
        lines.push(`  Suggestion: ${comment.suggestion}`);
      }
    }
  }
  return lines.join("\n");
}
async function run() {
  const issueNumber = parseOptionalIssueNumber(getOptionalInput("issue_number"));
  const input = import_contracts.PRReviewInput.parse({
    diff: getRequiredInlineOrFileInput("diff", "diff_file"),
    prTitle: getOptionalInput("pr_title"),
    prBody: getOptionalInput("pr_body"),
    issueNumber,
    issueTitle: getOptionalInput("issue_title"),
    issueBody: getOptionalInput("issue_body"),
    issueUrl: getOptionalInput("issue_url")
  });
  const provider = new import_providers.OpenAIProvider({
    apiKey: getRequiredInput("openai_api_key"),
    model: getOptionalInput("openai_model"),
    baseUrl: getOptionalInput("openai_base_url")
  });
  const result = await (0, import_core.generatePRReview)(provider, input);
  setOutput("summary", result.summary);
  setOutput(
    "body",
    buildCommentBody(result, {
      number: issueNumber,
      title: input.issueTitle,
      url: input.issueUrl
    })
  );
  setOutput("findings_json", JSON.stringify(result.findings, null, 2));
  setOutput("comments_json", JSON.stringify(result.comments, null, 2));
}
run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::${message}`);
  process.exitCode = 1;
});
