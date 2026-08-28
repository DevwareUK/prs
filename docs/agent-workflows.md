# Active-agent workflows

The portable flow is deliberately split:

- the active coding agent owns questions, specifications, plans, implementation, review, and user approval;
- `prs` owns deterministic local GitHub, Git, artifact, and validation operations.

## Local artifact contract

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`. Issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence all stay below this root.

These raw files remain ignored and local; never stage or commit them, and never create an alternative repository-local scratch root such as `.prs-work`. Explicitly approved publication commands may publish reviewed specification, plan, or completion content to managed GitHub comments; publication does not make the raw local files repository content.

Codex, Claude Code, and GitHub Copilot should use the same lifecycle and command contract:

1. create approved issue drafts with `prs tool issue create`;
2. read live state with `prs tool issue context`;
3. publish approved specification and plan files with `prs tool issue publish-artifacts`;
4. prepare implementation metadata with `prs tool issue ready`;
5. work and verify in an isolated branch or worktree when the host supports it;
6. create a deterministic local commit with `prs issue finalize`;
7. open or update the pull request through the host's normal GitHub capability;
8. validate it with `prs tool pr ready` and publish evidence with `prs audit publish`.

If a host cannot create worktrees, it continues in the active workspace. If it cannot delegate, it executes independent tasks sequentially. These fallbacks are part of the contract and must not silently drop lifecycle phases.

Remote mutations require explicit user approval. Read-only context gathering does not.

## Canonical skill pack

`skills/manifest.json` is the portable inventory. It maps the five shared skill names to their source files and lifecycle phases:

- `prs`: workflow router;
- `prs-create`: issue and issue-set creation;
- `prs-issue`: one complete issue flow;
- `prs-finish`: verification, pull-request preparation, and validation;
- `prs-orchestrate`: dependency-aware execution of an issue set as separate pull requests.

The source bodies use only portable Markdown instructions and the public `prs` command contract. They do not assume a host-specific command syntax, filesystem location, delegation feature, model, or telemetry system. Host adapters install these files without changing their shared bodies.
