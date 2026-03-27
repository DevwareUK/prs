# git-ai

`git-ai` adds an AI engineering workflow layer on top of your Git repository.

Build the CLI from this monorepo once, link it globally, then use it inside any target repository to:

- configure repository-local `git-ai` defaults with a guided setup flow
- review changes like a senior engineer
- turn rough ideas into structured issues
- generate issue-resolution plans
- run issue-to-PR workflows with AI
- apply selected pull request review comments with Codex
- implement selected AI pull request test suggestions with Codex
- analyze backlog opportunities for testing and product work

The repository also includes GitHub Actions for pull request review, PR assistance, and test suggestions.

## Quick start

### Prerequisites

- `git`
- Node.js and `pnpm`
- `OPENAI_API_KEY`

### Install the CLI once

Build the CLI and link it globally from this repository:

```bash
cd /path/to/git-ai
pnpm install
pnpm --filter @git-ai/cli build
cd packages/cli
pnpm link --global
```

### Configure each target repository

Create a `.env` file in the target repository:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

Then run the guided repository setup:

```bash
cd /path/to/your-repo
git-ai setup
```

`git-ai setup` detects the repository root, suggests repo-aware defaults, writes `.git-ai/config.json`, ensures `.git-ai/` is gitignored, and can create or update a managed `AGENTS.md` guidance section.

### First successful run

Move into that target repository and try the two fastest workflows:

```bash
git-ai review
git-ai issue draft
```

### Useful next commands

```bash
git-ai diff
git-ai test-backlog --top 5
```

You only need extra tooling for advanced workflows:

- `codex` on `PATH` for full local `git-ai issue <number>` runs, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>`
- `gh`, `GH_TOKEN`, or `GITHUB_TOKEN` for GitHub-backed issue and pull request flows

`git-ai` resolves the active repository from your current Git working tree at runtime. It loads `.env` and `.git-ai/config.json` from that repository root, not from the CLI build location.

## Commands at a glance

- `git-ai commit`: generate a commit message from staged changes
- `git-ai diff`: summarize `git diff HEAD`
- `git-ai setup`: guided repository onboarding for `git-ai`
- `git-ai review`: review the current diff or a branch comparison
- `git-ai issue ...`: draft issues, generate issue plans, and run issue-to-PR flows
- `git-ai pr fix-comments <pr-number>`: fix selected PR review comments with Codex
- `git-ai pr fix-tests <pr-number>`: implement selected AI PR test suggestions with Codex
- `git-ai test-backlog`: find high-value automated testing gaps
- `git-ai feature-backlog`: find high-value feature opportunities

## Typical workflows

### Daily local usage

```bash
git-ai commit
git-ai diff
git-ai review --base origin/main
```

Use these when you want commit help, a high-level diff summary, or a PR-style review before opening a pull request.

### Issue drafting and planning

```bash
git-ai issue draft
git-ai issue plan 54
```

Use `draft` to turn a rough idea into a guided, repository-aware issue specification. The flow gathers repo context, asks targeted follow-up questions when needed, writes the draft under `.git-ai/issues/`, opens it in `$VISUAL`, `$EDITOR`, or `vim`, and only then offers optional issue creation. Use `plan` to generate or refresh the managed issue-resolution plan comment for an existing GitHub issue.

### Full issue-to-PR flow

```bash
git-ai issue 54
```

This full local workflow fetches the configured issue, creates the working branch, writes `.git-ai/` run artifacts, opens Codex, and then follows the final action chosen inside Codex. Choosing commit runs the configured build command, commits the result, and opens a pull request when the configured forge supports it. Choosing exit leaves the branch and any generated changes uncommitted without opening a pull request.

At the end of a successful local Codex run, the generated prompt asks Codex to finish with an explicit done-state summary plus next-step options for refining, committing, or exiting. The outer `git-ai issue` flow now honors that final commit-or-exit choice instead of always auto-committing.

If you need separate setup and completion steps:

```bash
git-ai issue prepare 54
git-ai issue finalize 54
```

For GitHub Actions runs:

```bash
git-ai issue prepare 54 --mode github-action
```

### Fix pull request review comments

```bash
git-ai pr fix-comments 88
```

Use this when the PR branch is already checked out locally and you want `git-ai` to fetch the PR review comments, let you choose which actionable comments to address, open Codex with a focused prompt, run the configured build command, and optionally commit the result.

Nearby comments on the same file are grouped into optional review tasks, non-trivial reply comments are kept as thread context, and the generated `.git-ai/runs/.../pr-review-comments.md` snapshot includes linked issue context plus local file excerpts when available.

### Fix pull request test suggestions

```bash
git-ai pr fix-tests 88
```

Use this when the PR branch is already checked out locally and you want `git-ai` to fetch the managed AI Test Suggestions comment, let you choose which structured test suggestions to implement, open Codex with a focused test-oriented prompt, run the configured build command, and optionally commit the result.

The command parses the managed `<!-- git-ai-test-suggestions -->` PR comment conservatively, keeps the selected suggestion areas plus likely file locations in `.git-ai/runs/.../pr-test-suggestions.md`, and fails clearly if the managed comment is missing or malformed.

### Repository backlog analysis

```bash
git-ai test-backlog --top 5
git-ai feature-backlog . --top 5
```

Add `--create-issues` to create or reuse GitHub issues for the highest-priority findings when the repository uses the GitHub forge integration.

## Configuration

### `.env`

Create `.env` in the target repository root:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

`OPENAI_MODEL` and `OPENAI_BASE_URL` are optional. The CLI defaults to `gpt-4o-mini` and `https://api.openai.com/v1`.

