# git-ai

`git-ai` is a GitHub-first AI workflow layer for teams that want better pull request throughput before they trust broader repository automation.

The primary offer is intentionally narrow:

- review pull requests with better context
- update pull requests without overwriting human-written guidance
- fix selected review feedback inside the live PR branch
- surface missing tests before quality drifts

Starting here gives a new team faster proof of value with lower runtime risk, fewer permissions, and less process change than full issue-to-PR automation on day one.

Advanced issue-to-PR automation still exists, but it is not the recommended entry point for new teams because it asks for broader runtime trust, more GitHub permissions, and more process discipline on day one.

GitHub-only by design:

- `git-ai` currently targets GitHub repositories and GitHub pull request workflows on purpose
- the launch goal is a strong GitHub offer first, not thin parity across every forge

Recommended launch path today:

- forge: GitHub
- structured-text provider: OpenAI
- interactive runtime: Codex

`bedrock-claude` and `claude-code` remain supported for advanced customization, but they are not the default first-offer path and some workflows remain intentionally asymmetric.

## Primary offer

Start here if you are evaluating `git-ai` for a team:

| Surface | Why it is part of the primary offer |
| --- | --- |
| `actions/pr-review` | Adds AI pull request pre-review signal, higher-level findings, and line-linked review comments in GitHub. |
| `actions/pr-assistant` | Maintains a managed PR assistant section in the pull request body without overwriting unrelated manual content, using stable summary, risk, file, testing, rollout, and checklist headings. |
| `actions/test-suggestions` | Posts practical, task-ready test suggestions for the current pull request diff in GitHub. |
| `git-ai review` | Runs a local top-risk diff pre-review that surfaces the strongest reviewer-ready concerns before or during a pull request. |
| `git-ai pr fix-comments <pr-number>` | Pulls selected GitHub review comments into a focused local fix flow. |
| `git-ai pr fix-tests <pr-number>` | Pulls selected managed AI test suggestions into a focused local implementation flow with preserved task context. |
| `git-ai test-backlog` | Finds the highest-value automated testing gaps in the repository. |

## Launch demo guide

Use [docs/launch-demo.md](docs/launch-demo.md) when you need a buyer-facing walkthrough of the first-offer workflows. It lays out the recommended demo order, the trust boundary for each step, the `.git-ai` audit trail story, and the narrow onboarding path that matches the current implementation.

## Recommended first three workflows

These are the fastest paths to a useful first result:

1. Review a pull request better: use `actions/pr-review` in GitHub or run `git-ai review --base origin/main` locally.
2. Respond to live PR feedback: run `git-ai pr fix-comments <pr-number>` or `git-ai pr fix-tests <pr-number>` when the PR branch is checked out locally.
3. Raise test confidence: use `actions/test-suggestions` on pull requests and `git-ai test-backlog --top 5` for repository-wide gaps.

Add `actions/pr-assistant` when you also want managed PR-body updates that preserve human-written context.

## Advanced and beta workflows

These workflows remain supported and documented below, but they are separate from the launch-stage offer because they ask a new team to trust wider-scoped automation earlier. The CLI now prints local launch-stage notices before these commands run.

Advanced workflows:

- `git-ai issue draft`
- `git-ai issue plan <number> [--refresh]`
- `git-ai issue prepare <number>`
- `git-ai issue finalize <number>`
- `git-ai issue <number>`

Beta workflows:

- `git-ai issue batch <number> <number> [...number]`
- `git-ai pr prepare-review <pr-number>`
- `git-ai feature-backlog`

Separate from the command tiers, multi-provider and runtime-parity paths such as `bedrock-claude` and `claude-code` also remain supported but are still deeper-launch paths.

## Quick start

### Prerequisites

- `git`
- Node.js and `pnpm`
- `OPENAI_API_KEY` for the recommended OpenAI provider path

Advanced provider customization:

- if you later switch the local CLI to `bedrock-claude`, also provide AWS credentials plus `AWS_REGION` or `AWS_DEFAULT_REGION`

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

