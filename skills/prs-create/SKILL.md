---
name: prs-create
description: Use when turning a rough idea into one approved GitHub issue or a dependency-linked issue set in a prs-configured repository.
---

# Create prs issues

Draft implementation-ready work in a task-specific directory beneath `.prs/runs`, then use the deterministic creation tool only after approval.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

1. Inspect the repository and clarify only decisions that materially change scope, behaviour, data, access, rollout, or acceptance criteria.
2. Inside the task-specific run directory, draft an H1-titled Markdown issue. For multiple tasks, keep one draft per issue plus the version-1 linked-set manifest with stable IDs and dependency links in that directory.
3. Keep the specification and plan Markdown in the same task-specific run directory when the scope is settled.
4. Show the proposed issue or set and obtain explicit user approval for the GitHub write.
5. Run `prs tool issue create --draft-file <path> --json` or `prs tool issue create --issue-set <manifest> --run-dir .prs/runs/<task-specific-run> --json`. Add approved `--spec-file` and `--plan-file` artifacts when available.
6. Report every created or reused issue by number, title, and URL, plus any managed-comment hints.

Keep raw prompts and working notes in the task-specific run directory. If creation is blocked, return the tool's message and next action without substituting an unapproved remote write.

Before destructive cleanup, obtain separate explicit user approval.

## Usage evidence

Reuse native baseline/final observations already available during this task. Keep stable event IDs and explicit counter scopes; phase/attempt changes do not reset cumulative-snapshot counters. Store version-1 evidence as `usage-evidence.json` in the selected run directory, with `runId` matching its directory name. Model tokens, named host counters, credits, charges, and entitlements are distinct units. Declare overlapping parent/child or request/snapshot coverage and its authoritative representation; declare independent coverage disjoint. Preserve raw fields locally, not in published prose.

If capture is unavailable, record a reason instead of zero. Adapt this complete minimal envelope to the active host, actual run, phase, observation time, and stable event identity:

```json
{"version":1,"kind":"usage-evidence","runId":"example","events":[{"eventId":"example:verify:1","host":"codex","adapter":{"name":"host-native","version":1},"source":{"id":"active-task","kind":"host"},"counterScopeId":"active-task","observedAt":"2026-09-03T10:00:00Z","workflow":{"runId":"example","phase":"verify","phaseAttemptId":"verify:1"},"measurementKind":"cumulative-snapshot","unit":"model-tokens","coverage":{"id":"task-work","representationId":"active-task"},"status":"unavailable","reason":"Native usage was not exposed by this host"}]}
```

Use `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json` before completion reporting. Inspect warnings and partial/unpriced results; missing evidence must not trigger extra model calls, credential discovery, or private-log scraping. Supported native envelopes and sourced rate-card examples are documented in the PRS source's `docs/usage-evidence.md`. If that reference or a supported capture format is unavailable, use the unavailable envelope.

Review the rendered summary and obtain explicit user approval before publishing with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Reuse the same evidence when republishing; do not mint duplicate events or claim native validation from static fixtures.
