# prs

`prs` is a small, deterministic toolkit that lets an active coding agent coordinate work through GitHub issues and pull requests.

The agent does the reasoning and implementation. `prs` provides the repeatable local operations around it: loading issue context, publishing approved artifacts, preparing a branch, validating a pull request, and publishing an audit trail.

The repository does not execute a model, require an AI-provider API key, or distribute GitHub Actions. Codex, Claude Code, and GitHub Copilot can all call the same local JSON tools. GitHub is the supported forge.

## Install

Prerequisites:

- Node.js 20 or later
- pnpm 10.7
- Git
- either `GH_TOKEN`/`GITHUB_TOKEN` or an authenticated GitHub CLI session

From this repository:

```bash
pnpm install
pnpm build
cd packages/cli
pnpm link --global
```

In a target repository:

```bash
prs setup --skills all
```

Setup writes `.prs/config.json` and `.prs/.gitignore`, then installs the canonical skills for the selected host or all hosts. Run `prs setup` without `--skills` for an interactive choice; an empty answer skips personal skill installation. If an older configuration contains `ai` or `githubActions`, setup preserves supported settings, removes those retired sections, and prints a migration notice.

## Agent skills

The canonical, host-neutral skill pack lives under `skills/` and is indexed by `skills/manifest.json`:

- `prs` routes requests to the appropriate workflow;
- `prs-create` drafts and creates approved issues or issue sets;
- `prs-issue` carries one issue from context through implementation and validation;
- `prs-finish` verifies completed work and prepares its pull request and audit trail;
- `prs-orchestrate` coordinates a dependency-aware issue set as separate pull requests.

These are the shared workflow bodies for Codex, Claude Code, and GitHub Copilot. Host installers place them in supported personal directories without rewriting their instructions.

For Codex, `prs skills install codex` installs the pack under `~/.agents/skills`. Re-running it safely updates unchanged PRS-managed copies, preserves customized or colliding files, and moves marked legacy copies under `~/.codex/skills` to recoverable `.prs-retired` files. See [the Codex guide](docs/codex.md).

For Claude Code, `prs skills install claude-code` installs the same files under `~/.claude/skills`. See [the Claude Code guide](docs/claude-code.md).

For GitHub Copilot, `prs skills install copilot` shares the Codex installation under `~/.agents/skills` without duplicating managed files. See [the Copilot guide](docs/github-copilot.md).

## Workflow

A normal issue flow is:

1. The active agent drafts one issue or a linked issue set as local files.
2. After approval, it creates the issue(s) with `prs tool issue create`.
3. It reads live context with `prs tool issue context` and publishes an approved specification and plan with `prs tool issue publish-artifacts`.
4. It prepares implementation context with `prs tool issue ready`, then works in an isolated branch or worktree.
5. It verifies the changes and uses `prs issue finalize` to create a deterministic local commit after explicit confirmation.
6. It opens or updates the pull request through its normal GitHub tooling and publishes evidence with `prs audit publish`.

For an existing pull request, `prs tool pr ready` checks out the actual head branch, synchronizes the configured base, runs configured local-readiness commands, and returns GitHub checks and review-comment context as JSON.

## Commands

The implemented command surface is:

```text
prs setup [--skills <none|codex|claude-code|copilot|all>]
prs skills install <codex|claude-code|copilot> [--json]

prs tool issue list [--actionable] --json
prs tool issue context <issue-number> --json
prs tool issue ready <issue-number> [--unattended|--auto|--jdi] --json
prs tool issue publish-artifacts <issue-number> --spec-file <path> --plan-file <path> --json
prs tool issue create (--draft-file <path>|--issue-set <path>) --json
                      [--run-dir <path>] [--spec-file <path>] [--plan-file <path>]
                      [--media-manifest <path>] [--label <name>] [--labels <a,b>]
                      [--force-prs-managed]
prs issue finalize <issue-number>

prs tool pr list [--actionable] --json
prs tool pr ready <pr-number> [--unattended|--auto|--jdi] --json

prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name>
                  [--local-run <path>] [--media-manifest <path>]
```

Remote mutations—creating issues and publishing managed comments or audits—must be approved by the user before the active agent invokes them. Read-only context commands need no approval. `prs tool pr ready` changes the local checkout and may merge the latest base branch, but it does not push or merge a pull request.

## Configuration

`.prs/config.json` accepts only local workflow settings:

```json
{
  "baseBranch": "main",
  "buildCommand": ["pnpm", "build"],
  "forge": { "type": "github" },
  "aiContext": {
    "excludePaths": ["fixtures/**"]
  },
  "localRuntime": {
    "type": "command",
    "statusCommand": ["make", "status"],
    "startCommand": ["make", "up"],
    "url": "https://project.local"
  },
  "prReadiness": {
    "commands": [
      { "name": "build", "command": ["pnpm", "build"] },
      { "name": "tests", "command": ["pnpm", "test"] }
    ]
  }
}
```

See [the CLI reference](docs/cli-reference.md), [setup configuration](docs/setup-configuration.md), [migration guide](docs/migration.md), and [development guide](docs/development.md).

## Development

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test
```

The sole repository workflow, `.github/workflows/test.yml`, runs those checks for pull requests. It is repository CI, not a distributed `prs` action.
