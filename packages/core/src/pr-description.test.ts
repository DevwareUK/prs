import { describe, expect, it } from "vitest";
import { StructuredGenerationError } from "./structured-generation-error";
import { generatePRDescription } from "./pr-description";

describe("generatePRDescription", () => {
  it("surfaces JSON parsing failures with the raw model response", async () => {
    await expect(
      generatePRDescription(
        {
          generateText: async () => '{"title":"feat: broken"',
        },
        {
          diff: "diff --git a/file.ts b/file.ts",
        }
      )
    ).rejects.toMatchObject({
      name: "StructuredGenerationError",
      kind: "json_parse",
      rawResponse: '{"title":"feat: broken"',
      message: expect.stringContaining(
        "Failed to parse PR description model output as JSON"
      ),
    });
  });

  it("surfaces readable field-level validation details for missing required fields", async () => {
    await expect(
      generatePRDescription(
        {
          generateText: async () =>
            JSON.stringify({
              title: "feat: add diagnostics",
            }),
        },
        {
          diff: "diff --git a/file.ts b/file.ts",
        }
      )
    ).rejects.toMatchObject({
      name: "StructuredGenerationError",
      kind: "schema_validation",
      message: expect.stringContaining("body: Invalid input: expected string, received undefined"),
      validationIssues: [
        {
          path: "body",
          message: "Invalid input: expected string, received undefined",
          code: "invalid_type",
        },
      ],
    });
  });

  it("surfaces readable field-level validation details for wrong field types", async () => {
    await expect(
      generatePRDescription(
        {
          generateText: async () =>
            JSON.stringify({
              title: 42,
              body: true,
            }),
        },
        {
          diff: "diff --git a/file.ts b/file.ts",
        }
      )
    ).rejects.toMatchObject({
      name: "StructuredGenerationError",
      kind: "schema_validation",
      message: expect.stringContaining("title: Invalid input: expected string, received number"),
    });
  });

  it("parses a valid title/body payload", async () => {
    const result = await generatePRDescription(
      {
        generateText: async () =>
          JSON.stringify({
            title: "feat: harden PR description diagnostics",
            body: "Adds better failure handling for PR description generation.",
          }),
      },
      {
        diff: "diff --git a/file.ts b/file.ts",
      }
    );

    expect(result.title).toBe("feat: harden PR description diagnostics");
    expect(result.body).toBe(
      "Adds better failure handling for PR description generation."
    );
  });

  it("preserves parsed payloads on schema validation errors", async () => {
    let error: unknown;

    try {
      await generatePRDescription(
        {
          generateText: async () =>
            JSON.stringify({
              title: "feat: harden PR description diagnostics",
              body: 42,
            }),
        },
        {
          diff: "diff --git a/file.ts b/file.ts",
        }
      );
    } catch (caughtError: unknown) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(StructuredGenerationError);
    expect(error).toMatchObject({
      kind: "schema_validation",
      parsedJson: {
        title: "feat: harden PR description diagnostics",
        body: 42,
      },
      normalizedJson: {
        title: "feat: harden PR description diagnostics",
        body: 42,
      },
    });
  });
});
