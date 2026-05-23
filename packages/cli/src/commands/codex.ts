export type CodexCommandOptions =
  | {
      action: "issue";
      issueNumber: number;
    }
  | {
      action: "issue-batch";
      issueNumbers: number[];
    }
  | {
      action: "pr-prepare-review";
      prNumber: number;
    }
  | {
      action: "pr-resolve-conflicts";
      prNumber: number;
    };

export const CODEX_RETIRED_MESSAGE = [
  "`prs codex ...` has been retired because prs is skill-first.",
  "Run Codex directly from the repository instead, for example:",
  '  codex -C <repo> "/prs issue <number> refine"',
  '  codex exec -C <repo> "/prs pr <number> review"',
  "For deterministic handoff data inside an active Codex session, use `prs tool ... --json` commands.",
].join("\n");

export function parseCodexCommandArgs(
  _args: string[],
  _parseNumber: (rawValue: string | undefined) => number
): CodexCommandOptions {
  void _args;
  void _parseNumber;
  throw new Error(CODEX_RETIRED_MESSAGE);
}
