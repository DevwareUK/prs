import { describe, expect, it } from "vitest";
import { PRDescriptionOutput } from "./pr-description";

describe("PRDescriptionOutput", () => {
  it("parses a valid description payload", () => {
    const parsed = PRDescriptionOutput.parse({
      title: "feat: add baseline vitest wiring",
      body: "Introduces a shared test harness for the monorepo.",
    });

    expect(parsed).toEqual({
      title: "feat: add baseline vitest wiring",
      body: "Introduces a shared test harness for the monorepo.",
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