`OPENAI_*` is used by the default `openai` provider and is the recommended first setup. If you later switch `.git-ai/config.json` to `bedrock-claude`, add `AWS_REGION` or `AWS_DEFAULT_REGION` plus standard AWS credentials at that point.

Then run the guided repository setup:

```bash
cd /path/to/your-repo
git-ai setup
```

`git-ai setup` detects the repository root, suggests repo-aware defaults for the base branch, verification command, forge, and extra AI exclusions, writes `.git-ai/config.json`, ensures `.git-ai/` is gitignored, and can create or update a managed `AGENTS.md` guidance section. When setup cannot determine a value confidently, it prints an explicit warning before asking you to confirm or replace the suggestion.

The setup flow also makes the recommended launch path explicit: GitHub forge, OpenAI provider, and Codex runtime first. `bedrock-claude` and `claude-code` stay available as advanced customization paths after the default GitHub/OpenAI/Codex path is working.

### First successful CLI runs

Move into that target repository and try the two safest CLI workflows first:

```bash
git-ai review
git-ai test-backlog --top 5
```

If you already have a live GitHub pull request branch checked out locally, the next recommended workflows are:

```bash
git-ai pr fix-comments 88
git-ai pr fix-tests 88
```

The matching GitHub automation surfaces are `actions/pr-review`, `actions/pr-assistant`, and `actions/test-suggestions`.

You only need extra tooling for advanced or deeper local workflows:

- an available interactive runtime CLI on `PATH` for `git-ai issue draft`, local interactive `git-ai issue <number>` runs, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>`
  default: `codex`
  `ai.runtime.type: "claude-code"`: `claude`
  if the configured non-default runtime is unavailable, `git-ai` falls back to `codex` when it is installed
- `codex` on `PATH` for `git-ai pr prepare-review <pr-number>`, which checks out a reviewer workspace, syncs it with the latest PR base branch, resolves merge conflicts in Codex when needed, generates the review brief, leaves you in an interactive Codex session for follow-up questions or fixes, offers the same reviewed commit-message flow as other local fix workflows when that session makes changes, and pushes any new reviewed commits back to the PR head branch before exiting
- `codex` plus authenticated GitHub access for `git-ai issue <number> --mode unattended` and `git-ai issue batch ...`
- `gh`, `GH_TOKEN`, or `GITHUB_TOKEN` for GitHub-backed issue and pull request flows

`git-ai` resolves the active repository from your current Git working tree at runtime. It loads `.env` and `.git-ai/config.json` from that repository root, not from the CLI build location.

### Runtime and provider asymmetry

The launch path is not presented as full runtime or provider parity:

- GitHub Actions in this repository are OpenAI-only today. They do not expose Bedrock Claude or runtime-selection inputs.
- `git-ai pr prepare-review <pr-number>` always requires `codex` on `PATH` and keeps its merge-conflict and review-brief flow Codex-specific.
- `git-ai issue <number> --mode unattended` and `git-ai issue batch ...` require `ai.runtime.type` to be `codex`.
- Interactive local workflows such as `git-ai issue draft`, `git-ai issue <number>`, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>` use the configured runtime, with fallback to Codex when a configured non-default runtime is unavailable.
- Structured-text workflows such as `git-ai commit`, `git-ai diff`, `git-ai review`, and issue-plan / PR-text generation use the configured provider, defaulting to OpenAI and allowing `bedrock-claude` as an advanced option.

## Command tiers

Run `git-ai help` or `git-ai --help` for the same tiered overview in the terminal.

Primary offer commands:

- `git-ai review`: review the current diff or a branch comparison
- `git-ai pr fix-comments <pr-number>`: fix selected PR review comments with the configured interactive runtime
- `git-ai pr fix-tests <pr-number>`: implement selected AI PR test suggestions with the configured interactive runtime and their preserved task details
- `git-ai test-backlog`: find high-value automated testing gaps

Advanced commands:

