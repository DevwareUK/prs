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
      unattended: false,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["issue", "ready", "151", "--unattended", "--json"])).toEqual({
      kind: "issue-ready",
      issueNumber: 151,
      unattended: true,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["issue", "ready", "151", "--auto", "--json"])).toEqual({
      kind: "issue-ready",
      issueNumber: 151,
      unattended: true,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["issue", "ready", "151", "--jdi", "--json"])).toEqual({
      kind: "issue-ready",
      issueNumber: 151,
      unattended: true,
      json: true,
    });
  });

  it("parses issue estimate JSON command", () => {
    expect(parsePrsToolCommandArgs(["issue", "estimate", "151", "--json"])).toEqual({
      kind: "issue-estimate",
      issueNumber: 151,
      json: true,
    });
    expect(() =>
      parsePrsToolCommandArgs(["issue", "estimate", "151"])
    ).toThrow("Usage:");
  });

  it("parses Codex-mediated issue estimate context and publish commands", () => {
    expect(parsePrsToolCommandArgs(["issue", "estimate-context", "151", "--json"])).toEqual({
      kind: "issue-estimate-context",
      issueNumber: 151,
      json: true,
    });
    expect(
      parsePrsToolCommandArgs([
        "issue",
        "publish-estimate",
        "151",
        "--file",
        ".prs/runs/estimate/estimate.json",
        "--json",
      ])
    ).toEqual({
      kind: "issue-publish-estimate",
      issueNumber: 151,
      estimateFilePath: ".prs/runs/estimate/estimate.json",
      json: true,
    });
    expect(() =>
      parsePrsToolCommandArgs(["issue", "publish-estimate", "151", "--json"])
    ).toThrow("Missing required --file");
  });

  it("rejects removed --all issue readiness shorthand", () => {
    expect(() =>
      parsePrsToolCommandArgs(["issue", "ready", "151", "--all", "--json"])
    ).toThrow('Unknown tool option "--all"');
  });

  it("parses issue create JSON command", () => {
    expect(
      parsePrsToolCommandArgs([
        "issue",
        "create",
        "--draft-file",
        ".prs/issues/issue-draft.md",
        "--run-dir=.prs/runs/create",
        "--spec-file",
        ".prs/runs/create/spec.md",
        "--plan-file",
        ".prs/runs/create/plan.md",
        "--media-manifest",
        ".prs/runs/create/media.json",
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
      specFilePath: ".prs/runs/create/spec.md",
      planFilePath: ".prs/runs/create/plan.md",
      mediaManifestFilePath: ".prs/runs/create/media.json",
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
      specFilePath: undefined,
      planFilePath: undefined,
      mediaManifestFilePath: undefined,
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

  it("parses PR local Codex review JSON command", () => {
    expect(parsePrsToolCommandArgs(["pr", "review", "115", "--json"])).toEqual({
      kind: "pr-review",
      prNumber: 115,
      unattended: false,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "review", "115", "--unattended", "--json"])).toEqual({
      kind: "pr-review",
      prNumber: 115,
      unattended: true,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "review", "115", "--auto", "--json"])).toEqual({
      kind: "pr-review",
      prNumber: 115,
      unattended: true,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "review", "115", "--jdi", "--json"])).toEqual({
      kind: "pr-review",
      prNumber: 115,
      unattended: true,
      json: true,
    });
  });

  it("parses PR local Codex review publish JSON command", () => {
    expect(
      parsePrsToolCommandArgs([
        "pr",
        "publish-review",
        "115",
        "--report",
        ".prs/runs/review/codex-pr-review.md",
        "--comments",
        ".prs/runs/review/codex-pr-review-comments.json",
        "--json",
      ])
    ).toEqual({
      kind: "pr-publish-review",
      prNumber: 115,
      reportFilePath: ".prs/runs/review/codex-pr-review.md",
      commentsFilePath: ".prs/runs/review/codex-pr-review-comments.json",
      unattended: false,
      json: true,
    });
    expect(
      parsePrsToolCommandArgs([
        "pr",
        "publish-review",
        "115",
        "--report",
        ".prs/runs/review/codex-pr-review.md",
        "--comments",
        ".prs/runs/review/codex-pr-review-comments.json",
        "--unattended",
        "--json",
      ])
    ).toEqual({
      kind: "pr-publish-review",
      prNumber: 115,
      reportFilePath: ".prs/runs/review/codex-pr-review.md",
      commentsFilePath: ".prs/runs/review/codex-pr-review-comments.json",
      unattended: true,
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
    expect(parsePrsToolCommandArgs(["pr", "address-comments", "115", "--json"])).toEqual({
      kind: "pr-address-comments",
      prNumber: 115,
      selection: "all",
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "fix-comments", "115", "--json"])).toEqual({
      kind: "pr-address-comments",
      prNumber: 115,
      selection: "all",
      json: true,
    });
    expect(
      parsePrsToolCommandArgs([
        "pr",
        "add-tests",
        "116",
        "--selection",
        "1,2",
        "--json",
      ])
    ).toEqual({
      kind: "pr-add-tests",
      prNumber: 116,
      selection: "1,2",
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "fix-tests", "117", "--json"])).toEqual({
      kind: "pr-fix-tests",
      prNumber: 117,
      selection: "all",
      json: true,
    });
    expect(
      parsePrsToolCommandArgs([
        "pr",
        "fix-failing-tests",
        "118",
        "--json",
      ])
    ).toEqual({
      kind: "pr-fix-tests",
      prNumber: 118,
      selection: "all",
      json: true,
    });
  });

  it("parses PR ready JSON command", () => {
    expect(parsePrsToolCommandArgs(["pr", "ready", "115", "--json"])).toEqual({
      kind: "pr-ready",
      prNumber: 115,
      unattended: false,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "ready", "115", "--unattended", "--json"])).toEqual({
      kind: "pr-ready",
      prNumber: 115,
      unattended: true,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "ready", "115", "--auto", "--json"])).toEqual({
      kind: "pr-ready",
      prNumber: 115,
      unattended: true,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["pr", "ready", "115", "--jdi", "--json"])).toEqual({
      kind: "pr-ready",
      prNumber: 115,
      unattended: true,
      json: true,
    });
  });

  it("parses local branch cleanup JSON command", () => {
    expect(parsePrsToolCommandArgs(["branches", "cleanup", "--json"])).toEqual({
      kind: "branches-cleanup",
      apply: false,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["branches", "cleanup", "--apply", "--json"])).toEqual({
      kind: "branches-cleanup",
      apply: true,
      json: true,
    });
  });

  it("parses worktree cleanup JSON command", () => {
    expect(parsePrsToolCommandArgs(["worktrees", "cleanup", "--json"])).toEqual({
      kind: "worktrees-cleanup",
      apply: false,
      json: true,
    });
    expect(parsePrsToolCommandArgs(["worktrees", "cleanup", "--apply", "--json"])).toEqual({
      kind: "worktrees-cleanup",
      apply: true,
      json: true,
    });
  });

  it("rejects removed --all PR readiness shorthand", () => {
    expect(() =>
      parsePrsToolCommandArgs(["pr", "ready", "115", "--all", "--json"])
    ).toThrow('Unknown tool option "--all"');
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
    expect(() => parsePrsToolCommandArgs(["branches", "cleanup"])).toThrow(
      "prs tool branches cleanup requires --json."
    );
    expect(() => parsePrsToolCommandArgs(["worktrees", "cleanup"])).toThrow(
      "prs tool worktrees cleanup requires --json."
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
