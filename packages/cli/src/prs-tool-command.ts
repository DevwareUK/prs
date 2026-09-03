export type PrsToolCommand =
  | { kind: "token-usage-render"; filePath: string; outputFilePath: string; json: true }
  | { kind: "issue-list"; actionable: boolean; json: true }
  | { kind: "issue-context"; issueNumber: number; json: true }
  | { kind: "issue-ready"; issueNumber: number; unattended: boolean; json: true }
  | {
      kind: "issue-publish-artifacts";
      issueNumber: number;
      specFilePath: string;
      planFilePath: string;
      json: true;
    }
  | {
      kind: "issue-create";
      draftFilePath?: string;
      issueSetFilePath?: string;
      runDir?: string;
      specFilePath?: string;
      planFilePath?: string;
      mediaManifestFilePath?: string;
      labels: string[];
      forcePrsManaged: boolean;
      json: true;
    }
  | { kind: "pr-list"; actionable: boolean; json: true }
  | { kind: "pr-ready"; prNumber: number; unattended: boolean; json: true };

export function renderPrsToolCommandHelp(): string {
  return [
    "Usage:",
    "  prs tool token-usage render --file <path> --output <path> --json",
    "  prs tool issue list [--actionable] --json",
    "  prs tool issue context <issue-number> --json",
    "  prs tool issue ready <issue-number> [--unattended|--auto|--jdi] --json",
    "  prs tool issue publish-artifacts <issue-number> --spec-file <path> --plan-file <path> --json",
    "  prs tool issue create (--draft-file <path>|--issue-set <path>) --json",
    "                        [--run-dir <path>] [--spec-file <path>] [--plan-file <path>] [--media-manifest <path>]",
    "                        [--label <name>] [--labels <a,b>] [--force-prs-managed]",
    "  prs tool pr list [--actionable] --json",
    "  prs tool pr ready <pr-number> [--unattended|--auto|--jdi] --json",
  ].join("\n");
}

function parseNumber(rawValue: string | undefined, label: "issue" | "pr"): number {
  if (!rawValue || !/^\d+$/.test(rawValue)) {
    throw new Error(`Invalid prs tool ${label} number: "${rawValue ?? ""}".`);
  }
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid prs tool ${label} number: "${rawValue}".`);
  }
  return value;
}

function requireJson(args: string[]): string[] {
  const jsonCount = args.filter((arg) => arg === "--json").length;
  if (jsonCount !== 1) throw new Error(renderPrsToolCommandHelp());
  return args.filter((arg) => arg !== "--json");
}

function takeValue(args: string[], index: number, name: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required ${name} value. ${renderPrsToolCommandHelp()}`);
  }
  return [value, index + 1];
}

function parseReadyOptions(args: string[]): { unattended: boolean } {
  let unattended = false;
  for (const arg of requireJson(args)) {
    if (arg === "--unattended" || arg === "--auto" || arg === "--jdi") {
      unattended = true;
      continue;
    }
    throw new Error(`Unknown tool option "${arg}". ${renderPrsToolCommandHelp()}`);
  }
  return { unattended };
}

function parseListOptions(args: string[]): { actionable: boolean } {
  const options = requireJson(args);
  if (options.length === 0) return { actionable: false };
  if (options.length === 1 && options[0] === "--actionable") return { actionable: true };
  throw new Error(renderPrsToolCommandHelp());
}

