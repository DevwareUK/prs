---
name: prs-finish
description: Use when implementation is complete and issue work must be freshly verified, committed, opened as a pull request, and validated on GitHub.
---

# Finish prs work

Finish only when the requested outcome is implemented and the working tree contains no unrelated user work.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

## Audit publication authorization

An explicit user request for issue implementation with `--jdi`, `--auto` or `--unattended` is upfront authorization to publish routine completion and token-usage audits to that issue and its resulting pull request. Carry this authorization through `prs-issue`, `prs-finish` and `prs-pr`: retain the originating user request, execution mode and issue/PR targets in local run notes. Do not ask for another approval for those audits.

Without that authorization, show the exact reports and obtain explicit user approval before publication. A later user instruction to withhold publication overrides the earlier authorization. A readiness-tool flag alone does not grant audit publication authorization.

In either mode, write and self-review the reports, verify current results and targets, and publish only the completion Markdown and rendered usage Markdown. Keep raw JSON, transcripts and private source paths local. Preserve unavailable, partial and unpriced evidence honestly. Confirm publication before reporting it complete.

This authorization does not cover issue creation, specification or plan publication, discussion comments, PR reviews, merging or destructive cleanup. Those actions retain their existing approval gates.

## Completion

1. Preflight the forge for PR publication and the tracker for any required issue reads/audits before committing or remote mutations; disabling an unrelated integration does not block PR-only work. Review the diff against the approved issue scope and acceptance criteria.
2. Run fresh verification. Fix in-scope failures; report inherited or external failures with evidence.
3. Stage only files that belong to the approved issue and inspect `git diff --cached --name-status`. Run `prs issue finalize <number>`, then approve only after checking its displayed commit message and staged paths.

The command commits only the existing index and leaves unstaged changes and untracked files untouched.

4. Push the issue branch and open or update its pull request with the host's normal GitHub capability. Keep one issue task per pull request unless the approved plan says otherwise.
5. Use `prs-pr` to prepare the pull request in the main checkout with `prs tool pr ready <number> --json`, including its checkout and worktree preflight. Resolve local-readiness failures or merge conflicts within the authorized scope and re-run verification.
6. Write a concise completion artifact in the run directory returned for this task. If none is available, create a task-specific directory beneath `.prs/runs`. Apply the audit publication authorization above when publishing the reviewed content with `prs audit publish --issue <number> ...` or `prs audit publish --pr <number> ...`.
7. Confirm hosted checks and review state. Perform Completion cleanup under the recorded cleanup authorization before the final handoff; preserve or report any resources that cannot safely be removed. Never discard uncommitted or unpushed work.

Once the pull request exists, use `prs-pr` for requested pull request testing, review, comment fixes, conflict resolution, or failing-test repairs in the main checkout. Preserve the PR number and authorized scope; readiness alone does not authorize those follow-up actions. Existing PRs with no linked issue use `prs-pr` directly and its normal Git finalization, without returning to this issue-finishing flow.

Never claim completion from stale verification, a pending check, or a local commit that was not pushed.

## Completion cleanup

Make cleanup part of finishing the authorized task. Reuse an explicit task- or project-scoped cleanup approval while its scope is unchanged; do not ask again. Read `~/.agents/prs-cleanup-policy.md` when present for the user's recorded standing authorization; respect its exact scope and any later task instruction. Never create or broaden that personal policy without the user's authorization. Implementation, audit publication and JDI modes alone do not authorize deletion. Without cleanup authorization, prepare the exact cleanup scope and ask once before deleting it.

Keep lightweight records (specification, plan, completion summary, verification metadata, rendered usage and its source evidence) in the run directory. Put disposable copied checkouts, dependencies, builds and synthetic fixtures under `.prs/runs/<run>/scratch/`. Record exact paths, worktrees, Compose projects, image references and fixture-volume ownership when creating them. Keep recovery backups under the project's backup/retention policy, not silently inside an indefinitely retained run.

After verification, pushing the work, required hosted validation and approved evidence publication are complete, clean the resources that the finished task no longer needs before the final handoff:

- Remove recorded disposable source copies, `node_modules`, Composer dependencies and build/cache directories. Preserve lightweight records and any explicitly retained failure evidence. Do not infer disposability from a path prefix or age alone, and do not delete an entire `.prs` directory.
- Tear down only the run's owned test stack through the project's normal teardown. Remove exact temporary images or synthetic fixture volumes only when ownership is established and no container references them. Preserve canonical application data, external volumes and other agents' resources. Do not use global Docker pruning as a finish step.
- Remove an isolated worktree only after a fresh check proves it has no uncommitted or untracked source changes, no unpublished commits, no active process/editor/container references and no unknown ignored user files. Verify the exact HEAD is published or preserved by a verified merge. Keep the branch/remote PR available for later review; do not delete branches as a side effect. Use the native host's worktree lifecycle when it owns the checkout; otherwise run `git worktree remove` from outside it, without force. Never remove the canonical checkout.
- If ownership, publication, references or ignored-file safety is uncertain, keep that resource and report the exact reason. Do not copy the whole worktree or its bulky generated files into a new recovery directory to make removal succeed. Preserve unfinished work and useful failure evidence until it is explicitly finished or abandoned with an approved cleanup scope.

Write a small cleanup receipt in the retained run directory listing removed resources, kept resources/reasons and measured space recovered when available. A run is not fully cleaned merely because its Git worktree was removed: separately check copied source trees and generated payloads in its run directory. Report any deferred cleanup honestly.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). For local Copilot app/CLI sessions, opted-in PRS telemetry setup supplies a fresh managed session binding for the same repository and a verified managed exporter to the bare capture command. Explicit `--session` and `--source` values remain authoritative. Missing, stale, invalid, or ambiguous managed bindings stay unavailable rather than selecting a recent session; hosted Copilot coding-agent evidence remains unsupported. Do not guess the latest session, search transcript contents, add or alter hooks during capture, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Apply the audit publication authorization above when publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.