- `git-ai issue draft`: turn a rough idea into a structured issue draft
- `git-ai issue plan <number> [--refresh]`: maintain an issue-resolution plan comment as secondary execution support
- `git-ai issue <number>`: run the full local issue-to-PR workflow
- `git-ai issue prepare <number>` and `git-ai issue finalize <number>`: split issue setup from local completion

Beta commands:

- `git-ai issue batch ...`: queue unattended issue-to-PR runs
- `git-ai pr prepare-review <pr-number>`: prepare a reviewer workspace and review brief before a live Codex session
- `git-ai feature-backlog`: find high-value feature opportunities

Supporting commands:

- `git-ai setup`: guided repository onboarding for `git-ai`
- `git-ai commit`: generate a commit message from staged changes
- `git-ai diff`: summarize `git diff HEAD`

## Configuration

### `.env`

Create `.env` in the target repository root:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

`OPENAI_MODEL` and `OPENAI_BASE_URL` are optional. The CLI defaults to `gpt-4o-mini` and `https://api.openai.com/v1` when `ai.provider.type` is `openai`. If you switch to `bedrock-claude`, set `AWS_REGION` or `AWS_DEFAULT_REGION` and provide AWS credentials through the standard AWS provider chain.

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

Recommended first configuration: leave `ai.provider.type` unset so it defaults to `openai`, leave `ai.runtime.type` unset so it defaults to `codex`, and use `forge.type: "github"` for GitHub-backed issue and PR flows. Change provider or runtime settings only when you need a deeper customization path.

Supported fields:

- `ai.runtime.type`: interactive runtime used by `git-ai issue draft`, local `git-ai issue <number>`, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>`. Supported values: `"codex"` and `"claude-code"`. Default: `"codex"`.
- `ai.provider.type`: structured text provider used by `git-ai commit`, `git-ai diff`, `git-ai review`, `git-ai issue plan <number> [--refresh]`, and commit/PR generation inside `git-ai issue <number>` and `git-ai issue finalize <number>`. Supported values: `"openai"` and `"bedrock-claude"`. Default: `"openai"`.
- `ai.provider.model`: optional for `"openai"`, required for `"bedrock-claude"`.
- `ai.provider.baseUrl`: optional override for `"openai"`.
- `ai.provider.region`: optional explicit AWS region for `"bedrock-claude"`. Falls back to `AWS_REGION` or `AWS_DEFAULT_REGION`.
- `aiContext.excludePaths`: repository-relative glob patterns excluded from AI diff and repository context. These exclusions apply across `git-ai commit`, `git-ai diff`, `git-ai review`, issue-to-PR flows, and repository backlog scans. Bare filename globs like `*.map` match by basename anywhere in the repository. Defaults: `["**/node_modules/**", "**/vendor/**", "**/dist/**", "**/build/**", "*.map"]`.
- `baseBranch`: base branch used by `git-ai issue <number>` and `git-ai issue prepare <number>` when switching, syncing from `origin`, and opening pull requests. If unset, the resolved default is `main`, but `git-ai setup` first tries the remote default branch and then prints an explicit fallback warning when it has to guess.
- `buildCommand`: command run after the interactive runtime exits during full local `git-ai issue <number>`, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>` flows. If unset, the resolved default is `["pnpm", "build"]`, but `git-ai setup` first tries repository-local `verify`, `build`, or `test` commands from `package.json`, `composer.json`, or PHPUnit signals and warns before falling back.
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
- the configured provider must be usable; with the default configuration that means `OPENAI_API_KEY`

### `git-ai diff`

```bash
git-ai diff
```

Summarizes the current `git diff HEAD`.

Requirements:

- the repository must already have at least one commit
- there must be changes in `git diff HEAD`
- the configured provider must be usable; with the default configuration that means `OPENAI_API_KEY`

### `git-ai setup`

```bash
git-ai setup
```

Runs a guided repository setup flow for the current Git repository. The command inspects the repo, suggests defaults for `baseBranch`, `forge.type`, `buildCommand`, and extra `aiContext.excludePaths`, prints the detection source for each suggestion, warns when it had to fall back because signals were missing or conflicting, writes `.git-ai/config.json`, ensures `.git-ai/` is gitignored, and can create or update a managed `AGENTS.md` section with repo-specific guidance.

