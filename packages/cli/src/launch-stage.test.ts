import { describe, expect, it } from "vitest";
import { formatLaunchStageNotice } from "./launch-stage";

describe("formatLaunchStageNotice", () => {
  it("describes issue finalize in terms of the actual local prerequisites", () => {
    const notice = formatLaunchStageNotice("issue-finalize");

    expect(notice).toContain(
      "Requires local file changes to review and a usable text provider"
    );
    expect(notice).not.toContain("existing issue-run branch");
  });

  it("captures the conditional requirements for issue plan creation", () => {
    const notice = formatLaunchStageNotice("issue-plan");

    expect(notice).toContain("Requires issue access through the configured forge");
    expect(notice).toContain(
      "creating or refreshing a managed plan comment also needs a usable text provider and GitHub authentication"
    );
  });

  it("mentions runtime fallback and provider requirements for advanced issue runs", () => {
    const draftNotice = formatLaunchStageNotice("issue-draft");
    const runNotice = formatLaunchStageNotice("issue-run");

    expect(draftNotice).toContain("configured runtime or Codex fallback");
    expect(runNotice).toContain("a usable text provider");
    expect(runNotice).toContain("authenticated GitHub access");
  });
});
