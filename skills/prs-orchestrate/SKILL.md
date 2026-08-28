---
name: prs-orchestrate
description: Use when a linked GitHub issue set needs dependency-aware coordination, separate pull requests, and one final validation pass.
---

# Orchestrate a prs issue set

Keep each issue independently reviewable while one coordinator owns dependency order and final validation.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

1. Load every issue with `prs tool issue context <number> --json`. Build the dependency graph from explicit links and acceptance criteria.
2. Refine and plan each issue before implementation. Keep each child issue's specification, plan, and working notes in its own task-specific run directory. Obtain explicit user approval before publishing any GitHub artifacts.
3. Prefer a separate branch or worktree per issue. If isolation is unavailable, execute in the active workspace one issue at a time.
4. Delegate only independent ready issues when the host supports it and the user authorized delegation. Otherwise execute sequentially. Never parallelize tasks that share unmerged state.
5. For each issue: run `prs tool issue ready`, implement, verify, use `prs-finish`, and keep its pull request separate.
6. Merge dependency pull requests in order. Refresh the base before starting a dependent issue.
7. After all children are integrated, run the full repository verification suite and the cross-host or product acceptance checks required by the parent issue. Keep coordinator notes and final evidence in the parent's task-specific run directory.
8. Publish the final audit only with explicit user approval. Report each issue, pull request, merge result, verification result, and any capability fallback.

Do not use one successful child or one host's result as evidence for another required row. Before destructive cleanup, obtain separate explicit user approval.
