export type GitHubOutputMode = "manual" | "unattended";

export const UNATTENDED_GITHUB_OUTPUT_NOTE =
  "prs automation note: this GitHub-visible output was generated and posted by prs unattended automation.";

function isManagedCommentMarker(line: string): boolean {
  return /^<!--\s*prs:[^>]+-->$/.test(line.trim());
}

export function stripGitHubOutputFraming(body: string): string {
  return `${body
    .split(/\r?\n/)
    .filter((line) => line.trim() !== UNATTENDED_GITHUB_OUTPUT_NOTE)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

export function applyGitHubOutputFraming(
  body: string,
  mode: GitHubOutputMode = "manual"
): string {
  const stripped = stripGitHubOutputFraming(body);
  if (mode !== "unattended") {
    return stripped;
  }

  const lines = stripped.trimEnd().split(/\r?\n/);
  if (lines.length > 0 && isManagedCommentMarker(lines[0])) {
    const rest = lines.slice(1);
    while (rest[0]?.trim() === "") {
      rest.shift();
    }

    return [lines[0], "", UNATTENDED_GITHUB_OUTPUT_NOTE, "", ...rest].join("\n") + "\n";
  }

  return [UNATTENDED_GITHUB_OUTPUT_NOTE, "", ...lines].join("\n") + "\n";
}
