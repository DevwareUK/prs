const { PRDescriptionInput, PRDescriptionOutput } = require("@ai-actions/contracts");

function buildPrompt(input) {
  return [
    "Generate a GitHub pull request title and body from the diff.",
    "Return strictly valid JSON with keys: title, body, testingNotes, riskNotes.",
    "title and body are required strings. testingNotes and riskNotes are optional strings.",
    "Do not include markdown code fences.",
    "",
    `Issue Title: ${input.issueTitle || ""}`,
    `Issue Body: ${input.issueBody || ""}`,
    "",
    "Diff:",
    input.diff,
  ].join("\n");
}

function extractJson(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
      return JSON.parse(match[1]);
    }

    throw new Error("Model output was not valid JSON");
  }
}

async function generatePRDescription(provider, input) {
  const parsedInput = PRDescriptionInput.parse(input);
  const prompt = buildPrompt(parsedInput);
  const rawResponse = await provider.generate(prompt);
  const parsedOutput = extractJson(rawResponse);

  return PRDescriptionOutput.parse(parsedOutput);
}

module.exports = {
  generatePRDescription,
};
