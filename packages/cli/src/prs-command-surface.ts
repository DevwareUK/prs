import {
  filterActionableIssuesForUser,
  filterActionablePullRequestsForUser,
  type ActionableIssue,
  type ActionablePullRequest,
} from "./actionable-github";

export type PrsCommandSurfaceAction =
  | { kind: "root"; mode: "interactive" }
  | { kind: "create" }
  | { kind: "issue"; mode: "interactive" }
  | { kind: "issue"; mode: "direct"; issueNumber: number; action: "work" | "refine" | "plan" | "finish"; unattended: boolean }
  | { kind: "pr"; mode: "interactive" }
  | { kind: "pr"; mode: "direct"; prNumber: number; unattended: boolean }
  | { kind: "audit"; passthroughArgs: string[] }
  | { kind: "finish" };

export type PrsCommandRoute = {
  interaction: "interactive" | "direct";
  skillName: "prs" | "prs:create" | "prs:issue" | "prs:pr" | "prs:audit" | "prs:finish";
  cliArgs?: string[];
  picker?: "actionable-issues" | "actionable-pull-requests";
  target?: { type: "issue" | "pull-request"; number: number } | { type: "create" };
  toolOnly?: boolean;
};

export type PrsInteractivePickerModel =
  | { kind: "issues"; items: ActionableIssue[] }
  | { kind: "pull-requests"; items: ActionablePullRequest[] };

function parsePositiveNumber(rawValue: string | undefined, label: string): number {
  if (!rawValue || !/^\d+$/.test(rawValue)) {
    throw new Error(`Invalid /prs ${label} number: "${rawValue ?? ""}".`);
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid /prs ${label} number: "${rawValue}".`);
  }
  return parsed;
}

function isUnattended(arg: string | undefined): boolean {
  return arg === "--unattended" || arg === "--auto" || arg === "--jdi";
}

export function renderPrsCommandSurfaceHelp(): string {
  return [
    "Usage:",
    "  /prs",
    "  /prs create",
    "  /prs issue",
    "  /prs issue <number> [--unattended|--auto|--jdi|refine|plan|finish]",
    "  /prs pr",
    "  /prs pr <number> [--unattended|--auto|--jdi]",
    "  /prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name>",
    "  /prs finish",
  ].join("\n");
}

export function parsePrsCommandSurfaceArgs(args: string[]): PrsCommandSurfaceAction {
  const [first, second, third, ...rest] = args;
  if (!first) return { kind: "root", mode: "interactive" };
  if (first === "create" && !second) return { kind: "create" };
  if (first === "issue") {
    if (!second) return { kind: "issue", mode: "interactive" };
    if (rest.length > 0) throw new Error(renderPrsCommandSurfaceHelp());
    const issueNumber = parsePositiveNumber(second, "issue");
    if (!third || isUnattended(third)) {
      return { kind: "issue", mode: "direct", issueNumber, action: "work", unattended: isUnattended(third) };
    }
    if (third === "refine" || third === "plan" || third === "finish") {
      return { kind: "issue", mode: "direct", issueNumber, action: third, unattended: false };
    }
    throw new Error(renderPrsCommandSurfaceHelp());
  }
  if (first === "pr") {
    if (!second) return { kind: "pr", mode: "interactive" };
    if (rest.length > 0 || (third && !isUnattended(third))) {
      throw new Error(renderPrsCommandSurfaceHelp());
    }
    return {
      kind: "pr",
      mode: "direct",
      prNumber: parsePositiveNumber(second, "pr"),
      unattended: isUnattended(third),
    };
  }
  if (first === "audit" && second === "publish") {
    return { kind: "audit", passthroughArgs: args.slice(2) };
  }
  if (first === "finish" && !second) return { kind: "finish" };
  throw new Error(renderPrsCommandSurfaceHelp());
}

export function routePrsCommandSurfaceAction(action: PrsCommandSurfaceAction): PrsCommandRoute {
  if (action.kind === "root") return { interaction: "interactive", skillName: "prs" };
  if (action.kind === "create") {
    return { interaction: "direct", skillName: "prs:create", target: { type: "create" } };
  }
  if (action.kind === "issue") {
    if (action.mode === "interactive") {
      return { interaction: "interactive", skillName: "prs:issue", picker: "actionable-issues" };
    }
    const issue = String(action.issueNumber);
    const cliArgs = action.action === "work"
      ? ["tool", "issue", "ready", issue, ...(action.unattended ? ["--unattended"] : []), "--json"]
      : action.action === "finish"
        ? ["issue", "finalize", issue]
        : ["tool", "issue", "context", issue, "--json"];
    return {
      interaction: "direct",
      skillName: action.action === "finish" ? "prs:finish" : "prs:issue",
      cliArgs,
      target: { type: "issue", number: action.issueNumber },
      toolOnly: action.action !== "finish",
    };
  }
  if (action.kind === "pr") {
    if (action.mode === "interactive") {
      return { interaction: "interactive", skillName: "prs:pr", picker: "actionable-pull-requests" };
    }
    return {
      interaction: "direct",
      skillName: "prs:pr",
      cliArgs: ["tool", "pr", "ready", String(action.prNumber), ...(action.unattended ? ["--unattended"] : []), "--json"],
      target: { type: "pull-request", number: action.prNumber },
      toolOnly: true,
    };
  }
  if (action.kind === "audit") {
    return { interaction: "direct", skillName: "prs:audit", cliArgs: ["audit", "publish", ...action.passthroughArgs] };
  }
  return { interaction: "direct", skillName: "prs:finish" };
}

export function buildPrsInteractivePickerModel(input: {
  kind: "issues";
  items: ActionableIssue[];
  currentLogin?: string;
} | {
  kind: "pull-requests";
  items: ActionablePullRequest[];
  currentLogin?: string;
}): PrsInteractivePickerModel {
  return input.kind === "issues"
    ? { kind: "issues", items: filterActionableIssuesForUser(input.items, input.currentLogin) }
    : { kind: "pull-requests", items: filterActionablePullRequestsForUser(input.items, input.currentLogin) };
}
