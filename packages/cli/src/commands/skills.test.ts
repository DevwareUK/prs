import { describe, expect, it } from "vitest";
import { parseSkillsCommandArgs } from "./skills";

describe("skills command", () => {
  it("parses the Codex installer", () => {
    expect(parseSkillsCommandArgs(["skills", "install", "codex", "--json"])).toEqual({
      action: "install",
      host: "codex",
      json: true,
    });
  });

  it("rejects unsupported or incomplete forms", () => {
    expect(() => parseSkillsCommandArgs(["skills", "install", "claude-code"])).toThrow(
      "Usage: prs skills install codex [--json]"
    );
    expect(() => parseSkillsCommandArgs(["skills", "codex"])).toThrow(
      "Usage: prs skills install codex [--json]"
    );
  });
});
