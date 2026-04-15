# git-ai

`git-ai` adds an AI engineering workflow layer on top of your Git repository.

Build the CLI from this monorepo once, link it globally, then use it inside any target repository to:

- configure repository-local `git-ai` defaults with a guided setup flow
- review changes like a senior engineer
- turn rough ideas into structured issues
- generate issue-resolution plans
- run issue-to-PR workflows with AI
- apply selected pull request review comments with the configured interactive runtime
- implement selected AI pull request test suggestions with the configured interactive runtime
- analyze backlog opportunities for testing and product work

The repository also includes GitHub Actions for pull request review, PR assistance, and test suggestions.

## Quick start

### Prerequisites

- `git`
- Node.js and `pnpm`
- one configured AI provider:
  `OPENAI_API_KEY` for the default OpenAI provider, or AWS credentials plus region for `bedrock-claude`

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
AWS_REGION=eu-west-1
```

`OPENAI_*` is used by the default `openai` provider. `AWS_REGION` or `AWS_DEFAULT_REGION` plus standard AWS credentials is used when `.git-ai/config.json` selects the `bedrock-claude` provider.

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

- the configured interactive runtime on `PATH` for `git-ai issue draft`, local interactive `git-ai issue <number>` runs, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>`
  default: `codex`
  `ai.runtime.type: "claude-code"`: `claude`
- `codex` plus authenticated GitHub access for `git-ai issue <number> --mode unattended` and `git-ai issue batch ...`
- `gh`, `GH_TOKEN`, or `GITHUB_TOKEN` for GitHub-backed issue and pull request flows

`git-ai` resolves the active repository from your current Git working tree at runtime. It loads `.env` and `.git-ai/config.json` from that repository root, not from the CLI build location.

## Commands at a glance

- `git-ai commit`: generate a commit message from staged changes
- `git-ai diff`: summarize `git diff HEAD`
- `git-ai setup`: guided repository onboarding for `git-ai`
- `git-ai review`: review the current diff or a branch comparison
- `git-ai issue ...`: draft issues, generate issue plans, run single-issue flows, and queue unattended issue batches
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

Use `draft` to hand a rough idea to the configured interactive runtime. The CLI writes `.git-ai/` run artifacts, launches the runtime so it can inspect the repository, ask only the follow-up questions it still needs, and write the draft under `.git-ai/issues/`, then prints the draft in the terminal and lets you create it as-is, open it in `$VISUAL`, `$EDITOR`, or `vim` to modify it first, or keep the draft file on disk without creating the issue. Use `plan` to generate or refresh the managed issue-resolution plan comment for an existing GitHub issue through the configured text-generation provider.

### Full issue-to-PR flow

```bash
git-ai issue 54
```

By default, `git-ai issue 54` runs in interactive mode. On the first local run for an issue, it fetches the configured issue, switches to the configured `baseBranch`, pulls the latest changes, creates the working branch, writes `.git-ai/` run artifacts, and opens the configured interactive runtime session. After the runtime returns control, `git-ai` runs the configured build command, generates a proposed commit message from the completed diff, lets you commit it as-is or edit it first, and then generates a reviewer-ready PR title/body from the diff before opening a pull request when the configured forge supports it. The generated PR body includes both an issue-closing reference such as `Closes #54` and the managed PR assistant section markers used by the PR assistant automation.

Later `git-ai issue 54` runs switch back to the saved issue branch and continue from the saved `.git-ai/` issue state. With the default `codex` runtime, `git-ai` also resumes the saved Codex session when it is still available. With `claude-code`, later runs reopen the saved branch and start a fresh Claude Code session against the current issue prompt. If the saved branch or tracked runtime session is no longer valid, the command fails with a recovery message that tells you which `.git-ai/issues/<number>/session.json` file to remove before starting a fresh issue run.

At the end of a successful local runtime session, the generated prompt asks the agent to finish with an explicit done-state summary, a short note about how to see the result in action or what was verified, and plain-language next steps. If you want more changes, keep talking to the runtime. When you are satisfied and want `git-ai` to resume, type `/exit`.

For unattended single-issue execution:

