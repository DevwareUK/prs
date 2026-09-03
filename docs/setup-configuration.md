# Setup and configuration

Run setup from the root of a Git repository:

```bash
prs setup --skills all
```

Use `codex`, `claude-code`, `copilot`, or `none` instead of `all` when appropriate. Omit `--skills` in a terminal for interactive skill and GitHub account choices. Supplying `--skills` or running without interactive input preserves the account setting without prompting. Setup creates:

- `.prs/config.json`, the committed repository workflow configuration
- `.prs/.gitignore`, which ignores generated `runs/`, `state/`, and `worktrees/`, plus personal `config.local.json`

Personal skill installation is intentionally machine-local. It is not recorded in `.prs/config.json`.

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

All GitHub access uses an installed GitHub CLI (`gh`), including REST and GraphQL requests through `gh api`. Run `gh auth login --hostname github.com` to sign in. Set `PRS_GH_PATH`, its alias `PRS_GITHUB_CLI_PATH`, or shared `forge.githubCliPath` when `gh` is installed outside `PATH`.

### Personal project account

Interactive `prs setup` lists saved, signed-in GitHub accounts plus **Use the default account**. Choose an account number to create or update `.prs/config.local.json`:

```json
{
  "forge": { "githubAccount": "your-work-username" }
}
```

The local file accepts only the optional `forge.githubAccount` username. Shared workflow settings remain in `.prs/config.json`; credentials remain managed by GitHub CLI. Setup adds `config.local.json` to `.prs/.gitignore` while preserving existing ignore rules. In an existing repository, rerun setup to add the ignore rule before creating this file manually.

On a rerun, press Enter to keep the current account. Choose `0` to clear the account choice and use normal GitHub CLI authentication. With no explicit choice, no local file is needed. An unavailable previous choice is retained with login guidance. If GitHub CLI or saved accounts are unavailable, setup provides guidance and finishes without changing your choice. Disabled-forge setup skips account discovery.

`prs setup --skills all` (or another explicit skills selection) and non-interactive setup never prompt for an account or select one automatically. With no `--skills` and no interactive input, setup skips skill installation too. Existing local account settings are preserved.

Account configuration is read from the resolved repository root even when a command starts in a subdirectory. Each linked worktree has its own `.prs/config.local.json`; select the account there if it needs an explicit choice.

A configured account takes precedence over inherited `GH_TOKEN`/`GITHUB_TOKEN`, applies to every `prs` GitHub operation, and never switches the global `gh` account. Missing credentials fail with login guidance instead of using another identity. Different projects can run concurrently with different account selections.

When no account is configured, GitHub CLI handles its usual authentication, including environment tokens for automation. `prs` has no separate token fallback: installing `gh` is required even when supplying a token. This configuration does not change directly invoked `gh` commands, Git author identity, or Git transport credentials.

Creating issues and publishing comments require authentication. Readiness and context tools return a clear blocked result when the forge is disabled or required GitHub access is unavailable.
