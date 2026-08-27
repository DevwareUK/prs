import { describe, expect, it } from "vitest";
import { IssueDraftSet } from "./issue-draft";

describe("linked issue set contract", () => {
  it("validates deterministic draft links", () => {
    expect(IssueDraftSet.parse({
      version: 1,
      mode: "multiple",
      issues: [
        { id: "contract", draftFile: "contract.md" },
        { id: "adapter", draftFile: "adapter.md", dependsOn: ["contract"] },
      ],
    }).issues).toHaveLength(2);
  });
});
