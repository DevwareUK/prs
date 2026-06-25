export type IssueRunMode = "interactive" | "unattended";
export type IssuePrepareMode = "local" | "github-action";

export type IssueDraftCommandOptions =
  | {
      mode: "observability-import";
      observabilityFindingsFilePath: string;
    }
  | {
      mode: "caller";
      draftFilePath?: string;
      issueSetFilePath?: string;
      roughIdea?: string;
      roughIdeaFilePath?: string;
      contextValues: string[];
      contextFilePaths: string[];
      superpowersSpecFilePath?: string;
      superpowersPlanFilePath?: string;
      mediaManifestFilePath?: string;
    }
  | {
      mode: "runtime";
    };

export type IssueCommandOptions =
  | {
      action: "run";
      issueNumber: number;
      mode: IssueRunMode;
    }
  | {
      action: "batch";
      issueNumbers: number[];
      mode: "unattended";
    }
  | {
      action: "prepare";
      issueNumber: number;
      mode: IssuePrepareMode;
    }
  | {
      action: "finalize";
      issueNumber: number;
      mode: "local";
    }
  | {
      action: "plan";
      issueNumber: number;
      mode: "local";
      refresh: boolean;
    }
  | {
      action: "estimate";
      issueNumber: number;
      mode: "local";
    }
  | ({
      action: "draft";
    } & IssueDraftCommandOptions)
  | {
      action: "refine";
      issueNumber: number;
    };

const ISSUE_USAGE = [
  "Usage:",
  "  prs issue <number> [--unattended|--auto|--jdi|--mode <interactive|unattended>]",
  "  prs issue <number> <number> [...number] [--unattended|--auto|--jdi]",
  "  prs issue batch <number> <number> [...number] [--unattended|--auto|--jdi]",
  "  prs issue draft --observability-findings <path>",
  "  prs issue draft --draft-file <path> [--rough-idea <text>|--rough-idea-file <path>] [--context <text>] [--context-file <path>] [--superpowers-spec-file <path>] [--superpowers-plan-file <path>] [--media-manifest <path>]",
  "  prs issue draft --issue-set-file <path> [--rough-idea <text>|--rough-idea-file <path>] [--context <text>] [--context-file <path>] [--superpowers-spec-file <path>] [--superpowers-plan-file <path>]",
  "  prs issue draft --runtime",
  "  prs issue refine <number>",
  "  prs issue plan <number> [--refresh]",
  "  prs issue estimate <number>",
  "  prs issue prepare <number> [--mode <local|github-action>]",
  "  prs issue finalize <number>",
].join("\n");

export function parseIssueNumber(rawValue: string | undefined): number {
  if (!rawValue) {
    throw new Error(`Missing issue number. ${ISSUE_USAGE}`);
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`Invalid issue number "${rawValue}". ${ISSUE_USAGE}`);
  }

  const issueNumber = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid issue number "${rawValue}". ${ISSUE_USAGE}`);
  }

  return issueNumber;
}

function parseIssueModeOption(rawArgs: string[]): string | undefined {
  let mode: string | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (rawArg === "--mode") {
      mode = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--mode=")) {
      mode = rawArg.slice("--mode=".length);
      continue;
    }

    if (rawArg === "--unattended" || rawArg === "--auto" || rawArg === "--jdi") {
      mode = "unattended";
      continue;
    }

    throw new Error(`Unknown issue option "${rawArg}". ${ISSUE_USAGE}`);
  }

  return mode;
}

function parseIssueRunMode(rawArgs: string[]): IssueRunMode {
  const mode = parseIssueModeOption(rawArgs);
  if (mode === undefined) {
    return "interactive";
  }

  if (mode !== "interactive" && mode !== "unattended") {
    throw new Error(
      `Invalid issue mode "${mode}". Expected "interactive" or "unattended".`
    );
  }

  return mode;
}

function parseIssuePrepareMode(rawArgs: string[]): IssuePrepareMode {
  const mode = parseIssueModeOption(rawArgs);
  if (mode === undefined) {
    return "local";
  }

  if (mode !== "local" && mode !== "github-action") {
    throw new Error(
      `Invalid issue mode "${mode}". Expected "local" or "github-action".`
    );
  }

  return mode;
}

function parseIssuePlanOptions(rawArgs: string[]): { refresh: boolean } {
  let refresh = false;

  for (const rawArg of rawArgs) {
    if (rawArg === "--refresh" || rawArg === "--update") {
      refresh = true;
      continue;
    }

    throw new Error(`Unknown issue option "${rawArg}". ${ISSUE_USAGE}`);
  }

  return { refresh };
}

function parseIssueBatchArgs(
  rawArgs: string[],
  commandLabel = "Multi-issue runs"
): {
  issueNumbers: number[];
  mode: "unattended";
} {
  const issueNumbers: number[] = [];
  let mode: string | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const rawArg = rawArgs[index];
    if (rawArg === "--mode") {
      mode = rawArgs[index + 1];
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--mode=")) {
      mode = rawArg.slice("--mode=".length);
      continue;
    }

    if (rawArg === "--unattended" || rawArg === "--auto" || rawArg === "--jdi") {
      mode = "unattended";
      continue;
    }

    if (rawArg.startsWith("--")) {
      throw new Error(`Unknown issue option "${rawArg}". ${ISSUE_USAGE}`);
    }

    issueNumbers.push(parseIssueNumber(rawArg));
  }

  if (mode !== undefined && mode !== "unattended") {
    if (mode === "interactive") {
      throw new Error(
        `${commandLabel} only support \`--mode unattended\`. Interactive multi-issue mode is not supported.`
      );
    }

    throw new Error(`Invalid issue mode "${mode}". Expected "unattended".`);
  }

  const uniqueIssueNumbers = [...new Set(issueNumbers)];
  if (uniqueIssueNumbers.length < 2) {
    throw new Error(
      `${commandLabel} require at least two issue numbers. ${ISSUE_USAGE}`
    );
  }

  if (uniqueIssueNumbers.length !== issueNumbers.length) {
    throw new Error(`${commandLabel} do not support duplicate issue numbers.`);
  }

  return {
    issueNumbers,
    mode: "unattended",
  };
}

