import { describe, expect, it } from "vitest";
import {
  LEGACY_PR_ASSISTANT_END_MARKER,
  LEGACY_PR_ASSISTANT_START_MARKER,
  PR_ASSISTANT_END_MARKER,
  PR_ASSISTANT_START_MARKER,
} from "@prs/contracts";
import {
  mergePRAssistantSection,
  stripManagedPRAssistantSection,
} from "./pr-assistant-body";

describe("pr assistant body markers", () => {
  it("writes the canonical prs markers for new managed sections", () => {
    expect(mergePRAssistantSection(undefined, "## PR Assistant")).toBe(
      [PR_ASSISTANT_START_MARKER, "## PR Assistant", PR_ASSISTANT_END_MARKER].join("\n")
    );
  });

  it("replaces a legacy prs managed section in place", () => {
    const existingBody = [
      "Manual intro",
      "",
      LEGACY_PR_ASSISTANT_START_MARKER,
      "Legacy managed content",
      LEGACY_PR_ASSISTANT_END_MARKER,
    ].join("\n");

    expect(mergePRAssistantSection(existingBody, "## PR Assistant")).toBe(
      [
        "Manual intro",
        "",
        PR_ASSISTANT_START_MARKER,
        "## PR Assistant",
        PR_ASSISTANT_END_MARKER,
      ].join("\n")
    );
  });

  it("strips legacy prs managed sections as well as canonical prs sections", () => {
    const existingBody = [
      "Manual intro",
      "",
      LEGACY_PR_ASSISTANT_START_MARKER,
      "Legacy managed content",
      LEGACY_PR_ASSISTANT_END_MARKER,
      "",
      "Manual outro",
    ].join("\n");

    expect(stripManagedPRAssistantSection(existingBody)).toBe(
      ["Manual intro", "", "Manual outro"].join("\n")
    );
  });
});
