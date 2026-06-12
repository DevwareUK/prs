import {
  filterActionableIssuesForUser,
  filterActionablePullRequestsForUser,
  type ActionableIssue,
  type ActionablePullRequest,
} from "./actionable-github";

export type PrsIssueAction = "work" | "refine" | "plan" | "finish";
export type PrsReviewAction = "choose" | "diff" | "tests" | "features";
export type PrsPrAction =
  | "choose"
  | "review"
  | "prepare-review"
  | "resolve-conflicts"
  | "address-comments"
  | "fix-tests"
  | "add-tests";

export type PrsCommandSurfaceAction =
  | { kind: "root"; mode: "interactive" }
  | { kind: "create"; target: "issue" }
  | { kind: "cleanup"; mode: "direct"; target: "branches" | "worktrees" }
  | { kind: "review"; mode: "interactive" }
  | {
      kind: "review";
      mode: "direct";
      action: Exclude<PrsReviewAction, "choose">;
      passthroughArgs: string[];
    }
  | { kind: "issue"; mode: "interactive" }
  | {
      kind: "issue";
      mode: "direct";
      issueNumber: number;
      action: PrsIssueAction;
      unattended?: boolean;
    }
  | { kind: "pr"; mode: "interactive" }
  | { kind: "pr"; mode: "direct"; prNumber: number; action: PrsPrAction; unattended?: boolean }
  | { kind: "audit"; action: "publish"; passthroughArgs: string[] }
  | { kind: "finish" };

export type PrsCommandRoute = {
  interaction: "interactive" | "direct";
  skillName:
    | "prs"
    | "prs:review"
    | "prs:start-issue-work"
    | "prs:cleanup-branches"
    | "prs:cleanup-worktrees"
    | "prs:parallel-batch"
    | "prs:publish-audit"
    | "prs:finish-work";
  cliArgs?: string[];
  picker?: "actionable-issues" | "actionable-pull-requests" | "pr-actions";
  target?:
    | { type: "issue" | "pull-request"; number: number }
    | { type: "create"; name: "issue" }
    | { type: "review"; name: "diff" | "tests" | "features" };
  toolOnly?: boolean;
};

export type PrsInteractivePickerModel =
  | { kind: "issues"; items: ActionableIssue[] }
  | { kind: "pull-requests"; items: ActionablePullRequest[] };

const ISSUE_ACTIONS = new Set(["refine", "plan", "finish"]);
const PR_ACTIONS = new Set([
  "review",
  "prepare-review",
  "resolve-conflicts",
  "address-comments",
  "add-tests",
  "fix-comments",
  "fix-failing-tests",
  "fix-tests",
]);

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

export function renderPrsCommandSurfaceHelp(): string {
  return [
    "Usage:",
    "  /prs",
    "  /prs create [issue]",
    "  /prs cleanup branches",
    "  /prs cleanup worktrees",
    "  /prs review",
    "  /prs review diff [--base <git-ref>] [--head <git-ref>] [--format <markdown|json>]",
    "  /prs review tests [--format <markdown|json>] [--top <count>] [--create-issues]",
    "  /prs review features [repo-path] [--format <markdown|json>] [--top <count>] [--create-issues]",
    "  /prs issue",
    "  /prs issue <number> [--unattended|--auto|--jdi|refine|plan|finish]",
    "  /prs pr",
    "  /prs pr <number> [--unattended|--auto|--jdi|review|prepare-review|resolve-conflicts|address-comments|fix-tests|add-tests]",
    "  /prs audit publish [--issue <number>|--pr <number>] [--file <path>] [--section <name>] [--local-run <path>]",
    "  /prs finish",
  ].join("\n");
}

function isUnattendedAlias(rawArg: string | undefined): boolean {
  return rawArg === "--unattended" || rawArg === "--auto" || rawArg === "--jdi";
}

