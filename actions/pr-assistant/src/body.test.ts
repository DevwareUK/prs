import { describe, expect, it } from "vitest";
import {
  buildPRAssistantSection,
  mergePRAssistantSection,
  PR_ASSISTANT_END_MARKER,
  PR_ASSISTANT_START_MARKER,
  stripManagedPRAssistantSection,
} from "./body";

describe("pr-assistant body helpers", () => {
  it("renders the managed section with the stable reviewer headings", () => {
    const section = buildPRAssistantSection({
      summary: "Adds a single PR assistant action.",
      riskAreas: [],
      filesChanged: ["actions/pr-assistant/src/index.ts"],
      testingNotes: [],
      rolloutConcerns: [],
      reviewerChecklist: [
        "Verify the managed block updates without touching other text.",
      ],
    });

    expect(section).toContain("## PR Assistant");
    expect(section).toContain("### Risk areas");
    expect(section).toContain("### Files changed");
    expect(section).toContain("### Testing notes");
    expect(section).toContain("### Rollout concerns");
    expect(section).toContain("### Reviewer checklist");
    expect(section).toContain("None noted.");
  });

  it("renders an explicit empty files state", () => {
    const section = buildPRAssistantSection({
      summary: "Keeps the renderer calm when no file headers are available.",
      riskAreas: [],
      filesChanged: [],
      testingNotes: [],
      rolloutConcerns: [],
      reviewerChecklist: [],
    });

    expect(section).toContain("No changed files detected from the diff.");
  });

  it("appends a managed section when the PR body has no markers", () => {
    const merged = mergePRAssistantSection(
      "Human-authored intro",
      "## PR Assistant\n\n### Summary\nGenerated summary"
    );

    expect(merged).toContain("Human-authored intro");
    expect(merged).toContain(PR_ASSISTANT_START_MARKER);
    expect(merged).toContain(PR_ASSISTANT_END_MARKER);
  });

  it("replaces only the existing managed section", () => {
    const existing = [
      "Human-authored intro",
      "",
      PR_ASSISTANT_START_MARKER,
      "old generated section",
      PR_ASSISTANT_END_MARKER,
      "",
      "Human-authored footer",
    ].join("\n");

    const merged = mergePRAssistantSection(existing, "new generated section");

    expect(merged).toContain("Human-authored intro");
    expect(merged).toContain("Human-authored footer");
    expect(merged).toContain("new generated section");
    expect(merged).not.toContain("old generated section");
  });

  it("strips the managed section before prompt reuse", () => {
    const body = [
      "Human-authored intro",
      "",
      PR_ASSISTANT_START_MARKER,
      "generated section",
      PR_ASSISTANT_END_MARKER,
      "",
      "Human-authored footer",
    ].join("\n");

    expect(stripManagedPRAssistantSection(body)).toBe(
      "Human-authored intro\n\nHuman-authored footer"
    );
  });
});