The setup flow still expects you to create `.env` yourself because it cannot safely write secrets like `OPENAI_API_KEY`. It also calls out the recommended GitHub/OpenAI/Codex launch path and points advanced users to `bedrock-claude` and `claude-code` as customization paths rather than parity guarantees.

### `git-ai issue`

Usage:

```bash
git-ai issue <number> [--mode <interactive|unattended>]
git-ai issue batch <number> <number> [...number] [--mode unattended]
git-ai issue draft
git-ai issue plan <number> [--refresh]
git-ai issue prepare <number> [--mode <local|github-action>]
git-ai issue finalize <number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `git-ai issue <number>` | Full local issue-to-PR flow in interactive mode. Preflights the configured forge, verification command, and `baseBranch`, fetches the configured forge issue, fast-forwards the configured base branch to `origin/<base-branch>`, creates the issue branch, writes `.git-ai/` workspace files, opens the configured interactive runtime, runs the configured build command after that runtime exits, generates a proposed commit message from the completed diff for review, and then either creates the commit plus an AI-authored PR title/body or leaves the branch uncommitted. Creating the pull request pushes the reviewed issue branch first. Generated PR bodies include an issue-closing reference and the managed PR assistant section markers. |
| `git-ai issue <number> --mode unattended` | Full local issue-to-PR flow in unattended mode. Requires `ai.runtime.type` to be `codex`, reuses the same per-issue branch and session state as interactive runs, launches Codex non-interactively, commits with the generated commit message automatically, pushes the issue branch through the pull-request creation path, and then opens the pull request without prompting. |
| `git-ai issue batch <number> <number> [...number]` | Sequential unattended issue queue. Defaults to `--mode unattended`, requires at least two unique issue numbers, runs each issue as its own independent unattended issue execution, stores batch progress separately under `.git-ai/batches/`, and stops immediately at the first incomplete issue so reruns can resume from there. Each completed issue uses the same unattended issue-to-PR path, including pushing the branch before opening the pull request. |
| `git-ai issue draft` | Interactive issue drafting flow. Prompts for a rough idea, creates `.git-ai/` draft-run artifacts, launches the configured runtime so it can inspect the repository and ask targeted follow-up questions itself, expects the runtime to write the Markdown draft under `.git-ai/issues/`, previews the draft in the terminal, and lets you create it as-is, modify it in `$VISUAL`, `$EDITOR`, or `vim`, or keep it on disk without creating the issue. |
| `git-ai issue plan <number> [--refresh]` | Secondary issue-execution support. By default it generates a managed issue resolution plan comment once and safely reuses the latest edited managed comment on later runs. Pass `--refresh` to regenerate the managed comment when the issue context has changed. Generated plans include acceptance criteria, likely files, implementation steps, test plan, risks, and a done definition. |
| `git-ai issue prepare <number>` | Preflights the configured forge, verification command, and `baseBranch`, fast-forwards the configured base branch to `origin/<base-branch>`, prepares the issue branch and `.git-ai/` workspace artifacts, and then prints machine-readable JSON describing the run. |
| `git-ai issue prepare <number> --mode github-action` | Same preparation flow, but writes prompt instructions tailored for non-interactive GitHub Actions runs. |
| `git-ai issue finalize <number>` | Generates a proposed commit message from the current repository diff, lets you preview, edit, or skip it, and creates the commit only after confirmation. It does not push or open a pull request. |

Important behavior:

- `git-ai issue draft`, `git-ai issue plan <number> [--refresh]`, `git-ai issue prepare <number>`, `git-ai issue finalize <number>`, and full `git-ai issue <number>` runs print an advanced workflow notice before execution
- `git-ai issue batch ...` prints a beta workflow notice before execution
- `git-ai issue` requires a clean working tree before it starts
- `git-ai issue <number>` and `git-ai issue prepare <number>` fail before checkout if the configured verification command cannot run from the repository root
- `git-ai issue <number>` and `git-ai issue prepare <number>` fail before checkout if the configured base branch is missing locally, missing on `origin`, or cannot be fast-forwarded cleanly
- `git-ai issue batch ...` requires at least two unique issue numbers
- `git-ai issue draft` previews the generated draft in the terminal and only opens `$VISUAL`, `$EDITOR`, or `vim` when you explicitly choose modify
- `git-ai issue draft` requires an available interactive runtime CLI on `PATH`; if the configured non-default runtime is unavailable, `git-ai` falls back to `codex` when possible
- `git-ai issue plan <number> [--refresh]` requires issue access through the configured forge; creating or refreshing a managed plan comment also requires the configured provider plus GitHub authentication
- `git-ai issue finalize <number>` requires local file changes plus a usable configured provider so it can draft the proposed commit message
- local full issue runs require an available interactive runtime CLI on `PATH`
- local full issue runs require the configured provider for commit and PR text generation
- full local issue runs execute the configured `buildCommand`, defaulting to `pnpm build`
- local full issue runs preview the proposed commit message and let you edit or skip it before committing
- local interactive runtime prompts end with an explicit done-state summary, a short note about how to see the result or what was verified, and plain-language next steps
- for local full issue runs, `git-ai` resumes the build, commit, and PR steps after you exit the runtime
- unattended issue runs require `ai.runtime.type` to be `codex`
- unattended single-issue and batch runs keep per-issue resume state in `.git-ai/issues/<number>/session.json`
- unattended batch runs reject `--mode interactive`
- unattended batch runs keep queue progress separately in `.git-ai/batches/` and skip issues already marked completed on later reruns of the same ordered batch
- issue preparation checks out the configured `baseBranch` and fast-forwards it to `origin/<base-branch>`, defaulting to `main` only when no repository config is present
- PR creation uses the configured `baseBranch`, defaulting to `main`
- GitHub-backed PR creation requires `gh` to be installed and authenticated
- GitHub-backed issue plan comments require `GH_TOKEN` or `GITHUB_TOKEN`, or an authenticated `gh` session, when they are created or refreshed
- if an issue resolution plan comment exists, `git-ai issue prepare <number>` and full `git-ai issue <number>` runs copy the latest edited plan into the generated issue snapshot
- when `forge.type` is `github`, issue fetching uses `gh issue view` when available, otherwise the GitHub API
- when `forge.type` is `github`, GitHub API access for issue fetching, plan comments, or issue creation uses `GH_TOKEN` or `GITHUB_TOKEN` when present
- when `forge.type` is `github`, `git-ai issue draft` can create issues with either `gh` or a GitHub token
- when `forge.type` is `none`, issue and PR creation features are disabled for the repository

### `git-ai pr`

Usage:

```bash
git-ai pr prepare-review <pr-number>
git-ai pr fix-comments <pr-number>
git-ai pr fix-tests <pr-number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `git-ai pr prepare-review <pr-number>` | Fetches pull request metadata and linked issues, requires a clean working tree, preflights the configured verification command plus the live PR base branch on `origin`, checks out the best available local review branch for the PR, fetches the latest `origin/<base-branch>` tip, skips merging when the checked-out branch already contains that tip, otherwise merges the base branch into the review branch before brief generation, routes merge conflicts through an interactive Codex conflict-resolution session when needed, writes `.git-ai/` run artifacts, generates `review-brief.md`, prints the saved brief path plus a terminal preview, and then leaves you in an interactive Codex session on that branch for follow-up review questions or requested fixes. After that session exits, `git-ai` exits cleanly if there are no new reviewed commits to sync, or else runs the configured build command when there are follow-up file changes, offers the same reviewed commit-message flow used by the other local fix workflows, and pushes any new reviewed commits back to `origin/<pr-head-branch>`. |
| `git-ai pr fix-comments <pr-number>` | Requires a clean working tree, preflights the configured verification command, fetches pull request metadata and review comments from the configured forge, filters out obviously non-actionable comments, groups nearby threads into selectable review tasks, preserves non-trivial replies as thread context, writes richer `.git-ai/` run artifacts, opens the configured interactive runtime, runs the configured build command, previews a proposed commit message that you can edit, accept, or skip, and then pushes the reviewed commit back to `origin/<pr-head-branch>` when `HEAD` is ahead and not behind after fetching the latest remote head. |
| `git-ai pr fix-tests <pr-number>` | Requires a clean working tree, preflights the configured verification command, fetches pull request metadata and PR issue comments from the configured forge, finds the managed AI Test Suggestions comment, parses structured suggestion tasks including behavior, regression risk, protected paths, likely locations, edge cases, and implementation notes, writes focused `.git-ai/` run artifacts, opens the configured interactive runtime, runs the configured build command, previews a proposed commit message that you can edit, accept, or skip, and then pushes the reviewed commit back to `origin/<pr-head-branch>` when `HEAD` is ahead and not behind after fetching the latest remote head. |

