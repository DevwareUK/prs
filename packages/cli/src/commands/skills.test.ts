import { describe, expect, it } from "vitest";
import { parseSkillsCommandArgs } from "./skills";

describe("skills command", () => {
  it("accepts all and explicit Copilot telemetry choices without changing single-host defaults", () => {
    expect(parseSkillsCommandArgs(["skills", "install", "all", "--json"])).toEqual({ action: "install", host: "all", json: true });
    expect(parseSkillsCommandArgs(["skills", "install", "copilot", "--copilot-telemetry", "enable"])).toMatchObject({ host: "copilot", copilotTelemetry: "enable" });
    expect(parseSkillsCommandArgs(["skills", "install", "all", "--copilot-telemetry=disable"])).toMatchObject({ host: "all", copilotTelemetry: "disable" });
    for (const args of [["codex", "--copilot-telemetry", "enable"], ["all", "--copilot-telemetry", "yes"], ["all", "--copilot-telemetry=skip", "--copilot-telemetry=enable"]]) {
      expect(() => parseSkillsCommandArgs(["skills", "install", ...args])).toThrow();
    }
  });
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

  it("parses the GitHub Copilot installer", () => {
    expect(parseSkillsCommandArgs(["skills", "install", "copilot", "--json"])).toEqual({
      action: "install",
      host: "copilot",
      json: true,
    });
  });

  it("parses isolated parity validation", () => {
    expect(parseSkillsCommandArgs(["skills", "validate", "--json"])).toEqual({
      action: "validate",
      json: true,
    });
  });

  it("rejects unsupported or incomplete forms", () => {
    expect(() => parseSkillsCommandArgs(["skills", "install", "cursor"])).toThrow(
      "Usage: prs skills install <codex|claude-code|copilot|all>"
    );
    expect(() => parseSkillsCommandArgs(["skills", "codex"])).toThrow(
      "Usage: prs skills install <codex|claude-code|copilot|all>"
    );
  });
});
