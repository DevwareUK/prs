import { describe, expect, it } from "vitest";
import {
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

  it("replaces a prs managed section in place", () => {
    const existingBody = [
      "Manual intro",
      "",
      PR_ASSISTANT_START_MARKER,
      "Managed content",
      PR_ASSISTANT_END_MARKER,
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

  it("strips prs managed sections", () => {
    const existingBody = [
      "Manual intro",
      "",
      PR_ASSISTANT_START_MARKER,
      "Managed content",
      PR_ASSISTANT_END_MARKER,
      "",
      "Manual outro",
    ].join("\n");

    expect(stripManagedPRAssistantSection(existingBody)).toBe(
      ["Manual intro", "", "Manual outro"].join("\n")
    );
  });
});