Important behavior:

- `git-ai pr prepare-review <pr-number>` prints a beta workflow notice before execution
- `git-ai pr prepare-review <pr-number>` requires a clean working tree before it starts
- `git-ai pr fix-comments <pr-number>` requires a clean working tree before it starts
- `git-ai pr fix-tests <pr-number>` requires a clean working tree before it starts
- `git-ai pr prepare-review <pr-number>`, `git-ai pr fix-comments <pr-number>`, and `git-ai pr fix-tests <pr-number>` fail early when the configured verification command cannot run from the repository root
- `git-ai pr prepare-review <pr-number>` requires `codex` on `PATH`
- `git-ai pr prepare-review <pr-number>` validates that the live PR base branch still exists on `origin` before it checks out or fetches a review branch
- `git-ai pr prepare-review <pr-number>` reuses a linked issue branch when exactly one linked issue has saved local state and that branch still exists locally
- otherwise `git-ai pr prepare-review <pr-number>` checks out the local PR head branch when it already exists, or fetches the PR head into a dedicated `review/pr-<pr-number>-<slug>` branch
- after checkout, `git-ai pr prepare-review <pr-number>` fetches the latest `origin/<pr-base-branch>` tip and records whether the branch was already current or had to be merged with the latest base branch
- if that base-branch merge conflicts, `git-ai pr prepare-review <pr-number>` opens a focused Codex conflict-resolution session and only continues to review-brief generation after the merge is fully resolved
- `git-ai pr prepare-review <pr-number>` writes `prompt.md`, `metadata.json`, `output.log`, and `review-brief.md` under a timestamped `.git-ai/runs/` directory and may also write supporting workflow artifacts there
- after generating the brief, `git-ai pr prepare-review <pr-number>` drops you into an interactive Codex shell so you can ask follow-up questions or request fixes before exiting Codex
- after that interactive session exits, `git-ai pr prepare-review <pr-number>` skips build and commit review if there are no follow-up file changes, but still pushes any new reviewed commits created by the workflow, such as a base-sync merge
- if the follow-up session changed files, `git-ai pr prepare-review <pr-number>` runs the configured build command, previews a proposed commit message that you can accept, edit, or skip, and then pushes the resulting reviewed branch state back to the PR head branch when it is ahead of `origin/<pr-head-branch>`
- when a linked issue has a live saved Codex session, `git-ai pr prepare-review <pr-number>` reuses it for brief generation and the follow-up interactive session; stale sessions are warned about and fall back to a fresh run
- local PR comment-fix runs require the configured runtime CLI on `PATH`
- local PR test-fix runs require the configured runtime CLI on `PATH`
- PR comment-fix and test-fix runs execute the configured `buildCommand`, defaulting to `pnpm build`
- after an accepted reviewed commit, `git-ai pr fix-comments <pr-number>` and `git-ai pr fix-tests <pr-number>` fetch `origin/<pr-head-branch>` and only push when `HEAD` is ahead and not behind; if the branch diverged or the remote head cannot be resolved, the command fails clearly and keeps the local commit
- if you decline the reviewed commit message, `git-ai pr fix-comments <pr-number>` and `git-ai pr fix-tests <pr-number>` leave the changes uncommitted and do not attempt a push
- local interactive runtime prompts end with an explicit done-state summary, a short note about how to see the result or what was verified, and plain-language next steps
- the command expects the relevant PR branch to already be checked out locally before the runtime starts editing
- the interactive selector accepts numbered thread choices and, when available, grouped task choices like `g1`; `all` still selects every individual thread
- `git-ai pr fix-tests <pr-number>` accepts `all`, `none`, or a comma-separated suggestion list like `1,2`
- managed AI test suggestions now carry behavior covered, regression risk, suggested test type, protected paths, suggestion-level edge cases, and a short implementation note so the selected snapshot can be used directly as implementation guidance
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
| `--format markdown` | Prints a readable Markdown pre-review signal for a human reviewer, capped to the strongest reviewer-ready risks. This is the default. |
| `--format json` | Prints the structured review payload, including higher-level findings and line-linked comments, with the combined risk set trimmed to the strongest few items. |
| `--issue-number <number>` | Fetches the linked issue from the configured forge and includes it as review context. |

