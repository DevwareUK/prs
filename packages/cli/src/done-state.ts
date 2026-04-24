type DoneStateMode = "interactive" | "non-interactive";

type DoneStateOptions = {
  mode: DoneStateMode;
  readyLabel: string;
};

export function buildDoneStateInstructions(options: DoneStateOptions): string[] {
  const sharedLines = [
    "When you determine the task is complete, always end with this explicit done-state block:",
    "```text",
    "✅ Implementation complete",
    "- Files updated: <high-level summary>",
    "- Verification: <build/test status, or not run>",
    `- ${options.readyLabel}`,
    "```",
    "- keep the summary high level and avoid dumping a full diff",
    "- after the done-state block, add a short explanation of how to see the change in action, or if the work is not user-visible, what you verified or changed in practical terms",
  ];

  if (options.mode === "non-interactive") {
    return [
      ...sharedLines,
      "- do not ask for input or wait for a reply after printing the done state",
    ];
  }

  return [
    ...sharedLines,
    "- after that explanation, end with plain-language next steps telling the user they can continue by giving further instruction or type `/exit` when they are satisfied and want to hand control back to `prs`",
    "- do not present numbered menus or tell the user to pick from fixed option labels",
  ];
}