export function parsePrsCommandSurfaceArgs(args: string[]): PrsCommandSurfaceAction {
  const [first, second, third, ...rest] = args;

  if (!first) {
    return { kind: "root", mode: "interactive" };
  }

  if (first === "create") {
    if (!second || second === "issue") {
      if (third || rest.length > 0) {
        throw new Error(renderPrsCommandSurfaceHelp());
      }

      return { kind: "create", target: "issue" };
    }

    throw new Error(renderPrsCommandSurfaceHelp());
  }

  if (first === "cleanup") {
    if ((second === "branches" || second === "worktrees") && !third && rest.length === 0) {
      return { kind: "cleanup", mode: "direct", target: second };
    }

    throw new Error(renderPrsCommandSurfaceHelp());
  }

  if (first === "review") {
    if (!second) {
      return { kind: "review", mode: "interactive" };
    }

    if (second === "diff" || second === "tests" || second === "features") {
      return {
        kind: "review",
        mode: "direct",
        action: second,
        passthroughArgs: [third, ...rest].filter(
          (value): value is string => value !== undefined
        ),
      };
    }

    throw new Error(renderPrsCommandSurfaceHelp());
  }

  if (first === "issue") {
    if (!second) {
      return { kind: "issue", mode: "interactive" };
    }
    if (rest.length > 0) {
      throw new Error(renderPrsCommandSurfaceHelp());
    }

    const issueNumber = parsePositiveNumber(second, "issue");
    if (isUnattendedAlias(third)) {
      return { kind: "issue", mode: "direct", issueNumber, action: "work", unattended: true };
    }
    if (!third) {
      return { kind: "issue", mode: "direct", issueNumber, action: "work", unattended: false };
    }
    if (!ISSUE_ACTIONS.has(third)) {
      throw new Error(renderPrsCommandSurfaceHelp());
    }

    return {
      kind: "issue",
      mode: "direct",
      issueNumber,
      action: third as PrsIssueAction,
    };
  }

  if (first === "pr") {
    if (!second) {
      return { kind: "pr", mode: "interactive" };
    }
    if (rest.length > 1) {
      throw new Error(renderPrsCommandSurfaceHelp());
    }
    if (PR_ACTIONS.has(second)) {
      throw new Error(renderPrsCommandSurfaceHelp());
    }

    const prNumber = parsePositiveNumber(second, "pr");
    if (isUnattendedAlias(third)) {
      return { kind: "pr", mode: "direct", prNumber, action: "choose", unattended: true };
    }
    if (!third) {
      return { kind: "pr", mode: "direct", prNumber, action: "choose", unattended: false };
    }
    if (!PR_ACTIONS.has(third)) {
      throw new Error(renderPrsCommandSurfaceHelp());
    }

    const action = normalizePrSurfaceAction(third);
    if (rest[0] && (action !== "review" || !isUnattendedAlias(rest[0]))) {
      throw new Error(renderPrsCommandSurfaceHelp());
    }
    if (action === "review") {
      return {
        kind: "pr",
        mode: "direct",
        prNumber,
        action,
        unattended: isUnattendedAlias(rest[0]),
      };
    }

    return {
      kind: "pr",
      mode: "direct",
      prNumber,
      action,
    };
  }

  if (first === "audit" && second === "publish") {
    return { kind: "audit", action: "publish", passthroughArgs: args.slice(2) };
  }

  if (first === "finish" && !second) {
    return { kind: "finish" };
  }

  throw new Error(renderPrsCommandSurfaceHelp());
}

