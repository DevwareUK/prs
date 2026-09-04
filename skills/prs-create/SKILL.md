---
name: prs-create
description: Use when turning a rough idea into one approved GitHub issue or a dependency-linked issue set in a prs-configured repository.
---

# Create prs issues

Draft implementation-ready work in a task-specific directory beneath `.prs/runs`, then use the deterministic creation tool only after approval.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

1. Inspect the repository and clarify only decisions that materially change scope, behaviour, data, access, rollout, or acceptance criteria.
2. Inside the task-specific run directory, draft an H1-titled Markdown issue. For multiple tasks, keep one draft per issue plus the version-1 linked-set manifest with stable IDs and dependency links in that directory.
3. Keep the specification and plan Markdown in the same task-specific run directory when the scope is settled.
4. Show the proposed issue or set and obtain explicit user approval for the GitHub write.
5. Run `prs tool issue create --draft-file <path> --json` or `prs tool issue create --issue-set <manifest> --run-dir .prs/runs/<task-specific-run> --json`. Add approved `--spec-file` and `--plan-file` artifacts when available.
6. Report every created or reused issue by number, title, and URL, plus any managed-comment hints.

Keep raw prompts and working notes in the task-specific run directory. If creation is blocked, return the tool's message and next action without substituting an unapproved remote write.

Before destructive cleanup, obtain separate explicit user approval.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). Copilot needs its exact session ID plus a local export selected by `--source` or `COPILOT_OTEL_FILE_EXPORTER_PATH`, enabled before starting the session. Do not guess the latest session, search transcript contents, install hooks, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Obtain explicit user approval before publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.
