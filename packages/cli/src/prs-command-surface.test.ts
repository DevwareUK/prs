import { describe, expect, it } from "vitest";
import { parsePrsCommandSurfaceArgs, renderPrsCommandSurfaceHelp, routePrsCommandSurfaceAction } from "./prs-command-surface";

describe("agent-neutral /prs surface", () => {
  it("routes the portable issue and PR flows", () => {
    expect(routePrsCommandSurfaceAction(parsePrsCommandSurfaceArgs(["issue", "42", "--jdi"]))).toMatchObject({
      skillName: "prs:issue", cliArgs: ["tool", "issue", "ready", "42", "--unattended", "--json"],
    });
    expect(routePrsCommandSurfaceAction(parsePrsCommandSurfaceArgs(["pr", "12"]))).toMatchObject({
      skillName: "prs:pr", cliArgs: ["tool", "pr", "ready", "12", "--json"],
    });
    expect(routePrsCommandSurfaceAction(parsePrsCommandSurfaceArgs(["finish"]))).toEqual({
      interaction: "direct", skillName: "prs:finish",
    });
  });

  it("does not expose retired review, observability, or cleanup families", () => {
    const help = renderPrsCommandSurfaceHelp();
    expect(help).not.toMatch(/review|observability|cleanup|provider|action/i);
    expect(() => parsePrsCommandSurfaceArgs(["review"])).toThrow("Usage:");
    expect(() => parsePrsCommandSurfaceArgs(["cleanup", "branches"])).toThrow("Usage:");
  });
});