```bash
git-ai issue 54 --mode unattended
```

This path currently requires `ai.runtime.type: "codex"` plus authenticated GitHub access. It reuses the same per-issue branch and `.git-ai/issues/<number>/session.json` state as the interactive flow, but runs Codex through a non-interactive `exec` invocation, commits with the generated commit message automatically, and opens the pull request without prompting.

For unattended multi-issue queues:

```bash
git-ai issue batch 54 55 60
```

`git-ai issue batch` defaults to `--mode unattended`, runs the listed issues sequentially, and creates separate issue runs for each issue rather than one shared Codex session. Batch progress is recorded separately under `.git-ai/batches/`, and rerunning the same ordered batch skips issues already marked completed in the batch tracker and resumes from the first incomplete issue.

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

Use this when the PR branch is already checked out locally and you want `git-ai` to fetch the PR review comments, let you choose which actionable comments to address, open the configured interactive runtime with a focused prompt, run the configured build command, and then review, edit, or skip the proposed commit message before committing the result.

Nearby comments on the same file are grouped into optional review tasks, non-trivial reply comments are kept as thread context, and the generated `.git-ai/runs/.../pr-review-comments.md` snapshot includes linked issue context plus local file excerpts when available.

### Fix pull request test suggestions

```bash
git-ai pr fix-tests 88
```

Use this when the PR branch is already checked out locally and you want `git-ai` to fetch the managed AI Test Suggestions comment, let you choose which structured test suggestions to implement, open the configured interactive runtime with a focused test-oriented prompt, run the configured build command, and then review, edit, or skip the proposed commit message before committing the result.

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
AWS_REGION=eu-west-1
```

`OPENAI_MODEL` and `OPENAI_BASE_URL` are optional. The CLI defaults to `gpt-4o-mini` and `https://api.openai.com/v1` when `ai.provider.type` is `openai`. `AWS_REGION` or `AWS_DEFAULT_REGION` is used when `ai.provider.type` is `bedrock-claude`, and AWS credentials are resolved through the standard AWS provider chain.

### `.git-ai/config.json`

Optional repository-specific defaults live in `.git-ai/config.json`. `git-ai setup` can generate or update this file for you:

