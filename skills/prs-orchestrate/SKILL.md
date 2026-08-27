---
name: prs-orchestrate
description: Use when a linked GitHub issue set needs dependency-aware coordination, separate pull requests, and one final validation pass.
---

# Orchestrate a prs issue set

Keep each issue independently reviewable while one coordinator owns dependency order and final validation.

1. Load every issue with `prs tool issue context <number> --json`. Build the dependency graph from explicit links and acceptance criteria.
2. Refine and plan each issue before implementation. Obtain explicit user approval before publishing any GitHub artifacts.
3. Prefer a separate branch or worktree per issue. If isolation is unavailable, execute in the active workspace one issue at a time.
4. Delegate only independent ready issues when the host supports it and the user authorized delegation. Otherwise execute sequentially. Never parallelize tasks that share unmerged state.
5. For each issue: run `prs tool issue ready`, implement, verify, use `prs-finish`, and keep its pull request separate.
6. Merge dependency pull requests in order. Refresh the base before starting a dependent issue.
7. After all children are integrated, run the full repository verification suite and the cross-host or product acceptance checks required by the parent issue.
8. Publish the final audit only with explicit user approval. Report each issue, pull request, merge result, verification result, and any capability fallback.

Do not use one successful child or one host's result as evidence for another required row. Before destructive cleanup, obtain separate explicit user approval.