### `.git-ai/config.json`

Optional repository-specific defaults live in `.git-ai/config.json`. `git-ai setup` can generate or update this file for you:

```json
{
  "aiContext": {
    "excludePaths": [
      "vendor/**",
      "dist/**",
      "build/**",
      "*.map",
      "web/themes/**/css/**",
      "web/themes/**/js/**"
    ]
  },
  "baseBranch": "main",
  "buildCommand": ["pnpm", "build"],
  "forge": {
    "type": "github"
  }
}
```

Supported fields:

- `aiContext.excludePaths`: repository-relative glob patterns excluded from AI diff and repository context. These exclusions apply across `git-ai commit`, `git-ai diff`, `git-ai review`, issue-to-PR flows, and repository backlog scans. Bare filename globs like `*.map` match by basename anywhere in the repository. Defaults: `["**/node_modules/**", "**/vendor/**", "**/dist/**", "**/build/**", "*.map"]`.
- `baseBranch`: default pull request base branch for `git-ai issue <number>`. Default: `main`.
- `buildCommand`: command run after Codex exits during full local `git-ai issue <number>`, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>` flows. Default: `["pnpm", "build"]`.
- `forge.type`: forge integration. Use `"github"` for GitHub-backed issue and PR flows or `"none"` to disable forge-backed issue and PR features for the repository.

### `.git-ai/`

`.git-ai/` is repository-local working state used by issue and backlog workflows. It is intentionally gitignored and should not be committed. `git-ai setup` will add `.git-ai/` to `.gitignore` when needed.

Think of `.git-ai/` as the working memory for issue, planning, and backlog flows.

Typical contents:

- `.git-ai/issues/`: issue snapshots and generated drafts
- `.git-ai/runs/`: run prompts, metadata, and logs for automated issue work and PR comment-fix runs

## CLI command reference

All diff-driven and repository-analysis commands respect `.git-ai/config.json` `aiContext.excludePaths`.

### `git-ai commit`

```bash
git-ai commit
```

Generates a commit message from the staged diff.

Requirements:

- staged changes must exist
- `OPENAI_API_KEY` must be set

### `git-ai diff`

```bash
git-ai diff
```

Summarizes the current `git diff HEAD`.

Requirements:

- the repository must already have at least one commit
- there must be changes in `git diff HEAD`
- `OPENAI_API_KEY` must be set

### `git-ai setup`

```bash
git-ai setup
```

Runs a guided repository setup flow for the current Git repository. The command inspects the repo, suggests defaults for `baseBranch`, `forge.type`, `buildCommand`, and extra `aiContext.excludePaths`, writes `.git-ai/config.json`, ensures `.git-ai/` is gitignored, and can create or update a managed `AGENTS.md` section with repo-specific guidance.

The setup flow still expects you to create `.env` yourself because it cannot safely write secrets like `OPENAI_API_KEY`.

### `git-ai issue`

Usage:

```bash
git-ai issue <number>
git-ai issue draft
git-ai issue plan <number>
git-ai issue prepare <number> [--mode <local|github-action>]
git-ai issue finalize <number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `git-ai issue <number>` | Full local issue-to-PR flow for the current Git repository. Fetches the configured forge issue, creates a branch, writes `.git-ai/` workspace files, opens an interactive Codex session, and then follows the final action chosen inside Codex. Commit runs the configured build command, creates the commit, and opens a PR if the configured forge supports it. Exit leaves the branch uncommitted and skips PR creation. |
| `git-ai issue draft` | Guided issue-specification flow. Prompts for a rough idea, gathers repository context, asks targeted follow-up questions until the issue is specific enough, writes a Markdown issue draft, opens it in `$VISUAL`, `$EDITOR`, or `vim`, and can create the issue through the configured forge when GitHub support is enabled. |
| `git-ai issue plan <number>` | Generates an issue resolution plan for the configured forge issue and posts it as a managed comment. If an editable plan comment already exists, the command reuses it instead of overwriting collaborator edits. |
| `git-ai issue prepare <number>` | Prepares the issue branch and `.git-ai/` workspace artifacts, then prints machine-readable JSON describing the run. |
| `git-ai issue prepare <number> --mode github-action` | Same preparation flow, but writes prompt instructions tailored for non-interactive GitHub Actions runs. |
| `git-ai issue finalize <number>` | Commits generated changes with `feat: address issue #<number>`. |

