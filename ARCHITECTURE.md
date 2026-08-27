# prs architecture

`prs` separates agent reasoning from deterministic repository operations.

The active coding agent owns clarification, planning, implementation, review, and approval. The repository contains only local tools that read or change Git, GitHub, configuration, and workflow artifacts.

## Packages

- `packages/contracts` defines strict Zod schemas for repository configuration, linked issue sets, and the portable agent lifecycle.
- `packages/core` resolves configuration and filters repository paths.
- `packages/cli` exposes the deterministic issue, pull request, finalization, and audit commands.
- `skills/manifest.json` indexes the five canonical, host-neutral workflow bodies. CLI adapters install those files unchanged into each host's supported personal directory.

There is no model-provider package and no distributable GitHub Action package. `.github/workflows/test.yml` is repository CI only.

## Boundaries

- JSON tools provide stable machine-readable handoffs for any supported agent host.
- Read-only context operations do not require approval.
- Remote GitHub mutations require explicit user approval.
- Local branch/worktree policy belongs to the active agent host; the contract defines safe fallbacks when isolation or delegation is unavailable.
- Approved specifications and plans use marker-managed GitHub comments; raw prompts and logs stay under `.prs/runs`.
- Configuration contains workflow mechanics only. Model choice, credentials, and reasoning settings remain owned by the active agent host.
- Host parity means the same lifecycle outcomes and safeguards through native host discovery and invocation; command spelling and optional acceleration features may differ.
