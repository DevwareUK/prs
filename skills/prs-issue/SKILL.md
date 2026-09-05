---
name: prs-issue
description: Use when refining, planning, implementing, verifying, or completing one existing GitHub issue through the prs lifecycle.
---

# Work a prs issue

Run `prs tool issue context <number> --json` first. Reconcile the issue body, comments, linked pull requests, and managed artifact status before changing code.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

PRS artifact locality overrides the Superpowers default document paths and commit instructions. Both written artifacts are required even for bounded work. If either required Superpowers skill is unavailable, report the blocker and next action; do not skip a phase.

## Refinement

Start from `prs tool issue context <number> --json`: reconcile the existing issue body, discussion, managed artifacts, linked pull requests and repository behavior with the requested changes. Preserve the original issue number, URL and request body. Never create a replacement issue or linked set from refinement; splitting work is a separate user request. Ask clarification questions in the active session; publishing discussion comments requires explicit authorization.

### Specification approval

Use `superpowers:brainstorming` to settle the intended outcome and acceptance criteria. Write and self-review the specification in the task-specific run directory.

Show the specification file and wait for explicit user approval before proceeding to the plan. If the user requests changes, revise and show the specification again; wait for approval of the revised content.

### Plan approval

Use `superpowers:writing-plans` to write and self-review the implementation plan from the approved specification. Include concrete files, steps, acceptance coverage and verification commands checked against repository source.

Show the plan file and wait for explicit user approval before publication. If a revision changes the specification, return to specification approval and update the plan to match. Existing managed comments provide context; their presence alone is not approval of the current refinement. Preserve established approvals for unchanged content when they clearly cover the current request.

### Publication approval

Show both reviewed artifacts and the original issue target. Obtain explicit user approval to publish both managed comments on that same issue. Plan approval and publication authorization can share a response only when the request explicitly covers both actions and the exact content. Design approval alone does not authorize publication. An acknowledgment accompanied by a question or scope change is not publication approval: show the revised artifacts and wait for explicit approval.

Before any remote write, check both files exist, contain non-empty Markdown and match the approved versions. Publish or update both artifacts on the original issue:

```bash
prs tool issue publish-artifacts <number> --spec-file .prs/runs/<run>/spec.md --plan-file .prs/runs/<run>/plan.md --json
```

### Completion verification

For the original issue, require `managedComments` records with `status: published` for both `<!-- prs:issue-spec -->` and `<!-- prs:issue-plan -->`. Missing artifacts mean incomplete work even when a tool returns `status: ok`. Read `prs tool issue context <number> --json` and confirm both managed artifacts are present; check the published content matches the approved files.

If publication is partial, preserve the known issue number and approved files. Retry `prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json` under existing authorization for those exact artifacts and target. Changed content or targets require renewed approval. If recovery is blocked, report the issue, missing artifact, tool message and next action; do not declare completion.

Report the original issue number, title and URL, plus both verified managed-comment URLs. For a refine-only request, stop after verified publication unless implementation was requested. Refinement alone does not authorize readiness, checkout, implementation, commits or a pull request.

## Lifecycle

Continue here only when implementation was requested. An implementation request (including `--jdi`, `--auto` or `--unattended`) authorizes the implementation lifecycle; it does not waive specification, plan or publication approval gates. For a refine-only request, follow Refinement and stop.

1. Reconcile the live specification and plan with the requested implementation. Use the Refinement process above if artifacts are missing or need changes. Reuse existing approved, unchanged artifacts; do not republish them just to start implementation.
2. Run `prs tool issue ready <number> --json` and use its suggested branch and returned run directory. Keep subsequent working notes and evidence in that returned directory.
3. Prefer a fresh branch or worktree from the updated configured base. If isolation is unavailable, continue in the active workspace and record the fallback.
4. Implement in small verified steps. Delegate independent tasks only when supported and authorized; otherwise execute sequentially.
5. Run the repository's relevant verification, including tests for changed behaviour.
6. Continue with `prs-finish` for deterministic local commit finalization, pull-request creation, GitHub validation, and audit evidence.

For an implementation request, do not stop at readiness metadata. Missing capabilities do not authorize skipping phases, and implementation authorization does not authorize publishing unreviewed GitHub comments.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). Copilot needs its exact session ID plus a local export selected by `--source` or `COPILOT_OTEL_FILE_EXPORTER_PATH`, enabled before starting the session. Do not guess the latest session, search transcript contents, install hooks, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Obtain explicit user approval before publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.
