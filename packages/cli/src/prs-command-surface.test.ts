import { describe, expect, it } from "vitest";
import {
  buildPrsInteractivePickerModel,
  parsePrsCommandSurfaceArgs,
  renderPrsCommandSurfaceHelp,
  routePrsCommandSurfaceAction,
} from "./prs-command-surface";

describe("prs command surface", () => {
  it("parses root interactive command", () => {
    expect(parsePrsCommandSurfaceArgs([])).toEqual({ kind: "root", mode: "interactive" });
  });

  it("parses interactive issue picker", () => {
    expect(parsePrsCommandSurfaceArgs(["issue"])).toEqual({
      kind: "issue",
      mode: "interactive",
    });
  });

  it("parses create routes for new work items", () => {
    expect(parsePrsCommandSurfaceArgs(["create"])).toEqual({
      kind: "create",
      target: "issue",
    });
    expect(parsePrsCommandSurfaceArgs(["create", "issue"])).toEqual({
      kind: "create",
      target: "issue",
    });
  });

  it("parses review routes for repo health and diff review", () => {
    expect(parsePrsCommandSurfaceArgs(["review"])).toEqual({
      kind: "review",
      mode: "interactive",
    });
    expect(parsePrsCommandSurfaceArgs(["review", "diff", "--base", "origin/main"])).toEqual({
      kind: "review",
      mode: "direct",
      action: "diff",
      passthroughArgs: ["--base", "origin/main"],
    });
    expect(parsePrsCommandSurfaceArgs(["review", "tests", "--top", "4"])).toEqual({
      kind: "review",
      mode: "direct",
      action: "tests",
      passthroughArgs: ["--top", "4"],
    });
    expect(parsePrsCommandSurfaceArgs(["review", "features", ".", "--top", "2"])).toEqual({
      kind: "review",
      mode: "direct",
      action: "features",
      passthroughArgs: [".", "--top", "2"],
    });
  });

  it("parses direct issue work", () => {
    expect(parsePrsCommandSurfaceArgs(["issue", "123"])).toEqual({
      kind: "issue",
      mode: "direct",
      issueNumber: 123,
      action: "work",
      all: false,
    });
    expect(parsePrsCommandSurfaceArgs(["issue", "123", "--all"])).toEqual({
      kind: "issue",
      mode: "direct",
      issueNumber: 123,
      action: "work",
      all: true,
    });
  });

  it("parses direct issue subactions", () => {
    expect(parsePrsCommandSurfaceArgs(["issue", "123", "refine"])).toEqual({
      kind: "issue",
      mode: "direct",
      issueNumber: 123,
      action: "refine",
    });
    expect(parsePrsCommandSurfaceArgs(["issue", "123", "plan"])).toEqual({
      kind: "issue",
      mode: "direct",
      issueNumber: 123,
      action: "plan",
    });
    expect(parsePrsCommandSurfaceArgs(["issue", "123", "finish"])).toEqual({
      kind: "issue",
      mode: "direct",
      issueNumber: 123,
      action: "finish",
    });
  });

  it("parses interactive PR picker and direct PR dashboard", () => {
    expect(parsePrsCommandSurfaceArgs(["pr"])).toEqual({ kind: "pr", mode: "interactive" });
    expect(parsePrsCommandSurfaceArgs(["pr", "456"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "choose",
      all: false,
    });
    expect(parsePrsCommandSurfaceArgs(["pr", "456", "--all"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "choose",
      all: true,
    });
  });

  it("parses direct PR actions in object-first order", () => {
    expect(parsePrsCommandSurfaceArgs(["pr", "456", "resolve-conflicts"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "resolve-conflicts",
    });
    expect(parsePrsCommandSurfaceArgs(["pr", "456", "prepare-review"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "prepare-review",
    });
    expect(parsePrsCommandSurfaceArgs(["pr", "456", "address-comments"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "address-comments",
    });
    expect(parsePrsCommandSurfaceArgs(["pr", "456", "fix-comments"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "address-comments",
    });
    expect(parsePrsCommandSurfaceArgs(["pr", "456", "fix-tests"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "fix-tests",
    });
    expect(parsePrsCommandSurfaceArgs(["pr", "456", "fix-failing-tests"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "fix-tests",
    });
    expect(parsePrsCommandSurfaceArgs(["pr", "456", "add-tests"])).toEqual({
      kind: "pr",
      mode: "direct",
      prNumber: 456,
      action: "add-tests",
    });
  });

  it("parses audit publish and finish", () => {
    expect(parsePrsCommandSurfaceArgs(["audit", "publish"])).toEqual({
      kind: "audit",
      action: "publish",
      passthroughArgs: [],
    });
    expect(
      parsePrsCommandSurfaceArgs([
        "audit",
        "publish",
        "--issue",
        "123",
        "--file",
        ".prs/runs/example/spec.md",
        "--section",
        "Spec",
      ])
    ).toEqual({
      kind: "audit",
      action: "publish",
      passthroughArgs: [
        "--issue",
        "123",
        "--file",
        ".prs/runs/example/spec.md",
        "--section",
        "Spec",
      ],
    });
    expect(parsePrsCommandSurfaceArgs(["finish"])).toEqual({ kind: "finish" });
  });

  it("rejects unsupported forms with command help", () => {
    expect(() => parsePrsCommandSurfaceArgs(["pr", "resolve-conflicts", "456"])).toThrow(
      renderPrsCommandSurfaceHelp()
    );
    expect(() => parsePrsCommandSurfaceArgs(["create", "story"])).toThrow(
      renderPrsCommandSurfaceHelp()
    );
    expect(() => parsePrsCommandSurfaceArgs(["review", "coverage"])).toThrow(
      renderPrsCommandSurfaceHelp()
    );
    expect(() => parsePrsCommandSurfaceArgs(["issue", "abc"])).toThrow(
      "Invalid /prs issue number"
    );
    expect(() => parsePrsCommandSurfaceArgs(["unknown"])).toThrow(renderPrsCommandSurfaceHelp());
  });
});

describe("prs command surface routing", () => {
  it("routes create actions to issue draft creation", () => {
    expect(routePrsCommandSurfaceAction({ kind: "create", target: "issue" })).toEqual({
      interaction: "direct",
      skillName: "prs:start-issue-work",
      cliArgs: ["issue", "draft"],
      target: { type: "create", name: "issue" },
    });
  });

  it("routes review actions to the existing review and backlog commands", () => {
    expect(routePrsCommandSurfaceAction({ kind: "review", mode: "interactive" })).toEqual({
      interaction: "interactive",
      skillName: "prs:review",
      cliArgs: undefined,
      target: { type: "review", name: "tests" },
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "review",
        mode: "direct",
        action: "diff",
        passthroughArgs: ["--base", "origin/main"],
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs:review",
      cliArgs: ["review", "--base", "origin/main"],
      target: { type: "review", name: "diff" },
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "review",
        mode: "direct",
        action: "tests",
        passthroughArgs: ["--top", "4"],
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs:review",
      cliArgs: ["test-backlog", "--top", "4"],
      target: { type: "review", name: "tests" },
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "review",
        mode: "direct",
        action: "features",
        passthroughArgs: [".", "--top", "2"],
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs:review",
      cliArgs: ["feature-backlog", ".", "--top", "2"],
      target: { type: "review", name: "features" },
    });
  });

  it("routes issue actions to existing CLI commands and skills", () => {
    expect(routePrsCommandSurfaceAction({ kind: "issue", mode: "interactive" })).toEqual({
      interaction: "interactive",
      skillName: "prs",
      cliArgs: undefined,
      picker: "actionable-issues",
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "issue",
        mode: "direct",
        issueNumber: 123,
        action: "work",
        all: false,
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["tool", "issue", "ready", "123", "--json"],
      target: { type: "issue", number: 123 },
      toolOnly: true,
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "issue",
        mode: "direct",
        issueNumber: 123,
        action: "work",
        all: true,
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["tool", "issue", "ready", "123", "--all", "--json"],
      target: { type: "issue", number: 123 },
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "issue",
        mode: "direct",
        issueNumber: 123,
        action: "refine",
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs:start-issue-work",
      cliArgs: ["issue", "refine", "123"],
      target: { type: "issue", number: 123 },
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "issue",
        mode: "direct",
        issueNumber: 123,
        action: "plan",
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs:start-issue-work",
      cliArgs: ["issue", "plan", "123"],
      target: { type: "issue", number: 123 },
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "issue",
        mode: "direct",
        issueNumber: 123,
        action: "finish",
      })
    ).toEqual({
      interaction: "interactive",
      skillName: "prs:finish-work",
      cliArgs: undefined,
      target: { type: "issue", number: 123 },
    });
  });

  it("routes PR actions to existing CLI commands", () => {
    expect(routePrsCommandSurfaceAction({ kind: "pr", mode: "interactive" })).toEqual({
      interaction: "interactive",
      skillName: "prs",
      cliArgs: undefined,
      picker: "actionable-pull-requests",
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "pr",
        mode: "direct",
        prNumber: 456,
        action: "choose",
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["tool", "pr", "ready", "456", "--json"],
      target: { type: "pull-request", number: 456 },
      toolOnly: true,
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "pr",
        mode: "direct",
        prNumber: 456,
        action: "choose",
        all: true,
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["tool", "pr", "ready", "456", "--all", "--json"],
      target: { type: "pull-request", number: 456 },
      toolOnly: true,
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "pr",
        mode: "direct",
        prNumber: 456,
        action: "prepare-review",
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["tool", "pr", "prepare-review", "456", "--json"],
      target: { type: "pull-request", number: 456 },
      toolOnly: true,
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "pr",
        mode: "direct",
        prNumber: 456,
        action: "resolve-conflicts",
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["pr", "resolve-conflicts", "456"],
      target: { type: "pull-request", number: 456 },
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "pr",
        mode: "direct",
        prNumber: 456,
        action: "address-comments",
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["tool", "pr", "address-comments", "456", "--json"],
      target: { type: "pull-request", number: 456 },
      toolOnly: true,
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "pr",
        mode: "direct",
        prNumber: 456,
        action: "fix-tests",
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["tool", "pr", "fix-tests", "456", "--json"],
      target: { type: "pull-request", number: 456 },
      toolOnly: true,
    });
    expect(
      routePrsCommandSurfaceAction({
        kind: "pr",
        mode: "direct",
        prNumber: 456,
        action: "add-tests",
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["tool", "pr", "add-tests", "456", "--json"],
      target: { type: "pull-request", number: 456 },
      toolOnly: true,
    });
  });

  it("routes audit and finish actions", () => {
    expect(
      routePrsCommandSurfaceAction({
        kind: "audit",
        action: "publish",
        passthroughArgs: ["--issue", "123"],
      })
    ).toEqual({
      interaction: "direct",
      skillName: "prs:publish-audit",
      cliArgs: ["audit", "publish", "--issue", "123"],
    });
    expect(routePrsCommandSurfaceAction({ kind: "finish" })).toEqual({
      interaction: "interactive",
      skillName: "prs:finish-work",
      cliArgs: undefined,
    });
  });
});

describe("prs interactive picker models", () => {
  it("applies actionable issue filtering to the interactive issue picker", () => {
    const model = buildPrsInteractivePickerModel(
      { kind: "issue", mode: "interactive" },
      {
        currentUser: "me",
        issues: [
          {
            number: 1,
            title: "Mine",
            url: "https://github.com/DevwareUK/prs/issues/1",
            author: "me",
            assignees: [],
            labels: [],
            updatedAt: "2026-05-01T10:00:00Z",
            hasLinkedOpenPullRequest: false,
            hasPrsPlan: false,
          },
          {
            number: 2,
            title: "Already has PR",
            url: "https://github.com/DevwareUK/prs/issues/2",
            author: "me",
            assignees: ["me"],
            labels: ["ready"],
            updatedAt: "2026-05-02T10:00:00Z",
            hasLinkedOpenPullRequest: true,
            hasPrsPlan: true,
          },
        ],
      }
    );

    expect(model).toEqual({
      kind: "issues",
      items: [
        {
          number: 1,
          title: "Mine",
          url: "https://github.com/DevwareUK/prs/issues/1",
          author: "me",
          assignees: [],
          labels: [],
          updatedAt: "2026-05-01T10:00:00Z",
          hasLinkedOpenPullRequest: false,
          hasPrsPlan: false,
        },
      ],
    });
  });

  it("applies actionable PR filtering to the interactive PR picker", () => {
    const model = buildPrsInteractivePickerModel(
      { kind: "pr", mode: "interactive" },
      {
        currentUser: "me",
        pullRequests: [
          {
            number: 10,
            title: "Conflicts",
            url: "https://github.com/DevwareUK/prs/pull/10",
            author: "alice",
            assignees: [],
            reviewRequestedFrom: [],
            headRefName: "feat/conflicts",
            labels: [],
            updatedAt: "2026-05-01T10:00:00Z",
            hasConflicts: true,
            hasFailedChecks: false,
            hasUnresolvedReviewComments: false,
            hasPrsTestSuggestions: false,
          },
          {
            number: 11,
            title: "Not actionable",
            url: "https://github.com/DevwareUK/prs/pull/11",
            author: "alice",
            assignees: [],
            reviewRequestedFrom: [],
            headRefName: "feat/other",
            labels: [],
            updatedAt: "2026-05-02T10:00:00Z",
            hasConflicts: false,
            hasFailedChecks: false,
            hasUnresolvedReviewComments: false,
            hasPrsTestSuggestions: false,
          },
        ],
      }
    );

    expect(model).toEqual({
      kind: "pull-requests",
      items: [
        {
          number: 10,
          title: "Conflicts",
          url: "https://github.com/DevwareUK/prs/pull/10",
          author: "alice",
          assignees: [],
          reviewRequestedFrom: [],
          headRefName: "feat/conflicts",
          labels: [],
          updatedAt: "2026-05-01T10:00:00Z",
          hasConflicts: true,
          hasFailedChecks: false,
          hasUnresolvedReviewComments: false,
          hasPrsTestSuggestions: false,
        },
      ],
    });
  });

  it("only builds picker models for interactive list actions", () => {
    expect(
      buildPrsInteractivePickerModel(
        { kind: "issue", mode: "direct", issueNumber: 123, action: "work", all: false },
        { currentUser: "me", issues: [] }
      )
    ).toBeUndefined();
    expect(
      buildPrsInteractivePickerModel(
        { kind: "pr", mode: "direct", prNumber: 456, action: "choose" },
        { currentUser: "me", pullRequests: [] }
      )
    ).toBeUndefined();
  });
});
