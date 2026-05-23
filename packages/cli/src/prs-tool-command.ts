export type PrsToolCommand =
  | { kind: "issue-list"; actionable: boolean; json: boolean }
  | { kind: "issue-ready"; issueNumber: number; unattended: boolean; json: boolean }
  | {
      kind: "issue-create";
      draftFilePath?: string;
      issueSetFilePath?: string;
      runDir?: string;
      planFilePath?: string;
      labels: string[];
      forcePrsManaged: boolean;
      json: boolean;
    }
  | { kind: "pr-list"; actionable: boolean; json: boolean }
  | { kind: "pr-review"; prNumber: number; json: boolean }
  | {
      kind: "pr-publish-review";
      prNumber: number;
      reportFilePath: string;
      commentsFilePath: string;
      json: boolean;
    }
  | { kind: "pr-prepare-review"; prNumber: number; json: boolean }
  | { kind: "pr-push-reviewed"; prNumber: number; json: boolean }
  | {
      kind: "pr-address-comments" | "pr-fix-tests" | "pr-add-tests";
      prNumber: number;
      selection: string;
      json: boolean;
    }
  | { kind: "pr-ready"; prNumber: number; unattended: boolean; json: boolean };

export function renderPrsToolCommandHelp(): string {
  return [
    "Usage:",
    "  prs tool issue list [--actionable] --json",
    "  prs tool issue ready <issue-number> [--unattended|--auto|--jdi] --json",
    "  prs tool issue create (--draft-file <path>|--issue-set <path>) --json",
    "                        [--run-dir <path>] [--plan-file <path>]",
    "                        [--label <name>] [--labels <a,b>]",
    "                        [--force-prs-managed]",
    "  prs tool pr list [--actionable] --json",
    "  prs tool pr review <pr-number> --json",
    "  prs tool pr publish-review <pr-number> --report <path> --comments <path> --json",
    "  prs tool pr prepare-review <pr-number> --json",
    "  prs tool pr push-reviewed <pr-number> --json",
    "  prs tool pr address-comments <pr-number> [--selection <value>] --json",
    "  prs tool pr fix-tests <pr-number> --json",
    "  prs tool pr add-tests <pr-number> [--selection <value>] --json",
    "  prs tool pr ready <pr-number> [--unattended|--auto|--jdi] --json",
    "",
    "Compatibility aliases:",
    "  prs tool pr fix-comments <pr-number> [--selection <value>] --json      (use address-comments)",
    "  prs tool pr fix-failing-tests <pr-number> --json                       (use fix-tests)",
  ].join("\n");
}

