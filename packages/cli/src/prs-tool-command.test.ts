import { describe, expect, it } from "vitest";
import { parsePrsToolCommandArgs, renderPrsToolCommandHelp } from "./prs-tool-command";

describe("prs tool command parser", () => {
  it("parses actionable issue list JSON command", () => {
    expect(parsePrsToolCommandArgs(["issue", "list", "--actionable", "--json"])).toEqual({
      kind: "issue-list",
      actionable: true,
      json: true,
    });
  });

  it("parses issue ready JSON command", () => {
    expect(parsePrsToolCommandArgs(["issue", "ready", "151", "--json"])).toEqual({
      kind: "issue-ready",
      issueNumber: 151,
      all: false,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["issue", "ready", "151", "--all", "--json"])).toEqual({
      kind: "issue-ready",
      issueNumber: 151,
      all: true,
      json: true,
    });
  });

  it("parses issue create JSON command", () => {
    expect(
      parsePrsToolCommandArgs([
        "issue",
        "create",
        "--draft-file",
        ".prs/issues/issue-draft.md",
        "--run-dir=.prs/runs/create",
        "--plan-file",
        ".prs/runs/create/plan.md",
        "--label",
        "bug",
        "--labels=prs,approved",
        "--force-prs-managed",
        "--json",
      ])
    ).toEqual({
      kind: "issue-create",
      draftFilePath: ".prs/issues/issue-draft.md",
      issueSetFilePath: undefined,
      runDir: ".prs/runs/create",
      planFilePath: ".prs/runs/create/plan.md",
      labels: ["bug", "prs", "approved"],
      forcePrsManaged: true,
      json: true,
    });

    expect(
      parsePrsToolCommandArgs([
        "issue",
        "create",
        "--issue-set=.prs/runs/create/issue-set.json",
        "--json",
      ])
    ).toEqual({
      kind: "issue-create",
      draftFilePath: undefined,
      issueSetFilePath: ".prs/runs/create/issue-set.json",
      runDir: undefined,
      planFilePath: undefined,
      labels: [],
      forcePrsManaged: false,
      json: true,
    });
  });

  it("parses actionable PR list JSON command", () => {
    expect(parsePrsToolCommandArgs(["pr", "list", "--actionable", "--json"])).toEqual({
      kind: "pr-list",
      actionable: true,
      json: true,
    });
  });

  it("parses full PR list JSON command", () => {
    expect(parsePrsToolCommandArgs(["pr", "list", "--json"])).toEqual({
      kind: "pr-list",
      actionable: false,
      json: true,
    });
  });

  it("parses PR prepare-review JSON command", () => {
    expect(parsePrsToolCommandArgs(["pr", "prepare-review", "115", "--json"])).toEqual({
      kind: "pr-prepare-review",
      prNumber: 115,
      json: true,
    });
  });

  it("parses PR guarded push JSON command", () => {
    expect(parsePrsToolCommandArgs(["pr", "push-reviewed", "115", "--json"])).toEqual({
      kind: "pr-push-reviewed",
      prNumber: 115,
      json: true,
    });
  });

  it("parses skill-first PR fix preparation JSON commands", () => {
    expect(parsePrsToolCommandArgs(["pr", "fix-comments", "115", "--json"])).toEqual({
      kind: "pr-fix-comments",
      prNumber: 115,
      selection: "all",
      json: true,
    });
    expect(
      parsePrsToolCommandArgs([
        "pr",
        "fix-tests",
        "116",
        "--selection",
        "1,2",
        "--json",
      ])
    ).toEqual({
      kind: "pr-fix-tests",
      prNumber: 116,
      selection: "1,2",
      json: true,
    });
    expect(
      parsePrsToolCommandArgs([
        "pr",
        "fix-failing-tests",
        "117",
        "--json",
      ])
    ).toEqual({
      kind: "pr-fix-failing-tests",
      prNumber: 117,
      selection: "all",
      json: true,
    });
  });

  it("parses PR ready JSON command", () => {
    expect(parsePrsToolCommandArgs(["pr", "ready", "115", "--json"])).toEqual({
      kind: "pr-ready",
      prNumber: 115,
      all: false,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "ready", "115", "--all", "--json"])).toEqual({
      kind: "pr-ready",
      prNumber: 115,
      all: true,
      json: true,
    });
  });

  it("rejects non-numeric PR numbers", () => {
    expect(() => parsePrsToolCommandArgs(["pr", "prepare-review", "abc", "--json"])).toThrow(
      'Invalid prs tool pr number: "abc".'
    );
    expect(() => parsePrsToolCommandArgs(["issue", "ready", "abc", "--json"])).toThrow(
      'Invalid prs tool issue number: "abc".'
    );
  });

  it("rejects unsupported forms with help", () => {
    expect(() => parsePrsToolCommandArgs(["pr", "list"])).toThrow(renderPrsToolCommandHelp());
    expect(() => parsePrsToolCommandArgs(["pr", "list", "--actionable"])).toThrow(
      renderPrsToolCommandHelp()
    );
    expect(() => parsePrsToolCommandArgs(["pr", "checkout"])).toThrow(
      renderPrsToolCommandHelp()
    );
    expect(() => parsePrsToolCommandArgs(["pr", "prepare-review", "--json"])).toThrow(
      renderPrsToolCommandHelp()
    );
    expect(() => parsePrsToolCommandArgs(["issue", "list"])).toThrow(
      renderPrsToolCommandHelp()
    );
    expect(() =>
      parsePrsToolCommandArgs(["issue", "create", "--draft-file", "draft.md"])
    ).toThrow("prs tool issue create requires --json.");
    expect(() =>
      parsePrsToolCommandArgs([
        "issue",
        "create",
        "--draft-file",
        "draft.md",
        "--issue-set",
        "issue-set.json",
        "--json",
      ])
    ).toThrow("Provide exactly one of --draft-file or --issue-set.");
    expect(() => parsePrsToolCommandArgs(["unknown"])).toThrow(renderPrsToolCommandHelp());
  });
});
