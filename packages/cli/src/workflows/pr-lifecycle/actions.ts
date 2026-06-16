export const PR_LIFECYCLE_ACTIONS = [
  "review",
  "prepare-review",
  "resolve-conflicts",
  "address-comments",
  "fix-tests",
  "add-tests",
  "push-reviewed",
  "ready",
  "publish-review",
] as const;

export type PrLifecycleAction = (typeof PR_LIFECYCLE_ACTIONS)[number];

export type PrLifecycleActionMetadata = {
  action: PrLifecycleAction;
  publicCommand: string;
  internalStep: string;
};

const PR_LIFECYCLE_ACTION_SET = new Set<string>(PR_LIFECYCLE_ACTIONS);

const PR_LIFECYCLE_ALIASES: Record<string, PrLifecycleAction> = {
  "fix-comments": "address-comments",
  "fix-failing-tests": "fix-tests",
};

const PR_LIFECYCLE_ACTION_METADATA: Record<
  PrLifecycleAction,
  PrLifecycleActionMetadata
> = {
  review: {
    action: "review",
    publicCommand: "review",
    internalStep: "pr-local-review",
  },
  "prepare-review": {
    action: "prepare-review",
    publicCommand: "prepare-review",
    internalStep: "pr-prepare-review",
  },
  "resolve-conflicts": {
    action: "resolve-conflicts",
    publicCommand: "resolve-conflicts",
    internalStep: "pr-resolve-conflicts",
  },
  "address-comments": {
    action: "address-comments",
    publicCommand: "address-comments",
    internalStep: "pr-fix-comments",
  },
  "fix-tests": {
    action: "fix-tests",
    publicCommand: "fix-tests",
    internalStep: "pr-fix-failing-tests",
  },
  "add-tests": {
    action: "add-tests",
    publicCommand: "add-tests",
    internalStep: "pr-fix-tests",
  },
  "push-reviewed": {
    action: "push-reviewed",
    publicCommand: "push-reviewed",
    internalStep: "pull-request-reviewed-updates",
  },
  ready: {
    action: "ready",
    publicCommand: "ready",
    internalStep: "pr-ready",
  },
  "publish-review": {
    action: "publish-review",
    publicCommand: "publish-review",
    internalStep: "pr-local-review/publish",
  },
};

export function normalizePrLifecycleAction(
  input: string | undefined
): PrLifecycleAction | undefined {
  if (!input) {
    return undefined;
  }

  if (input in PR_LIFECYCLE_ALIASES) {
    return PR_LIFECYCLE_ALIASES[input];
  }

  if (PR_LIFECYCLE_ACTION_SET.has(input)) {
    return input as PrLifecycleAction;
  }

  return undefined;
}

export function getPrLifecycleActionMetadata(
  action: PrLifecycleAction
): PrLifecycleActionMetadata {
  return PR_LIFECYCLE_ACTION_METADATA[action];
}