Important behavior:

- `git-ai issue` requires a clean working tree before it starts
- `git-ai issue draft` always opens the generated draft in `$VISUAL`, `$EDITOR`, or `vim` before optional forge creation
- `git-ai issue plan <number>` requires `OPENAI_API_KEY` the first time it generates a plan comment
- local full issue runs require the `codex` CLI on `PATH`
- full local issue runs execute the configured `buildCommand`, defaulting to `pnpm build`
- local interactive Codex prompts end with an explicit done-state summary instead of silently stopping
- for local full issue runs, choosing `Exit` inside Codex skips the automatic build, commit, and PR steps
- PR creation uses the configured `baseBranch`, defaulting to `main`
- GitHub-backed PR creation requires `gh` to be installed and authenticated
- GitHub-backed issue plan comments require `GH_TOKEN` or `GITHUB_TOKEN`, or an authenticated `gh` session, when they are created
- if an issue resolution plan comment exists, `git-ai issue prepare <number>` and full `git-ai issue <number>` runs copy the latest edited plan into the generated issue snapshot
- when `forge.type` is `github`, issue fetching uses `gh issue view` when available, otherwise the GitHub API
- when `forge.type` is `github`, GitHub API access for issue fetching, plan comments, or issue creation uses `GH_TOKEN` or `GITHUB_TOKEN` when present
- when `forge.type` is `github`, `git-ai issue draft` can create issues with either `gh` or a GitHub token
- when `forge.type` is `none`, issue and PR creation features are disabled for the repository

### `git-ai pr`

Usage:

```bash
git-ai pr fix-comments <pr-number>
git-ai pr fix-tests <pr-number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `git-ai pr fix-comments <pr-number>` | Fetches pull request metadata and review comments from the configured forge, filters out obviously non-actionable comments, groups nearby threads into selectable review tasks, preserves non-trivial replies as thread context, writes richer `.git-ai/` run artifacts, opens an interactive Codex session, runs the configured build command, and optionally commits the resulting fixes. |
| `git-ai pr fix-tests <pr-number>` | Fetches pull request metadata and PR issue comments from the configured forge, finds the managed AI Test Suggestions comment, parses structured suggestion areas into selectable tasks, writes focused `.git-ai/` run artifacts, opens an interactive Codex session, runs the configured build command, and optionally commits the resulting test changes. |

Important behavior:

- `git-ai pr fix-comments <pr-number>` requires a clean working tree before it starts
- `git-ai pr fix-tests <pr-number>` requires a clean working tree before it starts
- local PR comment-fix runs require the `codex` CLI on `PATH`
- local PR test-fix runs require the `codex` CLI on `PATH`
- PR comment-fix and test-fix runs execute the configured `buildCommand`, defaulting to `pnpm build`
- local interactive Codex prompts end with an explicit done-state summary and commit/exit options
- the command expects the relevant PR branch to already be checked out locally before Codex starts editing
- the interactive selector accepts numbered thread choices and, when available, grouped task choices like `g1`; `all` still selects every individual thread
- `git-ai pr fix-tests <pr-number>` accepts `all`, `none`, or a comma-separated suggestion list like `1,2`
- when `forge.type` is `github`, PR fetching uses `gh pr view` when available, otherwise the GitHub API
- when `forge.type` is `github`, GitHub API access for PR metadata, review comments, and PR issue comments uses `GH_TOKEN` or `GITHUB_TOKEN` when present
- when `forge.type` is `none`, pull request workflows are disabled for the repository

### `git-ai review`

Usage:

```bash
git-ai review [--base <git-ref>] [--head <git-ref>] [--format <markdown|json>]
              [--issue-number <number>]
```

Flags:

| Flag | What it does |
| --- | --- |
| `--base <git-ref>` | Reviews the diff from `<git-ref>...HEAD` by default, or `<git-ref>...<head>` when `--head` is also provided. Without `--base`, `git-ai review` uses `git diff HEAD`. |
| `--head <git-ref>` | Optional comparison head revision. Requires `--base`. |
| `--format markdown` | Prints a readable Markdown review report. This is the default. |
| `--format json` | Prints the structured review payload, including higher-level findings and line-linked comments. |
| `--issue-number <number>` | Fetches the linked issue from the configured forge and includes it as review context. |

Examples:

```bash
git-ai review
git-ai review --base origin/main
git-ai review --base origin/main --head HEAD --format json
GITHUB_TOKEN=... git-ai review --issue-number 50
```

Important behavior:

- `git-ai review` requires `OPENAI_API_KEY`
- without `--base`, it reviews the current `git diff HEAD`
- with `--issue-number`, the CLI fetches the issue title and body from the configured forge and grounds the review in that context
- JSON output includes higher-level findings plus line-linked comment suggestions with file paths and right-side line numbers taken from the diff

### `git-ai test-backlog`

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
| `--repo-root <path>` | Analyzes a different repository root relative to the current working directory. The default is the current Git repository root. |
| `--create-issues` | Creates or reuses issues for the highest-priority findings through the configured forge. |
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

Important behavior:

- when `--create-issues` is enabled, `git-ai` checks for matching open issue titles first so it can reuse existing backlog items instead of creating duplicates
- if `forge.type` is `none`, backlog issue creation is disabled for that repository

### `git-ai feature-backlog`

Usage:

```bash
git-ai feature-backlog [repo-path] [--format <markdown|json>] [--top <count>]
                        [--create-issues] [--max-issues <count>]
                        [--label <name>] [--labels <a,b>]
