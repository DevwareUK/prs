# Migration to local agent workflows

The current release keeps agent reasoning in Codex, Claude Code, or GitHub Copilot and keeps `prs` focused on deterministic local Git, GitHub, artifact, and validation operations.

## Update an existing repository

From the repository root, run:

```bash
prs setup --skills all
```

Setup preserves supported `.prs/config.json` values, removes legacy `ai` and `githubActions` sections with a visible notice, refreshes `.prs/.gitignore`, and installs the canonical personal skill pack. Use a single host name instead of `all` when only one adapter is needed. Use `--skills none` to migrate configuration without installing personal skills.

Host selection, model choice, credentials, and reasoning settings are not repository configuration. Existing project workflows are user-owned; setup does not delete them.

## Existing skill files

- Codex and Copilot share `~/.agents/skills`. Their installers share one hash ledger and one managed copy per skill.
- Claude Code uses `~/.claude/skills` with the same canonical bodies.
- A managed file is updated only while its content matches the last installed hash. Customized or colliding files are skipped.
- Marked legacy Codex files under `~/.codex/skills`, including colon-named aliases such as `prs:pr`, are renamed to `SKILL.md.prs-retired`, not deleted. Unmarked custom files remain untouched.

## Workflow migration

Use the six canonical skills—`prs`, `prs-create`, `prs-issue`, `prs-finish`, `prs-pr`, and `prs-orchestrate`—through each host's native discovery and invocation behavior. Parity means the same lifecycle phases, approval gates, separate pull requests, verification, and audit evidence. It does not require identical prompt syntax or optional worktree and delegation features.

Re-run the installer to add `prs-pr` to an existing five-skill installation. It restores the former dedicated PR entrypoint as a host-neutral skill: prepare the main checkout, then request `review`, `resolve-conflicts`, `address-comments`, or `fix-tests`. Review preparation/publication and guarded pushes use supported tools and the active agent's Git/GitHub capabilities; the old CLI subcommands are not reintroduced. Custom skill files remain protected by the installer.

The supported CLI surface is listed in the README and CLI reference. Retired provider execution, generated commit or review text, and distributed GitHub Action entrypoints are not compatibility aliases; use the active agent with the retained deterministic commands instead.

## GitHub CLI and personal account selection

GitHub-backed commands now require installed `gh`; supplying a token alone no longer enables a direct HTTP fallback. Sign in with `gh auth login --hostname github.com`. Automation can continue to supply `GH_TOKEN` or `GITHUB_TOKEN` through GitHub CLI when no project account is selected.

Run interactive `prs setup` to choose a saved account and write ignored `.prs/config.local.json`. Existing scripted `prs setup --skills all` invocations remain non-interactive and preserve any account choice. Keep personal account selection out of committed `.prs/config.json`; see [setup configuration](setup-configuration.md).
