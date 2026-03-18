# git-ai

AI tooling for Git workflows, including a CLI and GitHub Actions.

Pull request workflows in this repo currently cover an AI PR assistant section, test suggestions, and repo-wide test backlog generation.

## Local Setup

Install dependencies:

```bash
pnpm install
```

Create a `.env` file in the repo root:

```bash
cp .env.example .env
```

Then set your OpenAI API key:

```env
OPENAI_API_KEY=your_key_here
```

The CLI tools and Husky commit hook will read environment variables from this file.

## Command Reference

This repository exposes commands in four places:

- root `pnpm` scripts in the workspace `package.json`
- package-level `pnpm` scripts inside individual workspaces
- the `git-ai` CLI
- direct Node entrypoints for the bundled GitHub Actions

### Root workspace commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs all workspace dependencies. |
| `pnpm build` | Runs `pnpm -r build` and builds every workspace package and action bundle. |
| `pnpm test` | Runs `vitest run --coverage` across the repository. |
| `pnpm lint` | Runs `eslint .`. |
| `pnpm dev` | Runs `pnpm -r dev` for workspace packages that define a `dev` script. |
| `pnpm prepare` | Runs `husky` to install/update Git hooks. This also runs automatically during install. |
| `pnpm cli:commit` | Builds the CLI package and runs `git-ai commit`. |
| `pnpm cli:diff` | Builds the CLI package and runs `git-ai diff`. |
| `pnpm cli:issue -- <args>` | Builds the CLI package and runs `git-ai issue <args>`. |
| `pnpm cli:test-backlog -- <args>` | Builds the CLI package and runs `git-ai test-backlog <args>`. |

### Package-level commands

These are useful when working on an individual workspace directly.

| Package | Command | What it does |
| --- | --- | --- |
| `packages/cli` | `pnpm --filter @git-ai/cli build` | Builds the `git-ai` CLI into `packages/cli/dist`. |
| `packages/cli` | `pnpm --filter @git-ai/cli commit` | Builds the CLI package and runs `node dist/index.js commit`. |
| `packages/cli` | `pnpm --filter @git-ai/cli diff` | Builds the CLI package and runs `node dist/index.js diff`. |
| `packages/cli` | `pnpm --filter @git-ai/cli issue -- <args>` | Builds the CLI package and runs `node dist/index.js <args>`. Use this when testing CLI issue flows directly. |
| `packages/core` | `pnpm --filter @git-ai/core build` | Builds the shared core library. |
| `packages/contracts` | `pnpm --filter @git-ai/contracts build` | Builds the shared contract/schema package. |
| `packages/providers` | `pnpm --filter @git-ai/providers build` | Builds the provider integrations package. |
| `actions/pr-assistant` | `pnpm --filter @git-ai/pr-assistant-action build` | Builds the PR assistant GitHub Action bundle. |
| `actions/test-suggestions` | `pnpm --filter @git-ai/test-suggestions-action build` | Builds the test suggestions GitHub Action bundle. |

### `git-ai` CLI commands

After `pnpm install`, the CLI can be run either through the package scripts above or directly with `git-ai ...` if your shell resolves workspace binaries.

If you run `git-ai` with no arguments, it defaults to `git-ai commit`.

#### `git-ai commit`

```bash
git-ai commit
```

Generates a commit message from the staged diff.

Requirements:

- staged changes must exist
- `OPENAI_API_KEY` must be set

#### `git-ai diff`

```bash
git-ai diff
```

Summarizes the current `git diff HEAD`.

Requirements:

- the repository must already have at least one commit
- there must be changes in `git diff HEAD`
- `OPENAI_API_KEY` must be set

#### `git-ai issue`

Usage:

```bash
git-ai issue <number>
git-ai issue draft
git-ai issue plan <number>
git-ai issue prepare <number> [--mode <local|github-action>]
git-ai issue finalize <number>
```

Available modes and subcommands:

| Command | What it does |
| --- | --- |
| `git-ai issue <number>` | Full local issue-to-PR flow. Fetches the GitHub issue, creates a branch, writes `.git-ai/` workspace files, opens an interactive Codex session, runs `pnpm build`, commits the result, and opens a PR if `gh` is installed and authenticated. |
| `git-ai issue draft` | Interactive issue drafting flow. Prompts for a feature idea, generates a Markdown issue draft with AI, optionally opens it in `$VISUAL` or `$EDITOR`, and can create the GitHub issue through `gh`. |
| `git-ai issue plan <number>` | Generates an issue resolution plan for the GitHub issue and posts it as a managed comment. If an editable plan comment already exists, the command reuses it instead of overwriting collaborator edits. |
| `git-ai issue prepare <number>` | Prepares the issue branch and `.git-ai/` workspace artifacts, then prints machine-readable JSON describing the run. |
| `git-ai issue prepare <number> --mode github-action` | Same preparation flow, but writes prompt instructions tailored for non-interactive GitHub Actions runs. |
| `git-ai issue finalize <number>` | Commits generated changes with `feat: address issue #<number>`. |

Important behavior:

