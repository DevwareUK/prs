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
