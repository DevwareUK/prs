export type GitHubAuthFailureReason =
  | "github-auth-required"
  | "github-credential-store-inaccessible";

export type GitHubAuthNextAction =
  | "configure-github-auth"
  | "retry-with-credential-store-access";

export class GitHubAuthFailure extends Error {
  constructor(
    message: string,
    readonly reason: GitHubAuthFailureReason,
    readonly nextAction: GitHubAuthNextAction,
  ) {
    super(message);
    this.name = "GitHubAuthFailure";
  }
}

export function normalizeGitHubAuthFailure(
  error: unknown,
  fallbackMessage: string,
): Pick<GitHubAuthFailure, "reason" | "message" | "nextAction"> {
  if (error instanceof GitHubAuthFailure) {
    return {
      reason: error.reason,
      message: error.message,
      nextAction: error.nextAction,
    };
  }
  return {
    reason: "github-auth-required",
    message: fallbackMessage,
    nextAction: "configure-github-auth",
  };
}
