---
name: prs-orchestrate
description: Use when a linked GitHub issue set needs dependency-aware coordination, separate pull requests, and one final validation pass.
---

# Orchestrate a prs issue set

Keep each issue independently reviewable while one designated parent owns coordination, integration and final acceptance. Dependency order is separate from parent hierarchy and native parent/child membership.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

1. Load every issue with `prs tool issue context <number> --json`. Confirm the designated parent and children from native hierarchy, but build execution readiness only from explicit dependency links and acceptance criteria. Never infer a parent from order, title or dependency edges.
2. Consume each issue's own approved, issue-specific specification and plan. Keep each child's artifacts and working notes in its own task-specific run directory. Reuse established approval for unchanged published content; refine and obtain explicit user approval only when an issue's content must change.
3. Prefer a separate branch or worktree per issue. If isolation is unavailable, execute in the active workspace one issue at a time.
4. Delegate only independent ready issues when the host supports it and the user authorized delegation. Otherwise execute sequentially. Never parallelize tasks that share unmerged state.
5. For each issue: run `prs tool issue ready`, implement, verify, use `prs-finish`, and keep its pull request separate.
6. Merge dependency pull requests in order. Refresh the base before starting a dependent issue.
7. After all children are integrated, the designated parent performs the full repository verification suite, integration checks and cross-issue final acceptance. Keep coordinator notes and final evidence in the parent's task-specific run directory.
8. Publish the final audit only with explicit user approval. Report each issue, pull request, merge result, verification result, and any capability fallback.

An explicitly flat set has no parent mutation or implied coordinator; orchestrate it only when the user separately requests coordination. Creating a set never starts agents or merges pull requests. Do not hardcode a model, branch or merge policy. Do not use one successful child or one host's result as evidence for another required row. Before destructive cleanup, obtain separate explicit user approval.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). For local Copilot app/CLI sessions, opted-in PRS telemetry setup supplies a fresh managed session binding for the same repository and a verified managed exporter to the bare capture command. Explicit `--session` and `--source` values remain authoritative. Missing, stale, invalid, or ambiguous managed bindings stay unavailable rather than selecting a recent session; hosted Copilot coding-agent evidence remains unsupported. Do not guess the latest session, search transcript contents, add or alter hooks during capture, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Obtain explicit user approval before publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.
