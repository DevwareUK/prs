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
3. Obtain explicit user approval for the deterministic commit, then run `prs issue finalize <number>`.
4. Push the issue branch and open or update its pull request with the host's normal GitHub capability. Keep one issue task per pull request unless the approved plan says otherwise.
5. Run `prs tool pr ready <number> --json`; resolve local-readiness failures or merge conflicts and re-run verification.
6. Write a concise completion artifact in the run directory returned for this task. If none is available, create a task-specific directory beneath `.prs/runs`. Obtain explicit user approval before publishing the reviewed content with `prs audit publish --issue <number> ...` or `prs audit publish --pr <number> ...`.
7. Confirm hosted checks and review state. Clean branches or worktrees only after explicit approval and only when no uncommitted or unpushed work can be lost.

Never claim completion from stale verification, a pending check, or a local commit that was not pushed.
