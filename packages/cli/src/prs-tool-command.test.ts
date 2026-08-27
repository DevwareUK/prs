import { describe, expect, it } from "vitest";
import { parsePrsToolCommandArgs, renderPrsToolCommandHelp } from "./prs-tool-command";

describe("provider-free prs tool command parser", () => {
  it("parses issue and pull-request discovery/readiness commands", () => {
    expect(parsePrsToolCommandArgs(["issue", "list", "--actionable", "--json"])).toEqual({
      kind: "issue-list", actionable: true, json: true,
    });
    expect(parsePrsToolCommandArgs(["issue", "context", "151", "--json"])).toEqual({
      kind: "issue-context", issueNumber: 151, json: true,
    });
    expect(parsePrsToolCommandArgs(["issue", "ready", "151", "--jdi", "--json"])).toEqual({
      kind: "issue-ready", issueNumber: 151, unattended: true, json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "list", "--json"])).toEqual({
      kind: "pr-list", actionable: false, json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "ready", "42", "--json"])).toEqual({
      kind: "pr-ready", prNumber: 42, unattended: false, json: true,
    });
  });

  it("parses approved issue artifact publication", () => {
    expect(parsePrsToolCommandArgs([
      "issue", "publish-artifacts", "151", "--spec-file", "spec.md", "--plan-file=plan.md", "--json",
    ])).toEqual({
      kind: "issue-publish-artifacts", issueNumber: 151,
      specFilePath: "spec.md", planFilePath: "plan.md", json: true,
    });
  });

  it("parses single and linked-set issue creation", () => {
    expect(parsePrsToolCommandArgs([
      "issue", "create", "--draft-file", "issue.md", "--labels=bug,prs", "--force-prs-managed", "--json",
    ])).toMatchObject({
      kind: "issue-create", draftFilePath: "issue.md", labels: ["bug", "prs"], forcePrsManaged: true, json: true,
    });
    expect(parsePrsToolCommandArgs([
      "issue", "create", "--issue-set=set.json", "--run-dir", ".prs/runs/create", "--json",
    ])).toMatchObject({
      kind: "issue-create", issueSetFilePath: "set.json", runDir: ".prs/runs/create", json: true,
    });
  });

  it("requires JSON and rejects removed provider-backed commands", () => {
    expect(() => parsePrsToolCommandArgs(["issue", "context", "151"])).toThrow("Usage:");
    expect(() => parsePrsToolCommandArgs(["issue", "estimate", "151", "--json"])).toThrow("Usage:");
    expect(() => parsePrsToolCommandArgs(["pr", "review", "42", "--json"])).toThrow("Usage:");
    expect(renderPrsToolCommandHelp()).not.toMatch(/provider|estimate|review|token-usage/i);
  });
});
