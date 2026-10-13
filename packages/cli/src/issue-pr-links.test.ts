import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
import { createIssuePullRequestLinks } from "./issue-pr-links";

const issue = {provider: "github", scope: "DevwareUK/prs", key: "373", url: "https://github.com/DevwareUK/prs/issues/373"};
function repository() {
  const root = mkdtempSync(join(tmpdir(), "prs-links-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "remote", "add", "origin", "git@github.com:DevwareUK/prs.git"]);
  return root;
}
describe("issue to PR integration boundary", () => {
  it.each([{forge: {type: "none"}, issueTracker: {type: "github"}}, {forge: {type: "github"}, issueTracker: {type: "none"}}] as const)("returns unavailable for a disabled integration without accessing a repository", async config => {
    const links = createIssuePullRequestLinks("/not-a-repository", resolveRepositoryConfig(config));
    expect(await links.findLinkedPullRequests(issue)).toMatchObject({status: "unavailable"});
    expect(links.formatClosingReference(issue)).toBeUndefined();
  });
  it("only produces GitHub closing references for a qualified same-scope issue", async () => {
    const links = createIssuePullRequestLinks(repository(), resolveRepositoryConfig());
    expect(links.formatClosingReference(issue)).toBe("#373");
    for (const invalid of [
      {...issue, provider: "linear", key: "PROJ-123"},
      {...issue, scope: "Other/repo"},
      {...issue, key: "PROJ-123"},
      {...issue, key: "0"},
      {...issue, url: "https://github.com/Other/repo/issues/373"},
    ]) {
      expect(links.formatClosingReference(invalid)).toBeUndefined();
      expect(await links.findLinkedPullRequests(invalid)).toMatchObject({status: "unavailable"});
    }
  });
});