function parseToolNumber(rawValue: string | undefined, label: "issue" | "pr"): number {
  if (!rawValue || !/^\d+$/.test(rawValue)) {
    throw new Error(`Invalid prs tool ${label} number: "${rawValue ?? ""}".`);
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid prs tool ${label} number: "${rawValue}".`);
  }

  return parsed;
}

function parseCommaSeparatedLabels(value: string | undefined): string[] {
  if (!value) {
    throw new Error(`Missing value for --labels. ${renderPrsToolCommandHelp()}`);
  }

  return value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

function isUnattendedAlias(rawArg: string | undefined): boolean {
  return rawArg === "--unattended" || rawArg === "--auto" || rawArg === "--jdi";
}

export function parsePrsToolCommandArgs(args: string[]): PrsToolCommand {
  const [scope, command, third, fourth, ...rest] = args;

  if (!command || (scope !== "issue" && scope !== "pr")) {
    throw new Error(renderPrsToolCommandHelp());
  }

  if (scope === "issue") {
    if (command === "list") {
      if (rest.length > 0) {
        throw new Error(renderPrsToolCommandHelp());
      }
      if (third === "--actionable" && fourth === "--json") {
        return { kind: "issue-list", actionable: true, json: true };
      }
      if (third === "--json" && !fourth) {
        return { kind: "issue-list", actionable: false, json: true };
      }
      throw new Error(renderPrsToolCommandHelp());
    }

    if (command === "ready") {
      if (!third || third === "--json" || third === "--all") {
        throw new Error(renderPrsToolCommandHelp());
      }

      const issueNumber = parseToolNumber(third, "issue");
      if (fourth === "--json" && rest.length === 0) {
        return { kind: "issue-ready", issueNumber, unattended: false, json: true };
      }
      if (isUnattendedAlias(fourth) && rest[0] === "--json" && rest.length === 1) {
        return { kind: "issue-ready", issueNumber, unattended: true, json: true };
      }
      if (fourth === "--all") {
        throw new Error(`Unknown tool option "--all". ${renderPrsToolCommandHelp()}`);
      }
      throw new Error(renderPrsToolCommandHelp());
    }

    if (command === "create") {
      const optionArgs = [third, fourth, ...rest].filter(
        (arg): arg is string => arg !== undefined
      );
      let draftFilePath: string | undefined;
      let issueSetFilePath: string | undefined;
      let runDir: string | undefined;
      let planFilePath: string | undefined;
      const labels = new Set<string>();
      let forcePrsManaged = false;
      let json = false;

      for (let index = 0; index < optionArgs.length; index += 1) {
        const rawArg = optionArgs[index];

        if (rawArg === "--json") {
          json = true;
          continue;
        }

        if (rawArg === "--force-prs-managed") {
          forcePrsManaged = true;
          continue;
        }

        if (rawArg === "--draft-file") {
          draftFilePath = optionArgs[index + 1];
          if (!draftFilePath) {
            throw new Error(`Missing value for --draft-file. ${renderPrsToolCommandHelp()}`);
          }
          index += 1;
          continue;
        }

        if (rawArg.startsWith("--draft-file=")) {
          draftFilePath = rawArg.slice("--draft-file=".length);
          continue;
        }

        if (rawArg === "--issue-set") {
          issueSetFilePath = optionArgs[index + 1];
          if (!issueSetFilePath) {
            throw new Error(`Missing value for --issue-set. ${renderPrsToolCommandHelp()}`);
          }
          index += 1;
          continue;
        }

        if (rawArg.startsWith("--issue-set=")) {
          issueSetFilePath = rawArg.slice("--issue-set=".length);
          continue;
        }

        if (rawArg === "--run-dir") {
          runDir = optionArgs[index + 1];
          if (!runDir) {
            throw new Error(`Missing value for --run-dir. ${renderPrsToolCommandHelp()}`);
          }
          index += 1;
          continue;
        }

        if (rawArg.startsWith("--run-dir=")) {
          runDir = rawArg.slice("--run-dir=".length);
          continue;
        }

        if (rawArg === "--plan-file") {
          planFilePath = optionArgs[index + 1];
          if (!planFilePath) {
            throw new Error(`Missing value for --plan-file. ${renderPrsToolCommandHelp()}`);
          }
          index += 1;
          continue;
        }

        if (rawArg.startsWith("--plan-file=")) {
          planFilePath = rawArg.slice("--plan-file=".length);
          continue;
        }

        if (rawArg === "--label") {
          const label = optionArgs[index + 1]?.trim();
          if (!label) {
            throw new Error(`Missing value for --label. ${renderPrsToolCommandHelp()}`);
          }
          labels.add(label);
          index += 1;
          continue;
        }

        if (rawArg.startsWith("--label=")) {
          const label = rawArg.slice("--label=".length).trim();
          if (!label) {
            throw new Error(`Missing value for --label. ${renderPrsToolCommandHelp()}`);
          }
          labels.add(label);
          continue;
        }

        if (rawArg === "--labels") {
          for (const label of parseCommaSeparatedLabels(optionArgs[index + 1])) {
            labels.add(label);
          }
          index += 1;
          continue;
        }

        if (rawArg.startsWith("--labels=")) {
          for (const label of parseCommaSeparatedLabels(rawArg.slice("--labels=".length))) {
            labels.add(label);
          }
          continue;
        }

        throw new Error(`Unknown tool option "${rawArg}". ${renderPrsToolCommandHelp()}`);
      }

      if (!json) {
        throw new Error(`prs tool issue create requires --json. ${renderPrsToolCommandHelp()}`);
      }

      if (Boolean(draftFilePath) === Boolean(issueSetFilePath)) {
        throw new Error(
          `Provide exactly one of --draft-file or --issue-set. ${renderPrsToolCommandHelp()}`
        );
      }

      return {
        kind: "issue-create",
        draftFilePath,
        issueSetFilePath,
        runDir,
        planFilePath,
        labels: [...labels],
        forcePrsManaged,
        json: true,
      };
    }

    throw new Error(renderPrsToolCommandHelp());
  }

  if (command === "list") {
    if (rest.length > 0) {
      throw new Error(renderPrsToolCommandHelp());
    }
    if (third === "--actionable" && fourth === "--json") {
      return { kind: "pr-list", actionable: true, json: true };
    }
    if (third === "--json" && !fourth) {
      return { kind: "pr-list", actionable: false, json: true };
    }
    throw new Error(renderPrsToolCommandHelp());
  }

  if (command === "review" || command === "prepare-review") {
    if (rest.length > 0) {
      throw new Error(renderPrsToolCommandHelp());
    }
    if (!third || third === "--json") {
      throw new Error(renderPrsToolCommandHelp());
    }

    const prNumber = parseToolNumber(third, "pr");
    if (fourth !== "--json") {
      throw new Error(renderPrsToolCommandHelp());
    }

    return {
      kind: command === "review" ? "pr-review" : "pr-prepare-review",
      prNumber,
      json: true,
    };
  }

  if (command === "publish-review") {
    if (!third || third === "--json") {
      throw new Error(renderPrsToolCommandHelp());
    }

    const prNumber = parseToolNumber(third, "pr");
    const optionArgs = [fourth, ...rest].filter(
      (arg): arg is string => arg !== undefined
    );
    let reportFilePath: string | undefined;
    let commentsFilePath: string | undefined;
    let json = false;

    for (let index = 0; index < optionArgs.length; index += 1) {
      const rawArg = optionArgs[index];

      if (rawArg === "--json") {
        json = true;
        continue;
      }

      if (rawArg === "--report") {
        reportFilePath = optionArgs[index + 1];
        if (!reportFilePath) {
          throw new Error(`Missing value for --report. ${renderPrsToolCommandHelp()}`);
        }
        index += 1;
        continue;
      }

      if (rawArg.startsWith("--report=")) {
        reportFilePath = rawArg.slice("--report=".length);
        continue;
      }

      if (rawArg === "--comments") {
        commentsFilePath = optionArgs[index + 1];
        if (!commentsFilePath) {
          throw new Error(`Missing value for --comments. ${renderPrsToolCommandHelp()}`);
        }
        index += 1;
        continue;
      }

      if (rawArg.startsWith("--comments=")) {
        commentsFilePath = rawArg.slice("--comments=".length);
        continue;
      }

      throw new Error(`Unknown tool option "${rawArg}". ${renderPrsToolCommandHelp()}`);
    }

    if (!json) {
      throw new Error(`prs tool pr publish-review requires --json. ${renderPrsToolCommandHelp()}`);
    }

    if (!reportFilePath || !commentsFilePath) {
      throw new Error(
        `prs tool pr publish-review requires --report and --comments. ${renderPrsToolCommandHelp()}`
      );
    }

    return {
      kind: "pr-publish-review",
      prNumber,
      reportFilePath,
      commentsFilePath,
      json: true,
    };
  }

  if (command === "push-reviewed") {
    if (rest.length > 0) {
      throw new Error(renderPrsToolCommandHelp());
    }
    if (!third || third === "--json") {
      throw new Error(renderPrsToolCommandHelp());
    }

    const prNumber = parseToolNumber(third, "pr");
    if (fourth !== "--json") {
      throw new Error(renderPrsToolCommandHelp());
    }

    return { kind: "pr-push-reviewed", prNumber, json: true };
  }

  if (
    command === "address-comments" ||
    command === "add-tests" ||
    command === "fix-comments" ||
    command === "fix-failing-tests" ||
    command === "fix-tests"
  ) {
    if (!third || third === "--json" || third === "--selection") {
      throw new Error(renderPrsToolCommandHelp());
    }

    const prNumber = parseToolNumber(third, "pr");
    const optionArgs = [fourth, ...rest].filter(
      (arg): arg is string => arg !== undefined
    );
    let selection = "all";
    let json = false;

    const kind = normalizePrFixToolKind(command);
    const acceptsSelection = kind === "pr-address-comments" || kind === "pr-add-tests";

    for (let index = 0; index < optionArgs.length; index += 1) {
      const rawArg = optionArgs[index];

      if (rawArg === "--json") {
        json = true;
        continue;
      }

      if (rawArg === "--selection") {
        if (!acceptsSelection) {
          throw new Error(
            "`prs tool pr fix-tests` now repairs failing tests and does not accept --selection. Use `prs tool pr add-tests <pr-number> --selection <value> --json` for managed AI test suggestions."
          );
        }
        const value = optionArgs[index + 1];
        if (!value) {
          throw new Error(`Missing value for --selection. ${renderPrsToolCommandHelp()}`);
        }
        selection = value;
        index += 1;
        continue;
      }

      if (rawArg.startsWith("--selection=")) {
        if (!acceptsSelection) {
          throw new Error(
            "`prs tool pr fix-tests` now repairs failing tests and does not accept --selection. Use `prs tool pr add-tests <pr-number> --selection <value> --json` for managed AI test suggestions."
          );
        }
        selection = rawArg.slice("--selection=".length);
        continue;
      }

      throw new Error(`Unknown tool option "${rawArg}". ${renderPrsToolCommandHelp()}`);
    }

    if (!json) {
      throw new Error(`prs tool pr ${command} requires --json. ${renderPrsToolCommandHelp()}`);
    }

    return { kind, prNumber, selection, json: true };
  }

  if (command === "ready") {
    if (!third || third === "--json" || third === "--all") {
      throw new Error(renderPrsToolCommandHelp());
    }

    const prNumber = parseToolNumber(third, "pr");
    if (fourth === "--json" && rest.length === 0) {
      return { kind: "pr-ready", prNumber, unattended: false, json: true };
    }
    if (isUnattendedAlias(fourth) && rest[0] === "--json" && rest.length === 1) {
      return { kind: "pr-ready", prNumber, unattended: true, json: true };
    }
    if (fourth === "--all") {
      throw new Error(`Unknown tool option "--all". ${renderPrsToolCommandHelp()}`);
    }
    throw new Error(renderPrsToolCommandHelp());
  }

  throw new Error(renderPrsToolCommandHelp());
}

function normalizePrFixToolKind(
  command: string
): Extract<PrsToolCommand, { prNumber: number; selection: string }>["kind"] {
  if (command === "fix-comments" || command === "address-comments") {
    return "pr-address-comments";
  }
  if (command === "fix-failing-tests" || command === "fix-tests") {
    return "pr-fix-tests";
  }

  return "pr-add-tests";
}
