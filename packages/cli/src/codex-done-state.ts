type CodexDoneStateMode = "interactive" | "non-interactive";

type CodexDoneStateOptions = {
  mode: CodexDoneStateMode;
  readyLabel: string;
  primaryActionLabel: string;
};

export function buildCodexDoneStateInstructions(
  options: CodexDoneStateOptions
): string[] {
  const sharedLines = [
    "When you determine the task is complete, always end with this explicit done-state block:",
    "```text",
    "✅ Implementation complete",
    "- Files updated: <high-level summary>",
    "- Verification: <build/test status, or not run>",
    `- ${options.readyLabel}`,
    "```",
    "- keep the summary high level and avoid dumping a full diff",
  ];

  if (options.mode === "non-interactive") {
    return [
      ...sharedLines,
      "- do not ask for input or wait for a reply after printing the done state",
    ];
  }

  return [
    ...sharedLines,
    "Then present these next-step options exactly:",
    "```text",
    "[1] Continue refining",
    `[2] ${options.primaryActionLabel}`,
    "[3] Exit",
    "```",
    "- after printing the done state, stop and wait for the user's next instruction",
    "- treat `/continue`, `/commit`, and `/exit` as valid follow-up replies",
  ];
}
