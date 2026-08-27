# Active-agent workflows

The portable flow is deliberately split:

- the active coding agent owns questions, specifications, plans, implementation, review, and user approval;
- `prs` owns deterministic local GitHub, Git, artifact, and validation operations.

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
