---
name: prs-create
description: Use when turning a rough idea into one approved GitHub issue or a dependency-linked issue set in a prs-configured repository.
---

# Create prs issues

Draft implementation-ready work locally, then use the deterministic creation tool only after approval.

1. Inspect the repository and clarify only decisions that materially change scope, behaviour, data, access, rollout, or acceptance criteria.
2. Draft an H1-titled Markdown issue. For multiple tasks, draft one file per issue plus a version-1 linked-set manifest with stable IDs and dependency links.
3. Prepare specification and plan Markdown when the scope is settled.
4. Show the proposed issue or set and obtain explicit user approval for the GitHub write.
5. Run `prs tool issue create --draft-file <path> --json` or `prs tool issue create --issue-set <manifest> --run-dir <dir> --json`. Add approved `--spec-file` and `--plan-file` artifacts when available.
6. Report every created or reused issue by number, title, and URL, plus any managed-comment hints.

Keep raw prompts and working notes local. If creation is blocked, return the tool's message and next action without substituting an unapproved remote write.

Before destructive cleanup, obtain separate explicit user approval.
