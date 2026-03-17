import { describe, expect, it } from "vitest";
import { PRDescriptionOutput } from "./pr-description";

describe("PRDescriptionOutput", () => {
  it("parses a valid description payload with optional notes", () => {
    const parsed = PRDescriptionOutput.parse({
      title: "feat: add baseline vitest wiring",
      body: "Introduces a shared test harness for the monorepo.",
      testingNotes: "Ran pnpm test",
      riskNotes: "Low risk because coverage is smoke-test only.",
    });

    expect(parsed).toEqual({
      title: "feat: add baseline vitest wiring",
      body: "Introduces a shared test harness for the monorepo.",
      testingNotes: "Ran pnpm test",
      riskNotes: "Low risk because coverage is smoke-test only.",
    });
  });

  it("rejects empty required fields", () => {
    expect(() =>
      PRDescriptionOutput.parse({
        title: "   ",
        body: "Valid body",
      })
    ).toThrow();
  });
});
