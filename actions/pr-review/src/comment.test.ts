import {
  UNATTENDED_GITHUB_OUTPUT_NOTE,
  PRReviewOutputType,
} from "@prs/contracts";
import { describe, expect, it } from "vitest";
import { buildCommentBody } from "./comment";

const review: PRReviewOutputType = {
  summary: "Adds output framing for unattended comments.",
  impactProfile: {
    riskLevel: "low",
    affectedAreas: ["GitHub comments"],
    dataSensitivity: "none",
    externalDependencyChange: "none",
    userFacingChange: false,
    migrationNeeded: false,
  },
  findings: [],
  comments: [],
};

describe("buildCommentBody", () => {
  it("frames unattended PR review comments", () => {
    const body = buildCommentBody(review, {
      number: 247,
      title: "Frame GitHub output",
      url: "https://github.com/DevwareUK/prs/issues/247",
    });

    expect(body).toContain(UNATTENDED_GITHUB_OUTPUT_NOTE);
    expect(body.indexOf(UNATTENDED_GITHUB_OUTPUT_NOTE)).toBeLessThan(
      body.indexOf("# AI PR Pre-Review Signal")
    );
  });

  it("removes unattended framing for manual output", () => {
    const body = buildCommentBody(review, {}, "manual");

    expect(body).not.toContain(UNATTENDED_GITHUB_OUTPUT_NOTE);
  });
});
