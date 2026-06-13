export function slugifyIssueTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
}

export function createIssueBranchName(issueNumber: number, title: string): string {
  const slug = slugifyIssueTitle(title) || `issue-${issueNumber}`;
  return `feat/issue-${issueNumber}-${slug}`;
}
