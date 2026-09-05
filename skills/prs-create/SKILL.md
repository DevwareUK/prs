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

## Specification approval

Use `superpowers:brainstorming` to inspect repository behavior and clarify decisions that materially affect scope, data, access, rollout or acceptance criteria. Write and self-review the specification in the task-specific run directory.

Show the specification file and wait for explicit user approval before proceeding to the plan. If the user requests changes, revise and show the specification again; wait for approval of the revised content.

## Plan approval

Use `superpowers:writing-plans` to write and self-review the implementation plan from the approved specification. Include concrete files, steps, acceptance coverage and verification commands checked against repository source.

Show the plan file and wait for explicit user approval before issue creation or publication. If a revision changes the specification, return to specification approval and update the plan to match.

## Publication approval

Draft an H1-titled Markdown issue in the same run directory. For multiple tasks, keep one draft per issue plus a version-1 linked-set manifest with stable IDs and dependency links. The set-level specification and plan must map requirements, tasks and dependencies to every stable issue ID; the creation tool publishes the shared pair on every issue.

Show the exact issue draft or linked set and both reviewed artifacts. Obtain explicit user approval to create or reuse the issues and publish both managed comments. Plan approval and publication authorization can share a response only when the request explicitly covers both actions and the exact content. Design approval alone does not authorize publication. An acknowledgment accompanied by a question or scope change is not publication approval: show the revised artifacts and wait for explicit approval.

Before any remote write, check both files exist, contain non-empty Markdown and match the approved versions. Always pass both artifact files:

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
