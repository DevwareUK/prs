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
- Marked legacy Codex files under `~/.codex/skills` are renamed to `SKILL.md.prs-retired`, not deleted. Unmarked custom files remain untouched.

## Workflow migration

Use the five canonical skills—`prs`, `prs-create`, `prs-issue`, `prs-finish`, and `prs-orchestrate`—through each host's native discovery and invocation behavior. Parity means the same lifecycle phases, approval gates, separate pull requests, verification, and audit evidence. It does not require identical prompt syntax or optional worktree and delegation features.

The supported CLI surface is listed in the README and CLI reference. Retired provider execution, generated commit or review text, and distributed GitHub Action entrypoints are not compatibility aliases; use the active agent with the retained deterministic commands instead.
