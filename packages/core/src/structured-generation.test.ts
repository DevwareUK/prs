import { describe, expect, it } from "vitest";
import { ReviewSummaryOutput } from "@git-ai/contracts";
import { generateStructuredOutput } from "./structured-generation";

describe("generateStructuredOutput", () => {
  it("adds structured-output context to JSON parsing failures", async () => {
    await expect(
      generateStructuredOutput({
        provider: {
          generateText: async () => '{"summary":"broken"',
        },
        systemPrompt: "system",
        prompt: "prompt",
        schema: ReviewSummaryOutput,
        validationErrorPrefix:
          "Model output failed review summary schema validation",
      })
    ).rejects.toMatchObject({
      name: "StructuredGenerationError",
      kind: "json_parse",
      rawResponse: '{"summary":"broken"',
      message: expect.stringContaining(
        "Failed to parse review summary model output as JSON"
      ),
    });
  });
});
