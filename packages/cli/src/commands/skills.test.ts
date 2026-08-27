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

  it("parses the Claude Code installer", () => {
    expect(parseSkillsCommandArgs(["skills", "install", "claude-code", "--json"])).toEqual({
      action: "install",
      host: "claude-code",
      json: true,
    });
  });

  it("rejects unsupported or incomplete forms", () => {
    expect(() => parseSkillsCommandArgs(["skills", "install", "copilot"])).toThrow(
      "Usage: prs skills install <codex|claude-code> [--json]"
    );
    expect(() => parseSkillsCommandArgs(["skills", "codex"])).toThrow(
      "Usage: prs skills install <codex|claude-code> [--json]"
    );
  });
});
