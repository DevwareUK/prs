import { describe, expect, it } from "vitest";
import { CODEX_RETIRED_MESSAGE, parseCodexCommandArgs } from "./codex";

function parseNumber(rawValue: string | undefined): number {
  if (!rawValue || !/^\d+$/.test(rawValue)) {
    throw new Error(`Invalid number: ${rawValue ?? ""}`);
  }

  return Number.parseInt(rawValue, 10);
}

describe("codex command parser", () => {
  it("retires explicit Codex issue launchers", () => {
    expect(() => parseCodexCommandArgs(["codex", "issue", "123"], parseNumber)).toThrow(
      CODEX_RETIRED_MESSAGE
    );
    expect(
      () => parseCodexCommandArgs(
        ["codex", "issue", "123", "--mode", "unattended"],
        parseNumber
      )
    ).toThrow(CODEX_RETIRED_MESSAGE);
  });

  it("retires explicit unattended Codex issue batches", () => {
    expect(
      () => parseCodexCommandArgs(
        ["codex", "issue", "batch", "123", "124", "--mode=unattended"],
        parseNumber
      )
    ).toThrow(CODEX_RETIRED_MESSAGE);
  });

  it("retires explicit Codex PR launchers", () => {
    expect(
      () => parseCodexCommandArgs(["codex", "pr", "prepare-review", "115"], parseNumber)
    ).toThrow(CODEX_RETIRED_MESSAGE);
    expect(
      () => parseCodexCommandArgs(["codex", "pr", "resolve-conflicts", "116"], parseNumber)
    ).toThrow(CODEX_RETIRED_MESSAGE);
  });

  it("uses one migration message for unsupported or ambiguous Codex forms", () => {
    expect(() =>
      parseCodexCommandArgs(["codex", "issue", "123", "--mode", "interactive"], parseNumber)
    ).toThrow(CODEX_RETIRED_MESSAGE);
    expect(() =>
      parseCodexCommandArgs(["codex", "issue", "123", "--mode"], parseNumber)
    ).toThrow(CODEX_RETIRED_MESSAGE);
    expect(() =>
      parseCodexCommandArgs(["codex", "issue", "batch", "123"], parseNumber)
    ).toThrow(CODEX_RETIRED_MESSAGE);
    expect(() =>
      parseCodexCommandArgs(["codex", "pr", "fix-comments", "115"], parseNumber)
    ).toThrow(CODEX_RETIRED_MESSAGE);
  });
});