Examples:

```bash
git-ai review
git-ai review --base origin/main
git-ai review --base origin/main --head HEAD --format json
GITHUB_TOKEN=... git-ai review --issue-number 50
```

Important behavior:

- `git-ai review` requires the configured provider to be usable; with the default configuration that means `OPENAI_API_KEY`
- without `--base`, it reviews the current `git diff HEAD`
- with `--issue-number`, the CLI fetches the issue title and body from the configured forge and grounds the review in that context
- markdown output is optimized as a compact pre-review checklist that highlights only the top 3 to 5 reviewer-ready risks when the diff supports that many, and fewer when the diff is low risk
- JSON output keeps the same `summary` / `findings` / `comments` structure for automation, with severity, confidence, affected file, why-this-matters context, optional suggested fixes, and right-side line numbers taken from the diff

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

- `git-ai feature-backlog` prints a beta workflow notice before execution
- the repository analysis is heuristic and based on the repository structure, current product surface, and automation signals
- with the default GitHub forge integration, `--create-issues` requires `GH_TOKEN` or `GITHUB_TOKEN`
- feature backlog issue creation uses the analyzed repository's configured forge, so the required credentials follow that forge's issue-creation path
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

The managed `body` output is written as pre-review signal for a human reviewer. `comments_json` carries severity, confidence, affected file, why-this-matters context, and optional suggested fixes for each candidate comment.

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
- `section` with `Summary`, `Risk areas`, `Files changed`, `Testing notes`, `Rollout concerns`, and `Reviewer checklist`
- `body`

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout.

`Files changed` is derived from the diff headers in code so the managed section stays grounded in the actual patch.

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

The generated managed comment keeps each suggestion compact but task-ready by including the behavior covered, likely regression risk, suggested test type, protected paths, likely implementation locations, suggestion-specific edge cases when useful, and a short implementation note.

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
- `.github/workflows/pr-review.yml`: generates an AI PR pre-review signal, updates a managed PR comment, and posts only high-confidence inline review comments on changed lines
- `.github/workflows/pr-assistant.yml`: updates the pull request body with a managed PR assistant section
- `.github/workflows/test-suggestions.yml`: creates or updates a managed PR comment with suggested automated test coverage
- `.github/workflows/issue-to-pr.yml`: manual issue-to-PR automation that prepares issue context, runs Codex in GitHub Actions, builds the repository, commits generated changes, and opens or reuses a PR
- `.github/workflows/test-backlog.yml`: manual repository-wide test backlog scan with optional issue creation

All three pull-request-triggered AI workflows generate their diff input through the built CLI helper and hand it to the local action through a temporary file, so `.git-ai/config.json` `aiContext.excludePaths` is honored in pull request automation without hitting GitHub Actions argument-length limits.