export function routePrsCommandSurfaceAction(action: PrsCommandSurfaceAction): PrsCommandRoute {
  if (action.kind === "root") {
    return { interaction: "interactive", skillName: "prs", cliArgs: undefined };
  }

  if (action.kind === "create") {
    return {
      interaction: "direct",
      skillName: "prs:start-issue-work",
      cliArgs: ["issue", "draft"],
      target: { type: "create", name: "issue" },
    };
  }

  if (action.kind === "cleanup") {
    const cleanupTarget = action.target;
    return {
      interaction: "direct",
      skillName:
        cleanupTarget === "branches" ? "prs:cleanup-branches" : "prs:cleanup-worktrees",
      cliArgs: ["tool", cleanupTarget, "cleanup", "--json"],
      toolOnly: true,
    };
  }

  if (action.kind === "review") {
    if (action.mode === "interactive") {
      return {
        interaction: "interactive",
        skillName: "prs:review",
        cliArgs: undefined,
        target: { type: "review", name: "tests" },
      };
    }

    if (action.action === "tests") {
      return {
        interaction: "direct",
        skillName: "prs:review",
        cliArgs: ["test-backlog", ...action.passthroughArgs],
        target: { type: "review", name: "tests" },
      };
    }

    if (action.action === "features") {
      return {
        interaction: "direct",
        skillName: "prs:review",
        cliArgs: ["feature-backlog", ...action.passthroughArgs],
        target: { type: "review", name: "features" },
      };
    }

    return {
      interaction: "direct",
      skillName: "prs:review",
      cliArgs: ["review", ...action.passthroughArgs],
      target: { type: "review", name: "diff" },
    };
  }

  if (action.kind === "issue") {
    if (action.mode === "interactive") {
      return {
        interaction: "interactive",
        skillName: "prs",
        cliArgs: undefined,
        picker: "actionable-issues",
      };
    }

    if (action.action === "work") {
      return {
        interaction: "direct",
        skillName: "prs",
        cliArgs: action.unattended
          ? ["tool", "issue", "ready", String(action.issueNumber), "--unattended", "--json"]
          : ["tool", "issue", "ready", String(action.issueNumber), "--json"],
        target: { type: "issue", number: action.issueNumber },
        toolOnly: action.unattended ? undefined : true,
      };
    }

    if (action.action === "refine") {
      return {
        interaction: "direct",
        skillName: "prs:start-issue-work",
        cliArgs: ["issue", "refine", String(action.issueNumber)],
        target: { type: "issue", number: action.issueNumber },
      };
    }

    if (action.action === "plan") {
      return {
        interaction: "direct",
        skillName: "prs:start-issue-work",
        cliArgs: ["issue", "plan", String(action.issueNumber)],
        target: { type: "issue", number: action.issueNumber },
      };
    }

    return {
      interaction: "interactive",
      skillName: "prs:finish-work",
      cliArgs: undefined,
      target: { type: "issue", number: action.issueNumber },
    };
  }

  if (action.kind === "pr") {
    if (action.mode === "interactive") {
      return {
        interaction: "interactive",
        skillName: "prs",
        cliArgs: undefined,
        picker: "actionable-pull-requests",
      };
    }

    if (action.action === "choose") {
      return {
        interaction: "direct",
        skillName: "prs",
        cliArgs: action.unattended
          ? ["tool", "pr", "ready", String(action.prNumber), "--unattended", "--json"]
          : ["tool", "pr", "ready", String(action.prNumber), "--json"],
        target: { type: "pull-request", number: action.prNumber },
        toolOnly: true,
      };
    }

    if (action.action === "prepare-review") {
      return {
        interaction: "direct",
        skillName: "prs",
        cliArgs: ["tool", "pr", "prepare-review", String(action.prNumber), "--json"],
        target: { type: "pull-request", number: action.prNumber },
        toolOnly: true,
      };
    }

    if (action.action === "review") {
      return {
        interaction: "direct",
        skillName: "prs",
        cliArgs: action.unattended
          ? ["tool", "pr", "review", String(action.prNumber), "--unattended", "--json"]
          : ["tool", "pr", "review", String(action.prNumber), "--json"],
        target: { type: "pull-request", number: action.prNumber },
        toolOnly: true,
      };
    }

    if (
      action.action === "address-comments" ||
      action.action === "fix-tests" ||
      action.action === "add-tests"
    ) {
      return {
        interaction: "direct",
        skillName: "prs",
        cliArgs: ["tool", "pr", action.action, String(action.prNumber), "--json"],
        target: { type: "pull-request", number: action.prNumber },
        toolOnly: true,
      };
    }

    return {
      interaction: "direct",
      skillName: "prs",
      cliArgs: ["pr", action.action, String(action.prNumber)],
      target: { type: "pull-request", number: action.prNumber },
    };
  }

  if (action.kind === "audit") {
    return {
      interaction: "direct",
      skillName: "prs:publish-audit",
      cliArgs: ["audit", "publish", ...action.passthroughArgs],
    };
  }

  return { interaction: "interactive", skillName: "prs:finish-work", cliArgs: undefined };
}

function normalizePrSurfaceAction(rawAction: string | undefined): PrsPrAction {
  if (rawAction === "fix-comments") {
    return "address-comments";
  }
  if (rawAction === "fix-failing-tests") {
    return "fix-tests";
  }

  return rawAction as PrsPrAction;
}

export function buildPrsInteractivePickerModel(
  action: PrsCommandSurfaceAction,
  input: {
    currentUser: string;
    issues?: ActionableIssue[];
    pullRequests?: ActionablePullRequest[];
  }
): PrsInteractivePickerModel | undefined {
  if (action.kind === "issue" && action.mode === "interactive") {
    return {
      kind: "issues",
      items: filterActionableIssuesForUser(input.issues ?? [], input.currentUser),
    };
  }

  if (action.kind === "pr" && action.mode === "interactive") {
    return {
      kind: "pull-requests",
      items: filterActionablePullRequestsForUser(input.pullRequests ?? [], input.currentUser),
    };
  }

  return undefined;
}