export function parsePrsToolCommandArgs(args: string[]): PrsToolCommand {
  const [scope, command, numberOrOption, ...tail] = args;
  const optionTail = [numberOrOption, ...tail].filter(
    (arg): arg is string => arg !== undefined
  );

  if (scope === "token-usage" && command === "render") {
    const options = requireJson(optionTail);
    const paths = new Map<string, string>();
    for (let index = 0; index < options.length; index++) {
      const arg = options[index], equals = arg.indexOf("=");
      const name = equals < 0 ? arg : arg.slice(0, equals);
      if (!["--file", "--output"].includes(name) || paths.has(name)) throw new Error(renderPrsToolCommandHelp());
      const [value, next] = equals < 0 ? takeValue(options, index, name) : [arg.slice(equals + 1), index] as const;
      if (!value) throw new Error("Missing required " + name + " value");
      paths.set(name, value); index = next;
    }
    if (!paths.has("--file") || !paths.has("--output")) throw new Error(renderPrsToolCommandHelp());
    return { kind: "token-usage-render", filePath: paths.get("--file")!, outputFilePath: paths.get("--output")!, json: true };
  }

  if (scope === "issue" && command === "list") {
    return { kind: "issue-list", ...parseListOptions(optionTail), json: true };
  }
  if (scope === "pr" && command === "list") {
    return { kind: "pr-list", ...parseListOptions(optionTail), json: true };
  }
  if (scope === "issue" && command === "context") {
    const issueNumber = parseNumber(numberOrOption, "issue");
    if (requireJson(tail).length > 0) throw new Error(renderPrsToolCommandHelp());
    return { kind: "issue-context", issueNumber, json: true };
  }
  if (scope === "issue" && command === "ready") {
    return {
      kind: "issue-ready",
      issueNumber: parseNumber(numberOrOption, "issue"),
      ...parseReadyOptions(tail),
      json: true,
    };
  }
  if (scope === "pr" && command === "ready") {
    return {
      kind: "pr-ready",
      prNumber: parseNumber(numberOrOption, "pr"),
      ...parseReadyOptions(tail),
      json: true,
    };
  }

  if (scope === "issue" && command === "publish-artifacts") {
    const issueNumber = parseNumber(numberOrOption, "issue");
    const options = requireJson(tail);
    let specFilePath: string | undefined;
    let planFilePath: string | undefined;
    for (let index = 0; index < options.length; index += 1) {
      const arg = options[index];
      if (arg === "--spec-file" || arg === "--plan-file") {
        const [value, nextIndex] = takeValue(options, index, arg);
        if (arg === "--spec-file") specFilePath = value;
        else planFilePath = value;
        index = nextIndex;
      } else if (arg.startsWith("--spec-file=")) {
        specFilePath = arg.slice("--spec-file=".length);
      } else if (arg.startsWith("--plan-file=")) {
        planFilePath = arg.slice("--plan-file=".length);
      } else {
        throw new Error(`Unknown tool option "${arg}". ${renderPrsToolCommandHelp()}`);
      }
    }
    if (!specFilePath) throw new Error(`Missing required --spec-file. ${renderPrsToolCommandHelp()}`);
    if (!planFilePath) throw new Error(`Missing required --plan-file. ${renderPrsToolCommandHelp()}`);
    return { kind: "issue-publish-artifacts", issueNumber, specFilePath, planFilePath, json: true };
  }

  if (scope === "issue" && command === "create") {
    const options = requireJson(optionTail);
    let draftFilePath: string | undefined;
    let issueSetFilePath: string | undefined;
    let runDir: string | undefined;
    let specFilePath: string | undefined;
    let planFilePath: string | undefined;
    let mediaManifestFilePath: string | undefined;
    let forcePrsManaged = false;
    const labels: string[] = [];
    const setters: Record<string, (value: string) => void> = {
      "--draft-file": (value) => { draftFilePath = value; },
      "--issue-set": (value) => { issueSetFilePath = value; },
      "--run-dir": (value) => { runDir = value; },
      "--spec-file": (value) => { specFilePath = value; },
      "--plan-file": (value) => { planFilePath = value; },
      "--media-manifest": (value) => { mediaManifestFilePath = value; },
      "--label": (value) => { labels.push(value); },
      "--labels": (value) => { labels.push(...value.split(",").map((label) => label.trim()).filter(Boolean)); },
    };

    for (let index = 0; index < options.length; index += 1) {
      const arg = options[index];
      if (arg === "--force-prs-managed") {
        forcePrsManaged = true;
        continue;
      }
      const equalsIndex = arg.indexOf("=");
      const optionName = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
      const setter = setters[optionName];
      if (!setter) throw new Error(`Unknown tool option "${arg}". ${renderPrsToolCommandHelp()}`);
      if (equalsIndex >= 0) {
        const value = arg.slice(equalsIndex + 1);
        if (!value) throw new Error(`Missing required ${optionName} value. ${renderPrsToolCommandHelp()}`);
        setter(value);
      } else {
        const [value, nextIndex] = takeValue(options, index, optionName);
        setter(value);
        index = nextIndex;
      }
    }
    if (Boolean(draftFilePath) === Boolean(issueSetFilePath)) {
      throw new Error(`Provide exactly one of --draft-file or --issue-set. ${renderPrsToolCommandHelp()}`);
    }
    return {
      kind: "issue-create",
      draftFilePath,
      issueSetFilePath,
      runDir,
      specFilePath,
      planFilePath,
      mediaManifestFilePath,
      labels,
      forcePrsManaged,
      json: true,
    };
  }

  throw new Error(renderPrsToolCommandHelp());
}
