---
name: prs-finish
description: Use when implementation is complete and issue work must be freshly verified, committed, opened as a pull request, and validated on GitHub.
---

# Finish prs work

Finish only when the requested outcome is implemented and the working tree contains no unrelated user work.

1. Review the diff against the approved issue scope and acceptance criteria.
2. Run fresh verification. Fix in-scope failures; report inherited or external failures with evidence.
3. Obtain explicit user approval for the deterministic commit, then run `prs issue finalize <number>`.
4. Push the issue branch and open or update its pull request with the host's normal GitHub capability. Keep one issue task per pull request unless the approved plan says otherwise.
5. Run `prs tool pr ready <number> --json`; resolve local-readiness failures or merge conflicts and re-run verification.
6. Write a concise completion artifact under `.prs/runs`. Obtain explicit user approval before publishing it with `prs audit publish --issue <number> ...` or `prs audit publish --pr <number> ...`.
7. Confirm hosted checks and review state. Clean branches or worktrees only after explicit approval and only when no uncommitted or unpushed work can be lost.

Never claim completion from stale verification, a pending check, or a local commit that was not pushed.
