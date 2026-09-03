---
name: prs-issue
description: Use when refining, planning, implementing, verifying, or completing one existing GitHub issue through the prs lifecycle.
---

# Work a prs issue

Run `prs tool issue context <number> --json` first. Reconcile the issue body, comments, linked pull requests, and managed artifact status before changing code.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

## Lifecycle

1. Refine the intended outcome and acceptance criteria. Draft the settled specification and implementation plan in a task-specific directory beneath `.prs/runs`.
2. Obtain explicit user approval before publishing them with `prs tool issue publish-artifacts <number> --spec-file <path> --plan-file <path> --json`.
3. Run `prs tool issue ready <number> --json` and use its suggested branch and returned run directory. Keep subsequent working notes and evidence in that returned directory.
4. Prefer a fresh branch or worktree from the updated configured base. If isolation is unavailable, continue in the active workspace and record the fallback.
5. Implement in small verified steps. Delegate independent tasks only when supported and authorized; otherwise execute sequentially.
6. Run the repository's relevant verification, including tests for changed behaviour.
7. Continue with `prs-finish` for deterministic local commit finalization, pull-request creation, GitHub validation, and audit evidence.

Do not stop at readiness metadata, treat a missing capability as permission to skip a phase, or publish GitHub content without explicit user approval.

## Usage evidence

Reuse native baseline/final observations already available during this task. Keep stable event IDs and explicit counter scopes; phase/attempt changes do not reset cumulative-snapshot counters. Store version-1 evidence as `usage-evidence.json` in the selected run directory, with `runId` matching its directory name. Model tokens, named host counters, credits, charges, and entitlements are distinct units. Declare overlapping parent/child or request/snapshot coverage and its authoritative representation; declare independent coverage disjoint. Preserve raw fields locally, not in published prose.

If capture is unavailable, record a reason instead of zero. Adapt this complete minimal envelope to the active host, actual run, phase, observation time, and stable event identity:

```json
{"version":1,"kind":"usage-evidence","runId":"example","events":[{"eventId":"example:verify:1","host":"codex","adapter":{"name":"host-native","version":1},"source":{"id":"active-task","kind":"host"},"counterScopeId":"active-task","observedAt":"2026-09-03T10:00:00Z","workflow":{"runId":"example","phase":"verify","phaseAttemptId":"verify:1"},"measurementKind":"cumulative-snapshot","unit":"model-tokens","coverage":{"id":"task-work","representationId":"active-task"},"status":"unavailable","reason":"Native usage was not exposed by this host"}]}
```

Use `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json` before completion reporting. Inspect warnings and partial/unpriced results; missing evidence must not trigger extra model calls, credential discovery, or private-log scraping. Supported native envelopes and sourced rate-card examples are documented in the PRS source's `docs/usage-evidence.md`. If that reference or a supported capture format is unavailable, use the unavailable envelope.

Review the rendered summary and obtain explicit user approval before publishing with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Reuse the same evidence when republishing; do not mint duplicate events or claim native validation from static fixtures.
