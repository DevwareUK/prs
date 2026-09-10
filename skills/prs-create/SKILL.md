---
name: prs-create
description: Use when turning a rough idea into one approved GitHub issue or a dependency-linked issue set in a prs-configured repository.
---

# Create prs issues

Draft implementation-ready work in a task-specific directory beneath `.prs/runs`, then use the deterministic creation tool only after approval.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

PRS artifact locality overrides the Superpowers default document paths and commit instructions. Both written artifacts are required even for bounded work. If either required Superpowers skill is unavailable, report the blocker and next action; do not skip a phase.

## Artifact preparation

Use `superpowers:brainstorming` to inspect repository behavior and settle decisions that materially affect scope, data, access, rollout or acceptance criteria. Write and self-review the specification in the task-specific run directory. Then use `superpowers:writing-plans` to write and self-review the implementation plan from that candidate specification without requesting intermediate approval. Include concrete files, steps, acceptance coverage and verification commands checked against repository source.

Draft an H1-titled Markdown issue in the same run directory. For multiple tasks, keep one draft per issue plus a version-1 linked-set manifest with stable IDs and dependency links. The set-level specification and plan must map requirements, tasks and dependencies to every stable issue ID; the creation tool publishes the shared pair on every issue.

## Unified approval

Show the exact issue draft or linked set and both reviewed artifacts together as one complete approval packet. Obtain one explicit user approval that accepts the specification and plan and authorizes the workflow to create or reuse the displayed issues and publish both managed comments. Design approval alone does not authorize publication, and no remote write may happen before this approval.

A question, qualification, scope change, content change or target change is not approval. Update every affected artifact, ensure the packet is internally consistent, show the complete revised packet, and request one fresh approval rather than restarting staged approval gates.

Before any remote write, check both files exist, contain non-empty Markdown and match the displayed, approved versions. Always pass both artifact files:

```bash
prs tool issue create --draft-file .prs/runs/<run>/issue.md --spec-file .prs/runs/<run>/spec.md --plan-file .prs/runs/<run>/plan.md --json
prs tool issue create --issue-set .prs/runs/<run>/issue-set.json --run-dir .prs/runs/<run> --spec-file .prs/runs/<run>/spec.md --plan-file .prs/runs/<run>/plan.md --json
```

## Completion verification

For every created or reused issue, require `managedComments` records with `status: published` for both `<!-- prs:issue-spec -->` and `<!-- prs:issue-plan -->`. Missing artifacts reported in `managedCommentHints` mean incomplete work even when creation returns `status: ok`. Read `prs tool issue context <number> --json` and confirm both managed artifacts are present; check the published content matches the approved files.

If publication is partial, preserve the known issue numbers and approved files. Recover with `prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json` under existing authorization for those exact artifacts and targets. Do not repeat creation blindly after an uncertain response. Changed content or targets require renewed approval. If recovery is blocked, report the issue, missing artifact, tool message and next action; do not declare completion.

Report every created or reused issue by number, title and URL, plus both verified managed-comment URLs. Issue creation alone is not completion. Keep raw prompts and working notes local. Before destructive cleanup, obtain separate explicit user approval.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). Copilot needs its exact session ID plus a local export selected by `--source` or `COPILOT_OTEL_FILE_EXPORTER_PATH`, enabled before starting the session. Do not guess the latest session, search transcript contents, install hooks, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Obtain explicit user approval before publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.