function takeRequiredOptionValue(
  args: string[],
  index: number,
  optionName: string
): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}. ${ISSUE_USAGE}`);
  }

  return value;
}

function parseIssueDraftOptions(args: string[]): IssueDraftCommandOptions {
  let draftFilePath: string | undefined;
  let issueSetFilePath: string | undefined;
  let roughIdea: string | undefined;
  let roughIdeaFilePath: string | undefined;
  let superpowersSpecFilePath: string | undefined;
  let superpowersPlanFilePath: string | undefined;
  let mediaManifestFilePath: string | undefined;
  let observabilityFindingsFilePath: string | undefined;
  const contextValues: string[] = [];
  const contextFilePaths: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const rawArg = args[index];

    if (rawArg === "--runtime") {
      if (args.length > 1) {
        throw new Error(
          "`prs issue draft --runtime` cannot be combined with caller draft options."
        );
      }

      return { mode: "runtime" };
    }

    if (rawArg === "--from-caller") {
      continue;
    }

    if (rawArg === "--observability-findings") {
      observabilityFindingsFilePath = takeRequiredOptionValue(args, index, rawArg);
      index += 1;
      continue;
    }

    if (rawArg === "--draft-file") {
      draftFilePath = takeRequiredOptionValue(args, index, rawArg);
      index += 1;
      continue;
    }

    if (rawArg === "--issue-set-file") {
      issueSetFilePath = takeRequiredOptionValue(args, index, rawArg);
      index += 1;
      continue;
    }

    if (rawArg === "--rough-idea") {
      roughIdea = takeRequiredOptionValue(args, index, rawArg);
      index += 1;
      continue;
    }

    if (rawArg === "--rough-idea-file") {
      roughIdeaFilePath = takeRequiredOptionValue(args, index, rawArg);
      index += 1;
      continue;
    }

    if (rawArg === "--context") {
      contextValues.push(takeRequiredOptionValue(args, index, rawArg));
      index += 1;
      continue;
    }

    if (rawArg === "--context-file") {
      contextFilePaths.push(takeRequiredOptionValue(args, index, rawArg));
      index += 1;
      continue;
    }

    if (rawArg === "--superpowers-spec-file") {
      superpowersSpecFilePath = takeRequiredOptionValue(args, index, rawArg);
      index += 1;
      continue;
    }

    if (rawArg === "--superpowers-plan-file") {
      superpowersPlanFilePath = takeRequiredOptionValue(args, index, rawArg);
      index += 1;
      continue;
    }

    if (rawArg === "--media-manifest") {
      mediaManifestFilePath = takeRequiredOptionValue(args, index, rawArg);
      index += 1;
      continue;
    }

    if (rawArg.startsWith("--media-manifest=")) {
      mediaManifestFilePath = rawArg.slice("--media-manifest=".length);
      continue;
    }

    throw new Error(`Unknown issue option "${rawArg}". ${ISSUE_USAGE}`);
  }

  if (observabilityFindingsFilePath) {
    if (
      draftFilePath ||
      issueSetFilePath ||
      roughIdea ||
      roughIdeaFilePath ||
      contextValues.length > 0 ||
      contextFilePaths.length > 0 ||
      superpowersSpecFilePath ||
      superpowersPlanFilePath ||
      mediaManifestFilePath
    ) {
      throw new Error(
        "`prs issue draft --observability-findings` cannot be combined with caller draft options."
      );
    }

    return {
      mode: "observability-import",
      observabilityFindingsFilePath,
    };
  }

  if (!draftFilePath && !issueSetFilePath) {
    throw new Error(
      "`prs issue draft` now ingests a skill-produced draft. Pass --draft-file <path> for one issue, --issue-set-file <path> for linked issues, --observability-findings <path> for DSM observability imports, or --runtime to intentionally open a separate drafting session."
    );
  }

  if (draftFilePath && issueSetFilePath) {
    throw new Error("`prs issue draft` accepts either --draft-file or --issue-set-file, not both.");
  }

  if (roughIdea && roughIdeaFilePath) {
    throw new Error("`prs issue draft` accepts either --rough-idea or --rough-idea-file, not both.");
  }

  return {
    mode: "caller",
    draftFilePath,
    issueSetFilePath,
    roughIdea,
    roughIdeaFilePath,
    contextValues,
    contextFilePaths,
    superpowersSpecFilePath,
    superpowersPlanFilePath,
    mediaManifestFilePath,
  };
}

export function parseIssueCommandArgs(args: string[]): IssueCommandOptions {
  const issueArgs = args.slice(1);
  const subcommand = issueArgs[0];

  if (subcommand === "draft") {
    return {
      action: "draft",
      ...parseIssueDraftOptions(issueArgs.slice(1)),
    };
  }

  if (subcommand === "refine") {
    const optionArgs = issueArgs.slice(2);
    if (optionArgs.length > 0) {
      throw new Error(`Unknown issue option "${optionArgs[0]}". ${ISSUE_USAGE}`);
    }

    return {
      action: "refine",
      issueNumber: parseIssueNumber(issueArgs[1]),
    };
  }

  if (subcommand === "batch") {
    const parsed = parseIssueBatchArgs(issueArgs.slice(1), "Batch issue runs");
    return {
      action: "batch",
      issueNumbers: parsed.issueNumbers,
      mode: parsed.mode,
    };
  }

  if (subcommand === "prepare") {
    return {
      action: "prepare",
      issueNumber: parseIssueNumber(issueArgs[1]),
      mode: parseIssuePrepareMode(issueArgs.slice(2)),
    };
  }

  if (subcommand === "finalize") {
    const optionArgs = issueArgs.slice(2);
    if (optionArgs.length > 0) {
      throw new Error(`Unknown issue option "${optionArgs[0]}". ${ISSUE_USAGE}`);
    }

    return {
      action: "finalize",
      issueNumber: parseIssueNumber(issueArgs[1]),
      mode: "local",
    };
  }

  if (subcommand === "plan") {
    const parsedOptions = parseIssuePlanOptions(issueArgs.slice(2));

    return {
      action: "plan",
      issueNumber: parseIssueNumber(issueArgs[1]),
      mode: "local",
      refresh: parsedOptions.refresh,
    };
  }

  if (subcommand === "estimate") {
    const optionArgs = issueArgs.slice(2);
    if (optionArgs.length > 0) {
      throw new Error(`Unknown issue option "${optionArgs[0]}". ${ISSUE_USAGE}`);
    }

    return {
      action: "estimate",
      issueNumber: parseIssueNumber(issueArgs[1]),
      mode: "local",
    };
  }

  const numericIssueArgs = issueArgs.filter((arg) => /^\d+$/.test(arg));
  if (numericIssueArgs.length > 1) {
    const parsed = parseIssueBatchArgs(issueArgs);
    return {
      action: "batch",
      issueNumbers: parsed.issueNumbers,
      mode: parsed.mode,
    };
  }

  return {
    action: "run",
    issueNumber: parseIssueNumber(issueArgs[0]),
    mode: parseIssueRunMode(issueArgs.slice(1)),
  };
}
