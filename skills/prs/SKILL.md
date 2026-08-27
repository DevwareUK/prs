---
name: prs
description: Use when choosing or coordinating a prs issue, pull-request, creation, completion, or multi-issue workflow in a prs-configured GitHub repository.
---

# prs

Use `prs` as the router for the local GitHub workflow. The active coding agent owns reasoning and implementation; deterministic `prs tool ... --json` commands provide state and perform approved writes.

## Route

- New issue or linked set: use `prs-create`.
- One existing issue: use `prs-issue`.
- Several linked issues with separate outcomes: use `prs-orchestrate`.
- Verify, commit, open or update a pull request, and publish final evidence: use `prs-finish`.
- Existing pull request: run `prs tool pr ready <number> --json`, then inspect the returned checks, comments, readiness steps, and local runtime guidance.
- No selected issue or pull request: run `prs tool issue list --actionable --json` or `prs tool pr list --actionable --json` and show number, title, and URL.

## Shared safeguards

- Get explicit user approval immediately before creating issues or publishing GitHub comments.
- Get explicit user approval before destructive cleanup. Never discard uncommitted or unpushed work.
- Prefer an isolated branch or worktree. If isolation is unavailable, continue in the active workspace and report that fallback.
- Delegate independent work only when the host supports delegation and the user has authorized it. Otherwise execute sequentially.
- Run fresh verification before completion. Report failures and preserve evidence under `.prs/runs`.
- Use the host's normal Git and GitHub capabilities for pushing and pull-request creation; do not invent a missing `prs tool` command.

## Common mistakes

- Treating a readiness response as implementation completion.
- Publishing locally drafted content before approval.
- Claiming parity based on command spelling instead of matching outcomes and safeguards.
