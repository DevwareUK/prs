import { describe, expect, it } from "vitest";
import { parseIssueCommandArgs } from "./commands/issue";
import { buildIssueCommitMessage } from "./issue-finalize-tool";

describe("deterministic issue finalization", () => {
  it("keeps only the documented finalize command", () => {
    expect(parseIssueCommandArgs(["issue", "finalize", "42"])).toEqual({
      action: "finalize", issueNumber: 42,
    });
    expect(() => parseIssueCommandArgs(["issue", "42", "--jdi"])).toThrow("Usage:");
  });

  it("builds commit text without a model provider", () => {
    expect(buildIssueCommitMessage(42, {
      title: "Keep the CLI deterministic", body: "", url: "https://example.test/42",
    })).toBe("feat: resolve issue #42\n\nIssue: Keep the CLI deterministic");
  });
});
