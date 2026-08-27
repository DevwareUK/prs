export const PRODUCT_SHORT_NAME = "prs";
export const PRODUCT_DISPLAY_NAME = "Pull Request Smith";

export const PACKAGE_SCOPE = "@prs";

export const REPOSITORY_STATE_DIRECTORY = ".prs";

export const REPOSITORY_CONFIG_RELATIVE_PATH = `${REPOSITORY_STATE_DIRECTORY}/config.json`;

export const ISSUE_PLAN_COMMENT_MARKER = "<!-- prs:issue-plan -->";

export const ISSUE_SPEC_COMMENT_MARKER = "<!-- prs:issue-spec -->";

export function includesManagedMarker(
  body: string,
  markers: readonly string[]
): boolean {
  return markers.some((marker) => body.includes(marker));
}

export function startsWithManagedMarker(
  body: string,
  markers: readonly string[]
): boolean {
  const firstContentLine = body
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  return markers.some((marker) => firstContentLine?.trim() === marker);
}
