# Setup and configuration

Run `prs setup` from the root of a Git repository. It creates:

- `.prs/config.json`, the committed repository workflow configuration
- `.prs/.gitignore`, which ignores generated `runs/`, `state/`, and `worktrees/`

## Configuration keys

- `baseBranch`: branch used as the default integration base; defaults to `main`.
- `buildCommand`: command segments used for verification preflight; defaults to `pnpm build`.
- `forge.type`: `github` or `none`; defaults to `github`.
- `forge.githubCliPath`: optional explicit GitHub CLI path.
- `aiContext.excludePaths`: paths omitted from agent-facing repository context. This is context filtering, not model configuration.
- `localRuntime`: optional local application readiness commands and URL.
- `prReadiness.commands`: ordered local validation/setup steps for `prs tool pr ready`.

The schema is strict. Unknown keys are rejected, except that legacy top-level `ai` and `githubActions` sections are safely removed by the migration loader with a notice. No provider credentials belong in this file.

## GitHub authentication

The CLI checks `GH_TOKEN`, then `GITHUB_TOKEN`, then an authenticated `gh` session. Set `PRS_GH_PATH` or `forge.githubCliPath` when `gh` is installed outside `PATH`.

Creating issues and publishing comments require authentication. Readiness and context tools return a clear blocked result when the forge is disabled or required GitHub access is unavailable.
