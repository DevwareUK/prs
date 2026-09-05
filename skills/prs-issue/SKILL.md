---
name: prs-issue
description: Use when refining, planning, implementing, verifying, or completing one existing GitHub issue through the prs lifecycle.
---

# Work a prs issue

Run `prs tool issue context <number> --json` first. Reconcile the issue body, comments, linked pull requests, and managed artifact status before changing code.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

## Lifecycle

1. Refine the intended outcome and acceptance criteria. Draft the settled specification and implementation plan in a task-specific directory beneath `.prs/runs`.
2. Obtain explicit user approval before publishing them with `prs tool issue publish-artifacts <number> --spec-file <path> --plan-file <path> --json`.
3. Run `prs tool issue ready <number> --json` and use its suggested branch and returned run directory. Keep subsequent working notes and evidence in that returned directory.
4. Prefer a fresh branch or worktree from the updated configured base. If isolation is unavailable, continue in the active workspace and record the fallback.
5. Implement in small verified steps. Delegate independent tasks only when supported and authorized; otherwise execute sequentially.
6. Run the repository's relevant verification, including tests for changed behaviour.
7. Continue with `prs-finish` for deterministic local commit finalization, pull-request creation, GitHub validation, and audit evidence.

Do not stop at readiness metadata, treat a missing capability as permission to skip a phase, or publish GitHub content without explicit user approval.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). Copilot needs its exact session ID plus a local export selected by `--source` or `COPILOT_OTEL_FILE_EXPORTER_PATH`, enabled before starting the session. Do not guess the latest session, search transcript contents, install hooks, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Obtain explicit user approval before publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.
