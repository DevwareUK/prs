# CLI reference

`prs --help` is the source of truth for the top-level command surface. Every `prs tool` command writes JSON and requires `--json`; diagnostics go to stderr.

## Setup

```text
prs setup [--skills <none|codex|claude-code|copilot|all>]
```

`prs setup` verifies the current directory is a Git repository, detects a default base branch and build command, then writes `.prs/config.json` and `.prs/.gitignore`. Existing `ai` and `githubActions` sections are removed with a visible migration notice.

Without `--skills` in an interactive terminal, setup asks whether to install personal skills for one host, every host, or none; an empty answer selects `none`. It then offers saved GitHub accounts plus “Use the default account” and writes an explicit choice to ignored `.prs/config.local.json`. Reruns keep the current account unless explicitly changed. Supplying `--skills` skips all prompts; without interactive input, setup also skips prompts and defaults skill installation to `none`. Neither non-interactive path alters the account selection. Host selection affects personal skill files only and is not stored in repository configuration. See [setup and authentication](setup-configuration.md) for details.

## Install agent skills

```text
prs skills install <codex|claude-code|copilot> [--json]
```

The Codex adapter copies the canonical skill files unchanged to `~/.agents/skills`. A sidecar hash ledger lets later runs update only files that still match their last managed content. Custom collisions are reported and left untouched. Marked PRS-managed files in the legacy `~/.codex/skills` location are renamed with a `.prs-retired` suffix so they no longer load but remain recoverable.

The Claude Code adapter applies the same copy and hash-protection behavior under `~/.claude/skills`. It does not add Claude-specific frontmatter or rewrite the shared skill bodies.

The GitHub Copilot adapter uses the same `~/.agents/skills` target and hash ledger as Codex. Installing for both hosts adopts the existing managed files and records both hosts without creating a second copy.

## Validate agent parity

```text
prs skills validate [--json]
```

Parity validation installs all three host adapters into separate temporary homes, then compares each installed inventory, content hash, and retained operation reference with the canonical pack. It also checks the installed `artifact-locality` instruction (raw workflow artifacts stay under `.prs/runs` and are not staged or committed) and `staged-only-finalization` instruction (the existing index is the commit source while unstaged and untracked files are preserved). The JSON report names the required safeguards and reports passing safeguards or missing-safeguard errors for each host independently. The command reports static installation and instruction parity only; it does not launch host runtimes. End-to-end native host evidence remains manual and separately attributed in [the agent parity guide](agent-parity.md)'s smoke matrix.

The validator also requires `prs-pr`, its existing-PR router entry, and non-empty sections for `review`, `resolve-conflicts`, `address-comments`, and `fix-tests`. Missing instructions are reported in each host's `errors`, even when the installed files match the canonical pack exactly.

## Issue tools

| Command | Behaviour |
| --- | --- |
| `prs tool issue list [--actionable] --json` | Lists open GitHub issues. The actionable filter uses the authenticated account's assignments. |
| `prs tool issue context <number> --json` | Returns repository identity, issue body, comments, managed spec/plan presence, and linked pull requests without changing state. |
| `prs tool issue ready <number> [--unattended\|--auto\|--jdi] --json` | Writes issue metadata under `.prs/runs`, including the suggested branch and managed artifact status. It does not create the branch. |
| `prs tool issue publish-artifacts <number> --spec-file <path> --plan-file <path> --json` | Validates approved non-empty Markdown and creates or updates the managed specification and plan comments. |
| `prs tool issue create --draft-file <path> --json` | Creates or reuses one issue from an approved Markdown draft. Optional labels, managed markers, spec/plan files, and a media manifest are supported. |
| `prs tool issue create --issue-set <path> --json` | Creates or reuses a linked set described by a version-1 JSON manifest. `--run-dir` resolves relative draft paths. |
| `prs issue finalize <number>` | Shows deterministic commit text and the exact staged paths, asks for explicit confirmation, and creates one local commit from the existing index. It does not stage files, push, or open a pull request. |

The single-draft Markdown format starts with an H1 title; the remainder becomes the issue body. A linked issue-set manifest contains `version`, `mode`, and `issues`, where each issue has an `id`, `draftFile`, and optional `dependsOn`, `blocks`, and `related` IDs.

## Pull request tools

| Command | Behaviour |
| --- | --- |
| `prs tool pr list [--actionable] --json` | Lists open pull requests, optionally filtered to items actionable by the authenticated account. |
| `prs tool pr ready <number> [--unattended\|--auto\|--jdi] --json` | Requires a clean checkout, checks out the PR head, fetches and merges the latest base, runs `prReadiness.commands`, records logs under `.prs/runs`, and returns checks, comments, and review-thread context. Unattended aliases may start a configured local application runtime. |

Readiness stops with a structured blocked result for merge conflicts, a failed local-readiness command, or a failed runtime start. It never pushes or merges the pull request.

Use the `prs-pr` skill to coordinate main-checkout preparation and follow-up `review`, `resolve-conflicts`, `address-comments`, and `fix-tests` actions. They are skill actions executed with the host's normal Git/GitHub capabilities, not `prs tool pr` subcommands. The skill handles review preparation/publication and guarded pushes while preserving approval gates and support for PRs without linked issues. See [the workflow guide](agent-workflows.md#existing-pull-requests).

## Audit

### Render local usage

```text
prs tool token-usage render --file <usage-evidence.json> --output <token-usage.md> --json
prs tool token-usage capture --host <codex|claude-code|copilot> --output <usage-evidence.json> [--session <id>] [--source <path>] [--since <ISO>] --json
```

Both required paths resolve from the repository root and must be within the same concrete `.prs/runs/<runId>/` directory; the envelope's `runId` must match. Traversal, symlink escapes, input/output aliases, malformed evidence, and conflicting counters fail without replacing existing output. Successful rerenders replace the selected local Markdown file deterministically. No forge configuration or authentication is required and no network calls occur.

The JSON result contains `status: rendered`, `outputFile`, local source/normalized `ledger`, derived `totals` with contributions and exclusions, `pricing` (estimates, unpriced reasons, reported charges, credits/conversions, and rate cards), and `warnings`. JSON includes raw local evidence: publish only the reviewed Markdown, never redirect raw JSON into a GitHub comment. Unknowns remain unknown, and partial totals/estimates are labelled. See [the version-1 contract and examples](usage-evidence.md).

### Publish a reviewed report

`prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name>` publishes or updates a marker-managed audit section on GitHub. `--local-run` adds a local run reference. `--media-manifest` appends validated image or video evidence.

## Exit behaviour

Invalid arguments, missing files, invalid configuration, unavailable authentication, and failed local commands produce a non-zero exit. JSON tools return structured `blocked` results for expected forge or readiness states where the caller needs a next action.
