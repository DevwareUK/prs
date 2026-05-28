import { describe, expect, it } from "vitest";
import { formatLaunchStageNotice } from "./launch-stage";

describe("formatLaunchStageNotice", () => {
  it("describes issue finalize in terms of the actual local prerequisites", () => {
    const notice = formatLaunchStageNotice("issue-finalize");

    expect(notice).toContain("Requires local file changes to review");
    expect(notice).toContain("always uses deterministic local commit text");
    expect(notice).toContain("never calls the configured text provider");
    expect(notice).not.toContain("existing issue-run branch");
  });

  it("captures the conditional requirements for issue plan creation", () => {
    const notice = formatLaunchStageNotice("issue-plan");

    expect(notice).toContain("Requires issue access through the configured forge");
    expect(notice).toContain(
      "creating or refreshing a managed plan comment also needs a usable text provider and GitHub authentication"
    );
  });

  it("mentions skill-produced draft and local finalization text behavior for advanced issue runs", () => {
    const draftNotice = formatLaunchStageNotice("issue-draft");
    const runNotice = formatLaunchStageNotice("issue-run");

    expect(draftNotice).toContain("completed issue draft from the active skill flow");
    expect(draftNotice).toContain("--runtime");
    expect(runNotice).toContain("deterministic local finalization artifacts");
    expect(runNotice).toContain("never call the configured text provider");
    expect(runNotice).toContain("authenticated GitHub access");
  });

  it("frames issue automation around the Codex Superpowers audit workflow", () => {
    const notice = formatLaunchStageNotice("issue-run");

    expect(notice).toContain("Codex + Superpowers + GitHub audit");
    expect(notice).toContain("legacy issue automation path");
  });

  it("frames issue batch as the widest beta automation path", () => {
    const notice = formatLaunchStageNotice("issue-batch");

    expect(notice).toContain("fans out unattended issue-to-PR runs");
    expect(notice).toContain("widest automation path in the CLI today");
    expect(notice).toContain("Codex + Superpowers + GitHub audit");
  });

  it("describes resolve-conflicts as a Codex-specific beta PR workflow", () => {
    const notice = formatLaunchStageNotice("pr-resolve-conflicts");

    expect(notice).toContain("BETA WORKFLOW NOTICE");
    expect(notice).toContain("`prs pr resolve-conflicts <pr-number>`");
    expect(notice).toContain("merge conflicts need guided local resolution");
    expect(notice).toContain("`codex` on PATH");
  });
});
