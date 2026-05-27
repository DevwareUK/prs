import { describe, expect, it } from "vitest";
import {
  applyGitHubOutputFraming,
  stripGitHubOutputFraming,
  UNATTENDED_GITHUB_OUTPUT_NOTE,
} from "./github-output-framing";

describe("GitHub output framing", () => {
  it("keeps managed markers first when adding unattended framing", () => {
    const body = applyGitHubOutputFraming(
      "<!-- prs:issue-plan -->\n## Issue Resolution Plan\n",
      "unattended"
    );

    expect(body).toBe(
      [
        "<!-- prs:issue-plan -->",
        "",
        UNATTENDED_GITHUB_OUTPUT_NOTE,
        "",
        "## Issue Resolution Plan",
        "",
      ].join("\n")
    );
  });

  it("removes unattended framing for manual output", () => {
    const body = applyGitHubOutputFraming(
      `<!-- prs:audit -->\n\n${UNATTENDED_GITHUB_OUTPUT_NOTE}\n\n# Audit\n`,
      "manual"
    );

    expect(body).toBe("<!-- prs:audit -->\n\n# Audit\n");
    expect(stripGitHubOutputFraming(body)).toBe(body);
  });
});
