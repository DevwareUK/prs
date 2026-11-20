import { expect, it } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
import { resolveIssueCreateDefaults } from "./issue-create-defaults";
it("replaces main-board columns for subtasks and preserves explicit null values", () => {
    const config = resolveRepositoryConfig({ issueTracker: { type: "monday", defaults: { groupId: "topics", columnValues: { task_epic: { item_ids: ["3276311061"] }, note: "base" } }, monday: { boardId: "5105675010", defaultsByBoard: { "5105675017": { columnValues: { note: "sub", estimate: 3 } } } } } });
    expect(resolveIssueCreateDefaults(config, { boardId: "5105675017", isSubitem: true }, { columnValues: { note: null } })).toEqual({ type: "monday", columnValues: { note: null, estimate: 3 } });
    expect(config.issueTracker.defaults).toMatchObject({ columnValues: { note: "base" } });
});
it("copies source metadata over defaults before explicit task choices", () => {
    const config = resolveRepositoryConfig({ issueTracker: { type: "monday", defaults: { columnValues: { note: "base", priority: { label: "Low" } } }, monday: { boardId: "1" } } });
    expect(resolveIssueCreateDefaults(config, { boardId: "1", isSubitem: false }, { copiedColumnValues: { note: "source" }, columnValues: { priority: { label: "High" } } })).toEqual({ type: "monday", columnValues: { note: "source", priority: { label: "High" } } });
});
it("unions default Github labels and forwards assignees/milestone", () => {
    const config = resolveRepositoryConfig({ issueTracker: { type: "github", defaults: { labels: ["ready", "with spaces"], assignees: ["person"], milestone: 2 } } });
    expect(resolveIssueCreateDefaults(config, { isSubitem: false }, { labels: ["ready", "bug"] })).toEqual({ type: "github", labels: ["ready", "with spaces", "bug"], assignees: ["person"], milestone: 2 });
});
