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
5. Run `prs tool pr ready <number> --json`; resolve local-readiness failures or merge conflicts and re-run verification.
6. Write a concise completion artifact in the run directory returned for this task. If none is available, create a task-specific directory beneath `.prs/runs`. Obtain explicit user approval before publishing the reviewed content with `prs audit publish --issue <number> ...` or `prs audit publish --pr <number> ...`.
7. Confirm hosted checks and review state. Clean branches or worktrees only after explicit approval and only when no uncommitted or unpushed work can be lost.

Never claim completion from stale verification, a pending check, or a local commit that was not pushed.

## Usage evidence

Reuse native baseline/final observations already available during this task. Keep stable event IDs and explicit counter scopes; phase/attempt changes do not reset cumulative-snapshot counters. Store version-1 evidence as `usage-evidence.json` in the selected run directory, with `runId` matching its directory name. Model tokens, named host counters, credits, charges, and entitlements are distinct units. Declare overlapping parent/child or request/snapshot coverage and its authoritative representation; declare independent coverage disjoint. Preserve raw fields locally, not in published prose.

If capture is unavailable, record a reason instead of zero. Adapt this complete minimal envelope to the active host, actual run, phase, observation time, and stable event identity:

```json
{"version":1,"kind":"usage-evidence","runId":"example","events":[{"eventId":"example:verify:1","host":"codex","adapter":{"name":"host-native","version":1},"source":{"id":"active-task","kind":"host"},"counterScopeId":"active-task","observedAt":"2026-09-03T10:00:00Z","workflow":{"runId":"example","phase":"verify","phaseAttemptId":"verify:1"},"measurementKind":"cumulative-snapshot","unit":"model-tokens","coverage":{"id":"task-work","representationId":"active-task"},"status":"unavailable","reason":"Native usage was not exposed by this host"}]}
```

Use `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json` before completion reporting. Inspect warnings and partial/unpriced results; missing evidence must not trigger extra model calls, credential discovery, or private-log scraping. Supported native envelopes and sourced rate-card examples are documented in the PRS source's `docs/usage-evidence.md`. If that reference or a supported capture format is unavailable, use the unavailable envelope.

Review the rendered summary and obtain explicit user approval before publishing with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Reuse the same evidence when republishing; do not mint duplicate events or claim native validation from static fixtures.
