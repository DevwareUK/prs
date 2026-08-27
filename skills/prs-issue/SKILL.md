---
name: prs-issue
description: Use when refining, planning, implementing, verifying, or completing one existing GitHub issue through the prs lifecycle.
---

# Work a prs issue

Run `prs tool issue context <number> --json` first. Reconcile the issue body, comments, linked pull requests, and managed artifact status before changing code.

## Lifecycle

1. Refine the intended outcome and acceptance criteria. Draft the settled specification and implementation plan locally.
2. Obtain explicit user approval before publishing them with `prs tool issue publish-artifacts <number> --spec-file <path> --plan-file <path> --json`.
3. Run `prs tool issue ready <number> --json` and use its suggested branch and run directory.
4. Prefer a fresh branch or worktree from the updated configured base. If isolation is unavailable, continue in the active workspace and record the fallback.
5. Implement in small verified steps. Delegate independent tasks only when supported and authorized; otherwise execute sequentially.
6. Run the repository's relevant verification, including tests for changed behaviour.
7. Continue with `prs-finish` for deterministic local commit finalization, pull-request creation, GitHub validation, and audit evidence.

Do not stop at readiness metadata, treat a missing capability as permission to skip a phase, or publish GitHub content without explicit user approval.
