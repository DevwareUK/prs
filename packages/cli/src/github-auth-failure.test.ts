import { describe, expect, it } from "vitest";
import {
  GitHubAuthFailure,
  normalizeGitHubAuthFailure,
} from "./github-auth-failure";

describe("normalizeGitHubAuthFailure", () => {
  it("preserves a typed credential-store failure", () => {
    expect(
      normalizeGitHubAuthFailure(
        new GitHubAuthFailure(
          "Saved credential is inaccessible.",
          "github-credential-store-inaccessible",
          "retry-with-credential-store-access",
        ),
        "GitHub authentication is required.",
      ),
    ).toEqual({
      reason: "github-credential-store-inaccessible",
      message: "Saved credential is inaccessible.",
      nextAction: "retry-with-credential-store-access",
    });
  });

  it("preserves a typed login-required failure", () => {
    expect(
      normalizeGitHubAuthFailure(
        new GitHubAuthFailure(
          "GitHub login is required.",
          "github-auth-required",
          "configure-github-auth",
        ),
        "Fallback message.",
      ),
    ).toEqual({
      reason: "github-auth-required",
      message: "GitHub login is required.",
      nextAction: "configure-github-auth",
    });
  });

  it("uses the safe fallback for an unknown error", () => {
    expect(
      normalizeGitHubAuthFailure(
        new Error("secret token leaked in an unexpected error"),
        "GitHub authentication is required.",
      ),
    ).toEqual({
      reason: "github-auth-required",
      message: "GitHub authentication is required.",
      nextAction: "configure-github-auth",
    });
  });
});