```

Flags:

| Flag | What it does |
| --- | --- |
| `repo-path` | Optional repository path to analyze. Defaults to the current Git repository root. |
| `--format markdown` | Prints a Markdown feature backlog report. This is the default. |
| `--format json` | Prints a JSON payload suitable for scripting when issue creation is not being prompted interactively. |
| `--top <count>` | Limits how many feature suggestions are returned. Default: `5`. |
| `--create-issues` | Prompts you to choose one or more suggestions, then asks for issue title, extra description, and labels before creating or reusing issues through the configured forge. |
| `--max-issues <count>` | Limits how many selected suggestions are converted into issues. Default: `3`, capped to `--top`. |
| `--label <name>` | Adds a single default GitHub label to created issues. Repeatable. |
| `--labels <a,b>` | Adds a comma-separated list of default GitHub labels to created issues. |

Examples:

```bash
git-ai feature-backlog
git-ai feature-backlog ../other-repo --top 3
GITHUB_TOKEN=... git-ai feature-backlog . --create-issues --label product
git-ai feature-backlog . --format json
```

Important behavior:

- the repository analysis is heuristic and based on the repository structure, current product surface, and automation signals
- with the default GitHub forge integration, `--create-issues` requires `GH_TOKEN` or `GITHUB_TOKEN`
- with the default GitHub forge integration, issue creation targets the analyzed repository's `origin` remote, not just the current working directory
- before each issue is created, `git-ai` prompts for the final title, optional extra description, and labels
- if an open GitHub issue already exists with the chosen title, `git-ai` reuses it instead of creating a duplicate
- if `forge.type` is `none`, feature backlog issue creation is disabled for that repository

## Developing `git-ai`

This section is for contributors working on this monorepo rather than users running the CLI in another repository.

### Monorepo layout

| Path | Responsibility |
| --- | --- |
| `packages/cli` | The `git-ai` CLI entrypoint, argument parsing, repository config loading, forge integration, and local issue workflow orchestration. |
| `packages/core` | Shared workflow logic for commit messages, diff summaries, PR review, issue drafting, issue planning, and backlog analysis. |
| `packages/contracts` | Shared Zod contracts and schema types for workflow inputs and outputs. |
| `packages/providers` | AI provider integrations, currently including the OpenAI-backed provider used by the CLI and actions. |
| `actions/pr-review` | GitHub Action bundle for AI pull request review. |
| `actions/pr-assistant` | GitHub Action bundle for managed pull request assistant sections. |
| `actions/test-suggestions` | GitHub Action bundle for AI test suggestions on pull requests. |

### Root workspace commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs all workspace dependencies. |
| `pnpm build` | Runs `pnpm -r build` and builds every workspace package and action bundle. |
| `pnpm test` | Runs `vitest run --coverage` across the repository. |
| `pnpm lint` | Runs `eslint .`. |
| `pnpm dev` | Runs `pnpm -r dev` for workspace packages that define a `dev` script. |
| `pnpm prepare` | Runs `husky` to install or update Git hooks. This also runs automatically during install. |
| `pnpm cli:commit` | Builds the CLI package and runs `git-ai commit`. |
| `pnpm cli:diff` | Builds the CLI package and runs `git-ai diff`. |
| `pnpm cli:feature-backlog -- <args>` | Builds the CLI package and runs `git-ai feature-backlog <args>`. |
| `pnpm cli:issue -- <args>` | Builds the CLI package and runs `git-ai issue <args>`. |
| `pnpm cli:review -- <args>` | Builds the CLI package and runs `git-ai review <args>`. |
| `pnpm cli:test-backlog -- <args>` | Builds the CLI package and runs `git-ai test-backlog <args>`. |

### Package-level commands

Use these when working on an individual workspace directly.

| Package | Command | What it does |
| --- | --- | --- |
| `packages/cli` | `pnpm --filter @git-ai/cli build` | Builds the `git-ai` CLI into `packages/cli/dist`. |
| `packages/cli` | `pnpm --filter @git-ai/cli commit` | Builds the CLI package and runs `node dist/index.js commit`. |
| `packages/cli` | `pnpm --filter @git-ai/cli diff` | Builds the CLI package and runs `node dist/index.js diff`. |
| `packages/cli` | `pnpm --filter @git-ai/cli feature-backlog -- <args>` | Builds the CLI package and runs `node dist/index.js feature-backlog <args>`. |
| `packages/cli` | `pnpm --filter @git-ai/cli issue -- <args>` | Builds the CLI package and runs `node dist/index.js <args>`. Use this when testing CLI issue flows directly. |
| `packages/cli` | `pnpm --filter @git-ai/cli review -- <args>` | Builds the CLI package and runs `node dist/index.js review <args>`. |
| `packages/core` | `pnpm --filter @git-ai/core build` | Builds the shared core library. |
| `packages/contracts` | `pnpm --filter @git-ai/contracts build` | Builds the shared contract and schema package. |
| `packages/providers` | `pnpm --filter @git-ai/providers build` | Builds the provider integrations package. |
| `actions/pr-assistant` | `pnpm --filter @git-ai/pr-assistant-action build` | Builds the PR assistant GitHub Action bundle. |
| `actions/pr-review` | `pnpm --filter @git-ai/pr-review-action build` | Builds the PR review GitHub Action bundle. |
| `actions/test-suggestions` | `pnpm --filter @git-ai/test-suggestions-action build` | Builds the test suggestions GitHub Action bundle. |

### GitHub Action local entrypoints

These actions are bundled for GitHub Actions, but you can also run them locally after building the workspace.

#### PR review action

Build:

```bash
pnpm build
```

Run locally:

```bash
INPUT_DIFF="$(git diff --unified=3 -- . ':!pnpm-lock.yaml')" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Closes #50" \
INPUT_ISSUE_NUMBER="50" \
INPUT_ISSUE_TITLE="Implement AI-Powered Pull Request Review Functionality" \
INPUT_ISSUE_BODY="Create a function that utilizes AI to review pull requests line by line." \
INPUT_ISSUE_URL="https://github.com/DevwareUK/git-ai/issues/50" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-review/dist/index.js
```

Inputs:

- `INPUT_DIFF` required
- `INPUT_PR_TITLE` optional
- `INPUT_PR_BODY` optional
- `INPUT_ISSUE_NUMBER` optional
- `INPUT_ISSUE_TITLE` optional
- `INPUT_ISSUE_BODY` optional
- `INPUT_ISSUE_URL` optional
- `INPUT_OPENAI_API_KEY` required
- `INPUT_OPENAI_MODEL` optional, defaults to `gpt-4o-mini`
- `INPUT_OPENAI_BASE_URL` optional

Outputs:

- `summary`
- `body`
- `findings_json`
- `comments_json`

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout.

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

### Testing and CI expectations

Run the shared monorepo checks with:

```bash
pnpm build
pnpm test
pnpm lint
```

Vitest is the default repository test runner. Tests live alongside the packages they cover using `*.test.ts` files under `packages/` and `actions/`.

This repository includes these GitHub workflows:

- `.github/workflows/test.yml`: builds the workspace and runs `pnpm test` on pushes to `main` and on pull requests
- `.github/workflows/pr-review.yml`: generates an AI PR review summary, updates a managed PR comment, and posts filtered inline review comments against added lines
- `.github/workflows/pr-assistant.yml`: updates the pull request body with a managed PR assistant section
- `.github/workflows/test-suggestions.yml`: creates or updates a managed PR comment with suggested automated test coverage
- `.github/workflows/issue-to-pr.yml`: manual issue-to-PR automation that prepares issue context, runs Codex in GitHub Actions, builds the repository, commits generated changes, and opens or reuses a PR
- `.github/workflows/test-backlog.yml`: manual repository-wide test backlog scan with optional issue creation

All three pull-request-triggered AI workflows generate their diff input through the built CLI helper, so `.git-ai/config.json` `aiContext.excludePaths` is honored in pull request automation as well.