- `git-ai issue` requires a clean working tree before it starts
- `git-ai issue plan <number>` requires `OPENAI_API_KEY` the first time it generates a plan comment
- issue metadata and run artifacts are written under `.git-ai/`
- local full runs require the `codex` CLI on `PATH`
- PR creation requires `gh` to be installed and authenticated
- issue plan comments require `GH_TOKEN` or `GITHUB_TOKEN`, or an authenticated `gh` session, when they are created
- if an issue resolution plan comment exists, `git-ai issue prepare <number>` and full `git-ai issue <number>` runs copy the latest edited plan into the generated issue snapshot
- issue fetching uses `gh issue view` when available, otherwise the GitHub API
- GitHub API access for issue fetching, plan comments, or issue creation uses `GH_TOKEN` or `GITHUB_TOKEN` when present

#### `git-ai test-backlog`

Usage:

```bash
git-ai test-backlog [--format <markdown|json>] [--top <count>]
                     [--repo-root <path>] [--create-issues]
                     [--max-issues <count>] [--label <name>] [--labels <a,b>]
```

Flags:

| Flag | What it does |
| --- | --- |
| `--format markdown` | Prints a Markdown backlog report. This is the default. |
| `--format json` | Prints a JSON payload suitable for scripting. |
| `--top <count>` | Limits how many findings are returned. Default: `5`. |
| `--repo-root <path>` | Analyzes a different repository root relative to this workspace. |
| `--create-issues` | Creates or reuses GitHub issues for the highest-priority findings. |
| `--max-issues <count>` | Limits how many issues are created when `--create-issues` is enabled. Default: `3`, capped to `--top`. |
| `--label <name>` | Adds a single GitHub label to created issues. Repeatable. |
| `--labels <a,b>` | Adds a comma-separated list of GitHub labels to created issues. |

Examples:

```bash
git-ai test-backlog
git-ai test-backlog --format json --top 5
GITHUB_TOKEN=... git-ai test-backlog --create-issues --max-issues 3
git-ai test-backlog --label testing --label backlog
git-ai test-backlog --labels testing,backlog
```

When `--create-issues` is enabled, `git-ai` checks for matching open issue titles first so it can reuse existing backlog items instead of creating duplicates.

### GitHub Action local entrypoints

These actions are bundled for GitHub Actions, but you can also run them locally after building the workspace.

#### PR assistant action

Build:

```bash
pnpm build
```

Run locally:

```bash
INPUT_DIFF="$(git diff -- . ':!pnpm-lock.yaml')" \
INPUT_COMMIT_MESSAGES="$(git log --reverse --format='%s' HEAD~3..HEAD)" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Human-authored PR notes" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-assistant/dist/index.js
```

Inputs:

- `INPUT_DIFF` required
- `INPUT_COMMIT_MESSAGES` optional
- `INPUT_PR_TITLE` optional
- `INPUT_PR_BODY` optional
- `INPUT_OPENAI_API_KEY` required
- `INPUT_OPENAI_MODEL` optional, defaults to `gpt-4o-mini`
- `INPUT_OPENAI_BASE_URL` optional

Outputs:

- `summary`
- `section`
- `body`

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout.

#### Test suggestions action

Build:

```bash
pnpm build
```

Run locally:

```bash
INPUT_DIFF="$(git diff -- . ':!pnpm-lock.yaml')" \
INPUT_PR_TITLE="Example PR title" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/test-suggestions/dist/index.js
```

Inputs:

- `INPUT_DIFF` required
- `INPUT_PR_TITLE` optional
- `INPUT_PR_BODY` optional
- `INPUT_OPENAI_API_KEY` required
- `INPUT_OPENAI_MODEL` optional, defaults to `gpt-4o-mini`
- `INPUT_OPENAI_BASE_URL` optional

Outputs:

- `summary`
- `body`

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout.

## Testing

Run the shared monorepo smoke tests with:

```bash
pnpm test
```

Vitest is the default repository test runner. Baseline tests live alongside the
packages they cover using `*.test.ts` files under `packages/` and `actions/`.

`.git-ai/` is local working state for issue snapshots and run artifacts. It is
intentionally gitignored and should not be committed.

## GitHub Actions issue flow

This repository also includes a manual `Issue to PR` workflow under
`.github/workflows/issue-to-pr.yml`.

Trigger it with `workflow_dispatch`, provide an issue number, and the workflow
will:

- fetch the GitHub issue details
- create the issue branch and Codex prompt workspace
- run Codex remotely in GitHub Actions
- build the repository with `pnpm build`
- commit and push the generated changes
- create or reuse a PR targeting `main`
- comment on the issue with the PR link

Required secrets:

- `OPENAI_API_KEY`

## Repo-wide test backlog workflow

This repository also includes a manual `Test Backlog` workflow under
`.github/workflows/test-backlog.yml`.

Trigger it with `workflow_dispatch` to:

- scan the repository for existing test setup and likely gaps
- recommend a default test framework when the repo does not have one yet
- report whether automated tests are enforced in GitHub Actions
- publish a prioritized backlog summary in the workflow run
- optionally create GitHub issues for the highest-value findings

Issue creation is disabled by default and requires a deliberate manual trigger.

## Test workflow

Pull requests and pushes to `main` also run `.github/workflows/test.yml`, which
builds the workspace and executes the shared `pnpm test` command.
