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
