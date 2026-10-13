import { describe, expect, it } from "vitest";
import { createRepositoryForge } from "./forge";
import { resolveRepositoryConfig } from "@prs/core";

describe("separate integration contracts", () => {
  it("exposes PR capabilities without issue operations for either forge type", () => {
    for (const type of ["github", "none"] as const) {
      const forge = createRepositoryForge("/unused", resolveRepositoryConfig({forge: {type}}));
      expect(typeof forge.fetchPullRequestDetails).toBe("function");
      expect("fetchIssueDetails" in forge).toBe(false);
      expect("createOrReuseIssue" in forge).toBe(false);
    }
  });
});

it("disabled tracker listing blocks without repository or GitHub access", async () => {
  const { createIssueTracker } = await import("./issue-tracker");
  const tracker = createIssueTracker("/unused", resolveRepositoryConfig({forge: {type: "github"}, issueTracker: {type: "none"}}));
  expect(await tracker.listIssues({actionable: false})).toMatchObject({status: "blocked", reason: "issue-tracker-disabled"});
  await expect(tracker.fetchIssueDetails(373)).rejects.toThrow("issueTracker.type");
});

it("forge listing blocks when forge is disabled even if the tracker is enabled", async () => {
  const forge = createRepositoryForge("/unused", resolveRepositoryConfig({forge: {type: "none"}, issueTracker: {type: "github"}}));
  expect(await forge.listPullRequests({actionable: false})).toMatchObject({status: "blocked", reason: "forge-disabled"});
});
