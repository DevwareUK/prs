export type IssueCommandOptions = { action: "finalize"; issueNumber: number };

const ISSUE_USAGE = "Usage: prs issue finalize <number>";

export function parseIssueNumber(rawValue: string | undefined): number {
  if (!rawValue || !/^\d+$/.test(rawValue)) {
    throw new Error(`Invalid issue number "${rawValue ?? ""}". ${ISSUE_USAGE}`);
  }
  const issueNumber = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid issue number "${rawValue}". ${ISSUE_USAGE}`);
  }
  return issueNumber;
}

export function parseIssueCommandArgs(args: string[]): IssueCommandOptions {
  const issueArgs = args[0] === "issue" ? args.slice(1) : args;
  if (issueArgs.length !== 2 || issueArgs[0] !== "finalize") {
    throw new Error(ISSUE_USAGE);
  }
  return { action: "finalize", issueNumber: parseIssueNumber(issueArgs[1]) };
}
