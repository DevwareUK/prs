---
name: prs-finish
description: Use when implementation is complete and issue work must be freshly verified, committed, opened as a pull request, and validated on GitHub.
---

# Finish prs work

Finish only when the requested outcome is implemented and the working tree contains no unrelated user work.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

1. Review the diff against the approved issue scope and acceptance criteria.
2. Run fresh verification. Fix in-scope failures; report inherited or external failures with evidence.
3. Stage only files that belong to the approved issue and inspect `git diff --cached --name-status`. Run `prs issue finalize <number>`, then approve only after checking its displayed commit message and staged paths.

The command commits only the existing index and leaves unstaged changes and untracked files untouched.

4. Push the issue branch and open or update its pull request with the host's normal GitHub capability. Keep one issue task per pull request unless the approved plan says otherwise.
5. Use `prs-pr` to prepare the pull request in the main checkout with `prs tool pr ready <number> --json`, including its checkout and worktree preflight. Resolve local-readiness failures or merge conflicts within the authorized scope and re-run verification.
6. Write a concise completion artifact in the run directory returned for this task. If none is available, create a task-specific directory beneath `.prs/runs`. Obtain explicit user approval before publishing the reviewed content with `prs audit publish --issue <number> ...` or `prs audit publish --pr <number> ...`.
7. Confirm hosted checks and review state. Clean branches or worktrees only after explicit approval and only when no uncommitted or unpushed work can be lost.

Once the pull request exists, use `prs-pr` for requested pull request testing, review, comment fixes, conflict resolution, or failing-test repairs in the main checkout. Preserve the PR number and authorized scope; readiness alone does not authorize those follow-up actions. Existing PRs with no linked issue use `prs-pr` directly and its normal Git finalization, without returning to this issue-finishing flow.

Never claim completion from stale verification, a pending check, or a local commit that was not pushed.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). Copilot needs its exact session ID plus a local export selected by `--source` or `COPILOT_OTEL_FILE_EXPORTER_PATH`, enabled before starting the session. Do not guess the latest session, search transcript contents, install hooks, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Obtain explicit user approval before publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.