```json
{
  "ai": {
    "runtime": {
      "type": "codex"
    },
    "provider": {
      "type": "openai"
    }
  },
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

- `ai.runtime.type`: interactive runtime used by `git-ai issue draft`, local `git-ai issue <number>`, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>`. Supported values: `"codex"` and `"claude-code"`. Default: `"codex"`.
- `ai.provider.type`: structured text provider used by `git-ai commit`, `git-ai diff`, `git-ai review`, `git-ai issue plan <number>`, and commit/PR generation inside `git-ai issue <number>` and `git-ai issue finalize <number>`. Supported values: `"openai"` and `"bedrock-claude"`. Default: `"openai"`.
- `ai.provider.model`: optional for `"openai"`, required for `"bedrock-claude"`.
- `ai.provider.baseUrl`: optional override for `"openai"`.
- `ai.provider.region`: optional explicit AWS region for `"bedrock-claude"`. Falls back to `AWS_REGION` or `AWS_DEFAULT_REGION`.
- `aiContext.excludePaths`: repository-relative glob patterns excluded from AI diff and repository context. These exclusions apply across `git-ai commit`, `git-ai diff`, `git-ai review`, issue-to-PR flows, and repository backlog scans. Bare filename globs like `*.map` match by basename anywhere in the repository. Defaults: `["**/node_modules/**", "**/vendor/**", "**/dist/**", "**/build/**", "*.map"]`.
- `baseBranch`: base branch used by `git-ai issue <number>` and `git-ai issue prepare <number>` when switching, pulling, and opening pull requests. Default: `main`.
- `buildCommand`: command run after the interactive runtime exits during full local `git-ai issue <number>`, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>` flows. Default: `["pnpm", "build"]`.
- `forge.type`: forge integration. Use `"github"` for GitHub-backed issue and PR flows or `"none"` to disable forge-backed issue and PR features for the repository.

Runtime and provider fallback behavior:

- if no `ai.runtime` config is present, `git-ai` uses `codex`
- if no `ai.provider` config is present, `git-ai` uses `openai`
- if a configured runtime is unavailable, `git-ai` falls back to `codex` when possible and prints a clear fallback message
- if a configured provider is unavailable, `git-ai` falls back to `openai` when possible and prints a clear fallback message
- if neither the configured choice nor the default choice is usable, the command fails with an actionable error

### `.git-ai/`

`.git-ai/` is repository-local working state used by issue and backlog workflows. It is intentionally gitignored and should not be committed. `git-ai setup` will add `.git-ai/` to `.gitignore` when needed.

Think of `.git-ai/` as the working memory for issue, planning, and backlog flows.

Typical contents:

- `.git-ai/batches/`: persistent batch queue state for `git-ai issue batch ...`
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
git-ai issue <number> [--mode <interactive|unattended>]
git-ai issue batch <number> <number> [...number] [--mode unattended]
git-ai issue draft
git-ai issue plan <number>
git-ai issue prepare <number> [--mode <local|github-action>]
git-ai issue finalize <number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `git-ai issue <number>` | Full local issue-to-PR flow in interactive mode. Fetches the configured forge issue, switches to the configured `baseBranch`, pulls the latest changes, creates the issue branch, writes `.git-ai/` workspace files, opens the configured interactive runtime, runs the configured build command after that runtime exits, generates a proposed commit message from the completed diff for review, and then either creates the commit plus an AI-authored PR title/body or leaves the branch uncommitted. Generated PR bodies include an issue-closing reference and the managed PR assistant section markers. |
| `git-ai issue <number> --mode unattended` | Full local issue-to-PR flow in unattended mode. Requires `ai.runtime.type` to be `codex`, reuses the same per-issue branch and session state as interactive runs, launches Codex non-interactively, commits with the generated commit message automatically, and then opens the pull request without prompting. |
| `git-ai issue batch <number> <number> [...number]` | Sequential unattended issue queue. Defaults to `--mode unattended`, requires at least two unique issue numbers, runs each issue as its own independent unattended issue execution, stores batch progress separately under `.git-ai/batches/`, and stops immediately at the first incomplete issue so reruns can resume from there. |
| `git-ai issue draft` | Interactive issue drafting flow. Prompts for a rough idea, creates `.git-ai/` draft-run artifacts, launches the configured runtime so it can inspect the repository and ask targeted follow-up questions itself, expects the runtime to write the Markdown draft under `.git-ai/issues/`, previews the draft in the terminal, and lets you create it as-is, modify it in `$VISUAL`, `$EDITOR`, or `vim`, or keep it on disk without creating the issue. |
| `git-ai issue plan <number>` | Generates an issue resolution plan for the configured forge issue through the configured text provider and posts it as a managed comment. If an editable plan comment already exists, the command reuses it instead of overwriting collaborator edits. |
| `git-ai issue prepare <number>` | Switches to the configured `baseBranch`, pulls the latest changes, prepares the issue branch and `.git-ai/` workspace artifacts, and then prints machine-readable JSON describing the run. |
| `git-ai issue prepare <number> --mode github-action` | Same preparation flow, but writes prompt instructions tailored for non-interactive GitHub Actions runs. |
| `git-ai issue finalize <number>` | Generates a proposed commit message from the current repository diff, lets you preview, edit, or skip it, and creates the commit only after confirmation. |

Important behavior:

- `git-ai issue` requires a clean working tree before it starts
- `git-ai issue batch ...` requires at least two unique issue numbers
- `git-ai issue draft` previews the generated draft in the terminal and only opens `$VISUAL`, `$EDITOR`, or `vim` when you explicitly choose modify
- `git-ai issue draft` requires the configured runtime CLI on `PATH`
- `git-ai issue plan <number>` requires the configured provider to be usable, defaulting to `OPENAI_API_KEY`
- local full issue runs require the configured runtime CLI on `PATH`
- full local issue runs execute the configured `buildCommand`, defaulting to `pnpm build`
- local full issue runs preview the proposed commit message and let you edit or skip it before committing
- local interactive runtime prompts end with an explicit done-state summary, a short note about how to see the result or what was verified, and plain-language next steps
- for local full issue runs, `git-ai` resumes the build, commit, and PR steps after you exit the runtime
- unattended issue runs require `ai.runtime.type` to be `codex`
- unattended single-issue and batch runs keep per-issue resume state in `.git-ai/issues/<number>/session.json`
- unattended batch runs reject `--mode interactive`
- unattended batch runs keep queue progress separately in `.git-ai/batches/` and skip issues already marked completed on later reruns of the same ordered batch
- issue preparation checks out and pulls the configured `baseBranch`, defaulting to `main`
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
| `git-ai pr fix-comments <pr-number>` | Fetches pull request metadata and review comments from the configured forge, filters out obviously non-actionable comments, groups nearby threads into selectable review tasks, preserves non-trivial replies as thread context, writes richer `.git-ai/` run artifacts, opens the configured interactive runtime, runs the configured build command, and then previews a proposed commit message that you can edit, accept, or skip. |
| `git-ai pr fix-tests <pr-number>` | Fetches pull request metadata and PR issue comments from the configured forge, finds the managed AI Test Suggestions comment, parses structured suggestion areas into selectable tasks, writes focused `.git-ai/` run artifacts, opens the configured interactive runtime, runs the configured build command, and then previews a proposed commit message that you can edit, accept, or skip. |

Important behavior:

- `git-ai pr fix-comments <pr-number>` requires a clean working tree before it starts
- `git-ai pr fix-tests <pr-number>` requires a clean working tree before it starts
- local PR comment-fix runs require the configured runtime CLI on `PATH`
- local PR test-fix runs require the configured runtime CLI on `PATH`
- PR comment-fix and test-fix runs execute the configured `buildCommand`, defaulting to `pnpm build`
- local interactive runtime prompts end with an explicit done-state summary, a short note about how to see the result or what was verified, and plain-language next steps
- the command expects the relevant PR branch to already be checked out locally before the runtime starts editing
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

- `git-ai review` requires the configured provider to be usable, defaulting to `OPENAI_API_KEY`
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
| `packages/providers` | AI provider integrations, including OpenAI and Bedrock Claude adapters plus shared provider selection helpers. |
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
git diff --unified=3 -- . ':!pnpm-lock.yaml' > /tmp/git-ai-pr-review.diff

INPUT_DIFF_FILE="/tmp/git-ai-pr-review.diff" \
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

- `INPUT_DIFF` optional when `INPUT_DIFF_FILE` is set
- `INPUT_DIFF_FILE` optional file path, preferred for large diffs
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
git diff -- . ':!pnpm-lock.yaml' > /tmp/git-ai-pr-assistant.diff
git log --reverse --format='%s%n%b%n---' HEAD~3..HEAD > /tmp/git-ai-pr-assistant-commits.txt

INPUT_DIFF_FILE="/tmp/git-ai-pr-assistant.diff" \
INPUT_COMMIT_MESSAGES_FILE="/tmp/git-ai-pr-assistant-commits.txt" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Human-authored PR notes" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-assistant/dist/index.js
```

Inputs:

- `INPUT_DIFF` optional when `INPUT_DIFF_FILE` is set
- `INPUT_DIFF_FILE` optional file path, preferred for large diffs
- `INPUT_COMMIT_MESSAGES` optional
- `INPUT_COMMIT_MESSAGES_FILE` optional file path for commit messages
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
git diff -- . ':!pnpm-lock.yaml' > /tmp/git-ai-test-suggestions.diff

INPUT_DIFF_FILE="/tmp/git-ai-test-suggestions.diff" \
INPUT_PR_TITLE="Example PR title" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/test-suggestions/dist/index.js
```

Inputs:

- `INPUT_DIFF` optional when `INPUT_DIFF_FILE` is set
- `INPUT_DIFF_FILE` optional file path, preferred for large diffs
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

All three pull-request-triggered AI workflows generate their diff input through the built CLI helper and hand it to the local action through a temporary file, so `.git-ai/config.json` `aiContext.excludePaths` is honored in pull request automation without hitting GitHub Actions argument-length limits.
