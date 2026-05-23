# AGENTS.md

## Scope

These instructions apply to the entire repository.

## Documentation Maintenance

- Keep [README.md](/Users/james/www/DevwareUK/ai-actions/README.md) in sync with the actual command surface of the project.
- If a change adds, removes, renames, or changes the behavior of any user-facing command, update the README in the same task whenever possible.
- Treat these as command-surface changes that require a README update:
  - root `package.json` scripts
  - workspace package scripts under `packages/` or `actions/`
  - `prs` CLI commands, subcommands, flags, defaults, prerequisites, or outputs
  - GitHub Action local entrypoints, inputs, outputs, or required environment variables
  - workflow commands in documented setup or usage flows
- Do not leave README command examples stale. If an example command would no longer work after your change, update or remove it.
- When command behavior changes in a way that affects usage, document the new behavior briefly and concretely instead of only changing command names.

## Command Verification

- Before documenting commands, verify them from source files such as `package.json`, CLI entrypoints, action manifests, and workflow files instead of relying on assumptions.
- Prefer concise command documentation that reflects what is actually implemented in the repository today.
