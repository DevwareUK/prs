export type PrCommandOptions = {
  action: "fix-comments";
  prNumber: number;
};

export const PR_USAGE = [
  "Usage:",
  "  git-ai pr fix-comments <pr-number>",
].join("\n");

export function parsePrCommandArgs(
  args: string[],
  parseIssueNumber: (rawValue: string | undefined) => number
): PrCommandOptions {
  const prArgs = args.slice(1);
  const subcommand = prArgs[0];

  if (subcommand !== "fix-comments") {
    throw new Error(`Unknown pr subcommand "${subcommand ?? ""}". ${PR_USAGE}`);
  }

  const optionArgs = prArgs.slice(2);
  if (optionArgs.length > 0) {
    throw new Error(`Unknown pr option "${optionArgs[0]}". ${PR_USAGE}`);
  }

  return {
    action: "fix-comments",
    prNumber: parseIssueNumber(prArgs[1]),
  };
}
