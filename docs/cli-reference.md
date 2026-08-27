# CLI reference

`prs --help` is the source of truth for the top-level command surface. Every `prs tool` command writes JSON and requires `--json`; diagnostics go to stderr.

## Setup

```text
prs setup [--skills <none|codex|claude-code|copilot|all>]
```

`prs setup` verifies the current directory is a Git repository, detects a default base branch and build command, then writes `.prs/config.json` and `.prs/.gitignore`. Existing `ai` and `githubActions` sections are removed with a visible migration notice.

Without `--skills`, setup asks whether to install personal skills for one host, every host, or none. An empty answer selects `none`. The flag supports repeatable non-interactive setup. Host selection affects personal skill files only and is not stored in repository configuration.

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

Parity validation installs all three host adapters into separate temporary homes, then compares each installed inventory, content hash, and retained operation reference with the canonical pack. The command reports static installation and instruction parity only. End-to-end native host results belong in the separate manual smoke matrix described in [the agent parity guide](agent-parity.md).

## Issue tools

| Command | Behaviour |
| --- | --- |
| `prs tool issue list [--actionable] --json` | Lists open GitHub issues. The actionable filter uses the authenticated account's assignments. |
| `prs tool issue context <number> --json` | Returns repository identity, issue body, comments, managed spec/plan presence, and linked pull requests without changing state. |
| `prs tool issue ready <number> [--unattended\|--auto\|--jdi] --json` | Writes issue metadata under `.prs/runs`, including the suggested branch and managed artifact status. It does not create the branch. |
| `prs tool issue publish-artifacts <number> --spec-file <path> --plan-file <path> --json` | Validates approved non-empty Markdown and creates or updates the managed specification and plan comments. |
| `prs tool issue create --draft-file <path> --json` | Creates or reuses one issue from an approved Markdown draft. Optional labels, managed markers, spec/plan files, and a media manifest are supported. |
| `prs tool issue create --issue-set <path> --json` | Creates or reuses a linked set described by a version-1 JSON manifest. `--run-dir` resolves relative draft paths. |
| `prs issue finalize <number>` | Shows deterministic commit text, asks for explicit confirmation, stages all local changes, and creates one local commit. It does not push or open a pull request. |

The single-draft Markdown format starts with an H1 title; the remainder becomes the issue body. A linked issue-set manifest contains `version`, `mode`, and `issues`, where each issue has an `id`, `draftFile`, and optional `dependsOn`, `blocks`, and `related` IDs.

## Pull request tools

| Command | Behaviour |
| --- | --- |
| `prs tool pr list [--actionable] --json` | Lists open pull requests, optionally filtered to items actionable by the authenticated account. |
| `prs tool pr ready <number> [--unattended\|--auto\|--jdi] --json` | Requires a clean checkout, checks out the PR head, fetches and merges the latest base, runs `prReadiness.commands`, records logs under `.prs/runs`, and returns checks, comments, and review-thread context. Unattended aliases may start a configured local application runtime. |

Readiness stops with a structured blocked result for merge conflicts, a failed local-readiness command, or a failed runtime start. It never pushes or merges the pull request.

## Audit

`prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name>` publishes or updates a marker-managed audit section on GitHub. `--local-run` adds a local run reference. `--media-manifest` appends validated image or video evidence.

## Exit behaviour

Invalid arguments, missing files, invalid configuration, unavailable authentication, and failed local commands produce a non-zero exit. JSON tools return structured `blocked` results for expected forge or readiness states where the caller needs a next action.
