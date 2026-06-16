import {
  normalizePrLifecycleAction,
  type PrLifecycleAction,
} from "../workflows/pr-lifecycle/actions";

type DirectPrCommandAction = Extract<
  PrLifecycleAction,
  "address-comments" | "fix-tests" | "add-tests" | "resolve-conflicts"
>;

export type PrCommandOptions = {
  action: DirectPrCommandAction;
  prNumber: number;
};

export const PR_USAGE = [
  "Usage:",
  "  prs pr resolve-conflicts <pr-number>",
  "  prs pr address-comments <pr-number>",
  "  prs pr fix-tests <pr-number>",
  "  prs pr add-tests <pr-number>",
  "",
  "Compatibility aliases:",
  "  prs pr fix-comments <pr-number>      (use address-comments)",
  "  prs pr fix-failing-tests <pr-number> (use fix-tests)",
].join("\n");

export const PR_PREPARE_REVIEW_RETIRED_MESSAGE = [
  "`prs pr prepare-review <pr-number>` has been retired because it launched Codex from inside a PR workflow.",
  "Use `prs tool pr prepare-review <pr-number> --json` for deterministic Codex-safe review preparation.",
  "Run Codex directly with `/prs pr <pr-number> review` when you want an agentic review workflow.",
].join(" ");

export function parsePrCommandArgs(
  args: string[],
  parseIssueNumber: (rawValue: string | undefined) => number
): PrCommandOptions {
  const prArgs = args.slice(1);
  const subcommand = prArgs[0];

  if (subcommand === "prepare-review") {
    throw new Error(PR_PREPARE_REVIEW_RETIRED_MESSAGE);
  }

  const action = normalizePrLifecycleAction(subcommand);
  if (!isDirectPrCommandAction(action)) {
    throw new Error(`Unknown pr subcommand "${subcommand ?? ""}". ${PR_USAGE}`);
  }

  const optionArgs = prArgs.slice(2);
  if (optionArgs.length > 0) {
    throw new Error(`Unknown pr option "${optionArgs[0]}". ${PR_USAGE}`);
  }

  return {
    action,
    prNumber: parseIssueNumber(prArgs[1]),
  };
}

function isDirectPrCommandAction(
  action: PrLifecycleAction | undefined
): action is DirectPrCommandAction {
  return (
    action === "address-comments" ||
    action === "fix-tests" ||
    action === "add-tests" ||
    action === "resolve-conflicts"
  );
}
