# prs

`prs` is a GitHub-first AI workflow layer for teams that want better pull request throughput before they trust broader repository automation.

The primary offer is intentionally narrow:

- review pull requests with better context
- update pull requests without overwriting human-written guidance
- fix selected review feedback inside the live PR branch
- surface missing tests before quality drifts

Starting here gives a new team faster proof of value with lower runtime risk, fewer permissions, and less process change than full issue-to-PR automation on day one.

Advanced issue-to-PR automation still exists, but it is not the recommended entry point for new teams because it asks for broader runtime trust, more GitHub permissions, and more process discipline on day one.

GitHub-only by design:

- `prs` currently targets GitHub repositories and GitHub pull request workflows on purpose
- the launch goal is a strong GitHub offer first, not thin parity across every forge

Recommended launch path today:

- forge: GitHub
- structured-text provider: OpenAI
- interactive runtime: Codex

`bedrock-claude` and `claude-code` remain supported for advanced customization, but they are not the default first-offer path and some workflows remain intentionally asymmetric.

`prs` is the canonical CLI name. The legacy `git-ai` command still works during the migration window, but it now prints a deprecation warning before continuing.

## Primary offer

Start here if you are evaluating `prs` for a team:

| Surface | Why it is part of the primary offer |
| --- | --- |
| `actions/pr-review` | Adds AI pull request pre-review signal, higher-level findings, and line-linked review comments in GitHub. |
| `actions/pr-assistant` | Maintains a managed PR assistant section in the pull request body without overwriting unrelated manual content, using stable summary, risk, file, testing, rollout, and checklist headings. |
| `actions/test-suggestions` | Posts practical, task-ready test suggestions for the current pull request diff in GitHub. |
| `prs review` | Runs a local top-risk diff pre-review that surfaces the strongest reviewer-ready concerns before or during a pull request. |
| `prs pr fix-comments <pr-number>` | Pulls selected GitHub review comments into a focused local fix flow. |
| `prs pr fix-tests <pr-number>` | Pulls selected managed AI test suggestions into a focused local implementation flow with preserved task context. |
| `prs test-backlog` | Finds the highest-value automated testing gaps in the repository. |

## Launch demo guide

Use [docs/launch-demo.md](docs/launch-demo.md) when you need a buyer-facing walkthrough of the first-offer workflows. It lays out the recommended demo order, the trust boundary for each step, the `.prs` audit trail story, and the narrow onboarding path that matches the current implementation.

## Recommended first three workflows

These are the fastest paths to a useful first result:

1. Review a pull request better: use `actions/pr-review` in GitHub or run `prs review --base origin/main` locally.
2. Respond to live PR feedback: run `prs pr fix-comments <pr-number>` or `prs pr fix-tests <pr-number>` when the PR branch is checked out locally.
3. Raise test confidence: use `actions/test-suggestions` on pull requests and `prs test-backlog --top 5` for repository-wide gaps.

Add `actions/pr-assistant` when you also want managed PR-body updates that preserve human-written context.

## Advanced and beta workflows

These workflows remain supported and documented below, but they are separate from the launch-stage offer because they ask a new team to trust wider-scoped automation earlier. The CLI now prints local launch-stage notices before these commands run.

Advanced workflows:

- `prs issue draft`
- `prs issue refine <number>`
- `prs issue plan <number> [--refresh]`
- `prs issue prepare <number>`
- `prs issue finalize <number>`
- `prs issue <number>`

Beta workflows:

- `prs issue batch <number> <number> [...number]`
- `prs pr prepare-review <pr-number>`
- `prs feature-backlog`

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
cd /path/to/prs
pnpm install
pnpm --filter @prs/cli build
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

`OPENAI_*` is used by the default `openai` provider and is the recommended first setup. If you later switch `.prs/config.json` to `bedrock-claude`, add `AWS_REGION` or `AWS_DEFAULT_REGION` plus standard AWS credentials at that point.

Then run the guided repository setup:

```bash
cd /path/to/your-repo
prs setup
```

`prs setup` detects the repository root, suggests repo-aware defaults for the base branch, verification command, forge, Codex-first runtime, the Codex-only `ai.issue.useCodexSuperpowers` flag, and extra AI exclusions, then offers a fast "use the recommended setup" confirmation path. It writes `.prs/config.json`, ensures `.prs/` is gitignored, can optionally add a minimal `AGENTS.md` scaffold for repo-specific agent guidance, and for GitHub repositories can also install the recommended PR-focused workflows under `.github/workflows/prs-*.yml`. When setup finds managed legacy `git-ai-*.yml` workflow files, it migrates them to the new `prs-*.yml` filenames instead of leaving duplicate managed files behind. When setup cannot determine a value confidently, it prints an explicit warning before asking you to confirm or replace the suggestion.

The setup flow also makes the recommended launch path explicit: GitHub forge, OpenAI provider, and Codex runtime first. `bedrock-claude` and `claude-code` stay available as advanced customization paths after the default GitHub/OpenAI/Codex path is working.

### First successful CLI runs

Move into that target repository and try the two safest CLI workflows first:

```bash
prs review
prs test-backlog --top 5
```

If you already have a live GitHub pull request branch checked out locally, the next recommended workflows are:

```bash
prs pr fix-comments 88
prs pr fix-tests 88
```

The matching GitHub automation surfaces are `actions/pr-review`, `actions/pr-assistant`, and `actions/test-suggestions`.

You only need extra tooling for advanced or deeper local workflows:

- an available interactive runtime CLI on `PATH` for `prs issue draft`, `prs issue refine <number>`, local interactive `prs issue <number>` runs, `prs pr fix-comments <pr-number>`, and `prs pr fix-tests <pr-number>`
  default: `codex`
  `ai.runtime.type: "claude-code"`: `claude`
  if the configured non-default runtime is unavailable, `prs` falls back to `codex` when it is installed
- `codex` on `PATH` for `prs pr prepare-review <pr-number>`, which checks out a reviewer workspace, syncs it with the latest PR base branch, resolves merge conflicts in Codex when needed, generates the review brief, leaves you in an interactive Codex session for follow-up questions or fixes, offers the same reviewed commit-message flow as other local fix workflows when that session makes changes, and pushes any new reviewed commits back to the PR head branch before exiting
- `codex` plus authenticated GitHub access for `prs issue <number> --mode unattended` and `prs issue batch ...`
- `gh`, `GH_TOKEN`, or `GITHUB_TOKEN` for GitHub-backed issue and pull request flows

`prs` resolves the active repository from your current Git working tree at runtime. It loads `.env` and `.prs/config.json` from that repository root, not from the CLI build location. If a repository has not been migrated yet, `prs` falls back to legacy `.git-ai/` config and workflow state when no `.prs/` equivalent exists.

### Runtime and provider asymmetry

The launch path is not presented as full runtime or provider parity:

- GitHub Actions in this repository are OpenAI-only today. They do not expose Bedrock Claude or runtime-selection inputs.
- `prs pr prepare-review <pr-number>` always requires `codex` on `PATH` and keeps its merge-conflict and review-brief flow Codex-specific.
- `prs issue <number> --mode unattended` and `prs issue batch ...` require `ai.runtime.type` to be `codex`.
- Interactive local workflows such as `prs issue draft`, `prs issue refine <number>`, `prs issue <number>`, `prs pr fix-comments <pr-number>`, and `prs pr fix-tests <pr-number>` use the configured runtime, with fallback to Codex when a configured non-default runtime is unavailable.
- Structured-text workflows such as `prs commit`, `prs diff`, `prs review`, and issue-plan / PR-text generation use the configured provider, defaulting to OpenAI and allowing `bedrock-claude` as an advanced option.

## Command tiers

Run `prs help` or `prs --help` for the same tiered overview in the terminal.

Primary offer commands:

- `prs review`: review the current diff or a branch comparison
- `prs pr fix-comments <pr-number>`: fix selected PR review comments with the configured interactive runtime
- `prs pr fix-tests <pr-number>`: implement selected AI PR test suggestions with the configured interactive runtime and their preserved task details
- `prs test-backlog`: find high-value automated testing gaps

Advanced commands:

- `prs issue draft`: turn a rough idea into a structured issue draft
- `prs issue refine <number>`: refine an existing GitHub issue into an implementation-ready specification
- `prs issue plan <number> [--refresh]`: maintain an issue-resolution plan comment as secondary execution support
- `prs issue <number>`: run the full local issue-to-PR workflow
- `prs issue prepare <number>` and `prs issue finalize <number>`: split issue setup from local completion

Beta commands:

- `prs issue batch ...`: queue unattended issue-to-PR runs
- `prs pr prepare-review <pr-number>`: prepare a reviewer workspace and review brief before a live Codex session
- `prs feature-backlog`: find high-value feature opportunities

Supporting commands:

- `prs setup`: guided repository onboarding for `prs`
- `prs commit`: generate a commit message from staged changes
- `prs diff`: summarize `git diff HEAD`

## Configuration

### `.env`

Create `.env` in the target repository root:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

`OPENAI_MODEL` and `OPENAI_BASE_URL` are optional. The CLI defaults to `gpt-4o-mini` and `https://api.openai.com/v1` when `ai.provider.type` is `openai`. If you switch to `bedrock-claude`, set `AWS_REGION` or `AWS_DEFAULT_REGION` and provide AWS credentials through the standard AWS provider chain.

### `.prs/config.json`

Optional repository-specific defaults live in `.prs/config.json`. `prs setup` can generate or update this file for you:

```json
{
  "ai": {
    "issue": {
      "useCodexSuperpowers": false
    },
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

- `ai.runtime.type`: interactive runtime used by `prs issue draft`, `prs issue refine <number>`, local `prs issue <number>`, `prs pr fix-comments <pr-number>`, and `prs pr fix-tests <pr-number>`. Supported values: `"codex"` and `"claude-code"`. Default: `"codex"`.
- `ai.issue.useCodexSuperpowers`: repository default for Superpowers-backed issue draft, refine, and plan workflows. When `true`, `prs issue draft`, `prs issue refine <number>`, and `prs issue plan <number>` use Codex Superpowers-specific instructions if the launched or selected runtime is Codex and Superpowers is available in the current Codex installation. Final issue drafts still use the normal `.prs/issues/` or refine-run draft paths, while intermediate Superpowers spec and plan artifacts stay inside the current `.prs/runs/<timestamp>-issue-draft/`, `.prs/runs/<timestamp>-issue-refine-<number>/`, or `.prs/runs/<timestamp>-issue-plan-<number>/` directory. `prs setup` detects local Codex Superpowers availability and writes this preferred flag automatically. Default: `false`.
- `ai.issueDraft.useCodexSuperpowers`: backward-compatible legacy input for repositories that already configured Superpowers-backed issue drafting. `ai.issue.useCodexSuperpowers` takes precedence when both settings are present.
- `ai.provider.type`: structured text provider used by `prs commit`, `prs diff`, `prs review`, `prs issue plan <number> [--refresh]`, and commit/PR generation inside `prs issue <number>` and `prs issue finalize <number>`. Supported values: `"openai"` and `"bedrock-claude"`. Default: `"openai"`.
- `ai.provider.model`: optional for `"openai"`, required for `"bedrock-claude"`.
- `ai.provider.baseUrl`: optional override for `"openai"`.
- `ai.provider.region`: optional explicit AWS region for `"bedrock-claude"`. Falls back to `AWS_REGION` or `AWS_DEFAULT_REGION`.
- `aiContext.excludePaths`: repository-relative glob patterns excluded from AI diff and repository context. These exclusions apply across `prs commit`, `prs diff`, `prs review`, issue-to-PR flows, and repository backlog scans. Bare filename globs like `*.map` match by basename anywhere in the repository. Defaults: `["**/node_modules/**", "**/vendor/**", "**/dist/**", "**/build/**", "*.map"]`.
- `baseBranch`: base branch used by `prs issue <number>` and `prs issue prepare <number>` when switching, syncing from `origin`, and opening pull requests. If unset, the resolved default is `main`, but `prs setup` first tries the remote default branch and then prints an explicit fallback warning when it has to guess.
- `buildCommand`: command run after the interactive runtime exits during full local `prs issue <number>`, `prs pr fix-comments <pr-number>`, and `prs pr fix-tests <pr-number>` flows. If unset, the resolved default is `["pnpm", "build"]`, but `prs setup` first tries repository-local `verify`, `build`, or `test` commands from `package.json`, `composer.json`, or PHPUnit signals and warns before falling back.
- `forge.type`: forge integration. Use `"github"` for GitHub-backed issue and PR flows or `"none"` to disable forge-backed issue and PR features for the repository.

Runtime and provider fallback behavior:

- if no `ai.runtime` config is present, `prs` uses `codex`
- if no `ai.issue.useCodexSuperpowers` or legacy `ai.issueDraft.useCodexSuperpowers` config is present, Superpowers-backed issue workflows use `false`
- if no `ai.provider` config is present, `prs` uses `openai`
- if a configured runtime is unavailable, `prs` falls back to `codex` when possible and prints a clear fallback message
- if Superpowers-backed issue workflows are enabled but Superpowers is unavailable when `prs issue draft`, `prs issue refine <number>`, or `prs issue plan <number>` runs, `prs` prints a clear fallback message and uses the standard prompt or structured provider-generated plan instead of failing
- if a configured provider is unavailable, `prs` falls back to `openai` when possible and prints a clear fallback message
- if neither the configured choice nor the default choice is usable, the command fails with an actionable error

### `.prs/`

`.prs/` is repository-local working state used by issue and backlog workflows. It is intentionally gitignored and should not be committed. `prs setup` will add `.prs/` to `.gitignore` when needed.

Think of `.prs/` as the working memory for issue, planning, and backlog flows.

Typical contents:

- `.prs/batches/`: persistent batch queue state for `prs issue batch ...`
- `.prs/issues/`: issue snapshots and generated drafts
- `.prs/runs/`: run prompts, metadata, logs, and run-local supporting artifacts such as Superpowers issue draft/refine spec and plan files

## CLI command reference

All diff-driven and repository-analysis commands respect `.prs/config.json` `aiContext.excludePaths`.

### `prs commit`

```bash
prs commit
```

Generates a commit message from the staged diff.

Requirements:

- staged changes must exist
- the configured provider must be usable; with the default configuration that means `OPENAI_API_KEY`

### `prs diff`

```bash
prs diff
```

Summarizes the current `git diff HEAD`.

Requirements:

- the repository must already have at least one commit
- there must be changes in `git diff HEAD`
- the configured provider must be usable; with the default configuration that means `OPENAI_API_KEY`

### `prs setup`

```bash
prs setup
```

Runs a guided repository setup flow for the current Git repository. The command inspects the repo, suggests defaults for `baseBranch`, `forge.type`, `ai.runtime.type`, `ai.issue.useCodexSuperpowers`, `buildCommand`, and extra `aiContext.excludePaths`, prints the detection source for each suggestion, warns when it had to fall back because signals were missing or conflicting, and first offers a one-confirmation "use the recommended setup" path before dropping into per-field prompts when you want to customize values. It writes `.prs/config.json`, preserves any existing `ai.provider` settings already present in that file, preserves an existing explicit `ai.issue.useCodexSuperpowers` value on reruns, treats legacy `ai.issueDraft.useCodexSuperpowers` as a backward-compatible input, ensures `.prs/` is gitignored, and only touches `AGENTS.md` when you explicitly opt in to a minimal scaffold for non-obvious repository guidance.

When Codex is available locally, setup also checks whether the Superpowers plugin is present under the active `CODEX_HOME` and reports whether Codex Superpowers-backed issue workflows were enabled or disabled. Setup does not install Codex plugins for you.

When `forge.type` is `github`, setup can also install the recommended pull-request workflows into the target repository:

- `.github/workflows/prs-pr-review.yml`
- `.github/workflows/prs-pr-assistant.yml`
- `.github/workflows/prs-test-suggestions.yml`

Those installed workflows reference `DevwareUK/prs/actions/...@main` and require a GitHub repository secret named `OPENAI_API_KEY`. Optional repository variables: `GIT_AI_OPENAI_MODEL` and `GIT_AI_OPENAI_BASE_URL`.

When you opt into the `AGENTS.md` scaffold, setup adds only placeholder prompts such as protected paths, generated files, deployment caveats, and domain rules. It intentionally does not copy repository config values like branch names or build commands into `AGENTS.md`.

The setup flow still expects you to create `.env` yourself because it cannot safely write secrets like `OPENAI_API_KEY`. It also calls out the recommended GitHub/OpenAI/Codex launch path and points advanced users to `bedrock-claude` and `claude-code` as customization paths rather than parity guarantees.

### `prs issue`

Usage:

```bash
prs issue <number> [--mode <interactive|unattended>]
prs issue batch <number> <number> [...number] [--mode unattended]
prs issue draft
prs issue refine <number>
prs issue plan <number> [--refresh]
prs issue prepare <number> [--mode <local|github-action>]
prs issue finalize <number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `prs issue <number>` | Full local issue-to-PR flow in interactive mode. Preflights the configured forge, verification command, and `baseBranch`, fetches the configured forge issue, creates a missing managed issue plan comment before writing the runtime snapshot, fast-forwards the configured base branch to `origin/<base-branch>`, creates the issue branch, writes `.prs/` workspace files, opens the configured interactive runtime, runs the configured build command after that runtime exits, generates a proposed commit message from the completed diff for review, and then either creates the commit plus an AI-authored PR title/body or leaves the branch uncommitted. Before runtime launch it prints the prepared branch and run artifact directory, reports when the runtime exits back to `prs`, and ends with a branch, commit, PR URL, manual-PR, or skipped-PR summary. Creating the pull request pushes the reviewed issue branch first. Generated PR bodies use a concise change narrative plus the issue-closing reference, while the managed PR assistant section carries reviewer-operational detail. |
| `prs issue <number> --mode unattended` | Full local issue-to-PR flow in unattended mode. Requires `ai.runtime.type` to be `codex`, creates a missing managed issue plan comment before writing the runtime snapshot, reuses the same per-issue branch and session state as interactive runs, launches Codex non-interactively, commits with the generated commit message automatically, pushes the issue branch through the pull-request creation path, and then opens the pull request without prompting. |
| `prs issue batch <number> <number> [...number]` | Sequential unattended issue queue. Defaults to `--mode unattended`, requires at least two unique issue numbers, runs each issue as its own independent unattended issue execution, creates a missing managed issue plan comment before each issue runtime snapshot is written, stores batch progress separately under `.prs/batches/`, and stops immediately at the first incomplete issue so reruns can resume from there. Each completed issue uses the same unattended issue-to-PR path, including pushing the branch before opening the pull request. |
| `prs issue draft` | Interactive issue drafting flow. Prompts for a rough idea, creates `.prs/` draft-run artifacts, launches the configured runtime so it can inspect the repository and ask targeted follow-up questions itself, expects the runtime to write the Markdown draft under `.prs/issues/`, previews the draft in the terminal, and lets you create it as-is, modify it in `$VISUAL`, `$EDITOR`, or `vim`, or keep it on disk without creating the issue. When `ai.issue.useCodexSuperpowers` is `true`, the launched runtime is Codex, and local Codex Superpowers is available, the generated Codex prompt explicitly uses the Superpowers brainstorming/planning discipline, keeps any intermediate Superpowers spec/plan artifacts in the current `.prs/runs/<timestamp>-issue-draft/` directory, and still stops after the single requested draft file. If the draft is created as a GitHub issue and `superpowers-plan.md` exists, prs creates or updates the managed issue plan comment from that artifact. |
| `prs issue refine <number>` | Interactive existing-issue refinement flow. Fetches the current issue body plus comments, resumes the saved runtime session when that session is still tracked locally, otherwise asks what should change and starts a fresh refinement run, writes resumable state to `.prs/issues/<number>/refine-session.json` plus run artifacts to `.prs/runs/<timestamp>-issue-refine-<number>/`, previews the refined Markdown in the terminal, and then either updates the existing GitHub issue when the source issue is already PRS-managed or creates a linked PRS-managed issue when the source issue was raised outside PRS. If GitHub authentication is unavailable, the refined draft is kept on disk instead of being applied. When `ai.issue.useCodexSuperpowers` is active, refine runs reserve `superpowers-spec.md` and `superpowers-plan.md` in the refine run directory and publish the plan artifact to the managed issue plan comment after an approved apply step when the artifact exists. |
| `prs issue plan <number> [--refresh]` | Secondary issue-execution support. By default it creates the managed implementation plan comment once and safely reuses the latest edited managed comment on later runs. Pass `--refresh` or `--update` to regenerate and update the managed comment when the issue context has changed. When `ai.issue.useCodexSuperpowers` is active, the selected runtime is Codex, and local Codex Superpowers is available, the command launches a plan-only Codex run and publishes the resulting `.prs/runs/<timestamp>-issue-plan-<number>/superpowers-plan.md` as the managed `<!-- prs:issue-plan -->` comment. If Superpowers is disabled, unavailable, or produces no plan artifact, `prs` falls back to the structured provider-generated plan. |
| `prs issue prepare <number>` | Preflights the configured forge, verification command, and `baseBranch`, creates a missing managed issue plan comment before writing the runtime snapshot, fast-forwards the configured base branch to `origin/<base-branch>`, prepares the issue branch and `.prs/` workspace artifacts, and then prints machine-readable JSON describing the run. |
| `prs issue prepare <number> --mode github-action` | Same preparation flow, including missing-plan creation, but writes prompt instructions tailored for non-interactive GitHub Actions runs. |
| `prs issue finalize <number>` | Generates a proposed commit message from the current repository diff, lets you preview, edit, or skip it, and creates the commit only after confirmation. It does not push or open a pull request. |

Important behavior:

- `prs issue draft`, `prs issue plan <number> [--refresh]`, `prs issue prepare <number>`, `prs issue finalize <number>`, and full `prs issue <number>` runs print an advanced workflow notice before execution
- `prs issue batch ...` prints a beta workflow notice before execution
- `prs issue` requires a clean working tree before it starts
- `prs issue <number>` and `prs issue prepare <number>` fail before checkout if the configured verification command cannot run from the repository root
- `prs issue <number>` and `prs issue prepare <number>` fail before checkout if the configured base branch is missing locally, missing on `origin`, or cannot be fast-forwarded cleanly
- `prs issue batch ...` requires at least two unique issue numbers
- `prs issue draft` previews the generated draft in the terminal and only opens `$VISUAL`, `$EDITOR`, or `vim` when you explicitly choose modify
- `prs issue draft` and `prs issue refine <number>` require an available interactive runtime CLI on `PATH`; if the configured non-default runtime is unavailable, `prs` falls back to `codex` when possible
- `prs issue <number>`, `prs issue <number> --mode unattended`, `prs issue prepare <number>`, and `prs issue batch ...` create a missing managed issue plan comment before the issue snapshot is written; if a managed plan comment already exists, the latest edited comment is used unchanged
- full local and unattended issue runs record their final branch, commit, and pull request outcome in the run `metadata.json` and print a final summary with the PR URL, manual PR commands, or the reason PR creation was skipped
- `ai.issue.useCodexSuperpowers` affects `prs issue draft`, `prs issue refine <number>`, and `prs issue plan <number>` and is ignored unless the launched or selected runtime is Codex; legacy `ai.issueDraft.useCodexSuperpowers` is still accepted when the broader setting is absent
- when `ai.issue.useCodexSuperpowers` is active, draft runs keep the final draft at `.prs/issues/issue-draft-<timestamp>.md` and record reserved Superpowers spec/plan artifact paths under `.prs/runs/<timestamp>-issue-draft/`
- when `ai.issue.useCodexSuperpowers` is active, refine runs keep the refined draft under `.prs/runs/<timestamp>-issue-refine-<number>/` and record reserved Superpowers spec/plan artifact paths in the same run directory
- when `ai.issue.useCodexSuperpowers` is active, plan runs reserve `superpowers-spec.md` and `superpowers-plan.md` under `.prs/runs/<timestamp>-issue-plan-<number>/` and publish the non-empty plan artifact to the managed issue plan comment
- if Superpowers-backed issue workflows are enabled but local Codex Superpowers is no longer available, `prs issue draft`, `prs issue refine <number>`, and `prs issue plan <number>` print a fallback notice and continue with the standard prompt or structured provider-generated plan
- `prs issue refine <number>` stores resumable state at `.prs/issues/<number>/refine-session.json` and keeps run-local prompt, metadata, log, and draft artifacts under `.prs/runs/<timestamp>-issue-refine-<number>/`
- `prs issue refine <number>` resumes a saved tracked runtime session only when the saved runtime still matches, the session is still tracked, and the saved run workspace still exists; otherwise it warns and starts a fresh refinement run
- `prs issue refine <number>` treats the issue body as the execution source of truth and uses issue comments as refinement context only
- approving a refined draft updates the source issue only when that issue is already PRS-managed; otherwise `prs issue refine <number>` creates a linked PRS-managed issue and leaves the original issue body untouched
- declining the apply step, or running without usable GitHub authentication, keeps the refined draft on disk and records the refine session as completed without applying it remotely
- after an approved Superpowers-backed draft or refinement, a non-empty `superpowers-plan.md` creates or updates the managed `<!-- prs:issue-plan -->` issue plan comment; missing or empty plan artifacts are logged and do not block issue creation or refinement
- `prs issue plan <number> [--refresh]` requires issue access through the configured forge; creating or refreshing a managed plan comment also requires the configured provider plus GitHub authentication
- `prs issue finalize <number>` requires local file changes plus a usable configured provider so it can draft the proposed commit message
- local full issue runs require an available interactive runtime CLI on `PATH`
- local full issue runs require the configured provider for commit and PR text generation
- full local issue runs execute the configured `buildCommand`, defaulting to `pnpm build`
- local full issue runs preview the proposed commit message and let you edit or skip it before committing
- local interactive runtime prompts end with an explicit done-state summary, a short note about how to see the result or what was verified, and plain-language next steps
- for local full issue runs, `prs` resumes the build, commit, and PR steps after you exit the runtime
- unattended issue runs require `ai.runtime.type` to be `codex`
- unattended single-issue and batch runs keep per-issue resume state in `.prs/issues/<number>/session.json`
- unattended batch runs reject `--mode interactive`
- unattended batch runs keep queue progress separately in `.prs/batches/` and skip issues already marked completed on later reruns of the same ordered batch
- issue preparation checks out the configured `baseBranch` and fast-forwards it to `origin/<base-branch>`, defaulting to `main` only when no repository config is present
- PR creation uses the configured `baseBranch`, defaulting to `main`
- GitHub-backed PR creation requires `gh` to be installed and authenticated
- GitHub-backed issue plan comments require `GH_TOKEN` or `GITHUB_TOKEN`, or an authenticated `gh` session, when they are created or refreshed
- if an issue resolution plan comment exists, `prs issue prepare <number>` and full `prs issue <number>` runs copy the latest edited plan into the generated issue snapshot
- when `forge.type` is `github`, issue fetching uses `gh issue view` when available, otherwise the GitHub API
- when `forge.type` is `github`, GitHub API access for issue fetching, plan comments, or issue creation uses `GH_TOKEN` or `GITHUB_TOKEN` when present
- when `forge.type` is `github`, `prs issue draft` can create issues and `prs issue refine <number>` can create linked issues or update PRS-managed issues with either `gh`, `GH_TOKEN`, or `GITHUB_TOKEN`
- when `forge.type` is `none`, issue and PR creation features are disabled for the repository

### `prs pr`

Usage:

```bash
prs pr prepare-review <pr-number>
prs pr fix-comments <pr-number>
prs pr fix-tests <pr-number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `prs pr prepare-review <pr-number>` | Fetches pull request metadata and linked issues, requires a clean working tree, preflights the configured verification command plus the live PR base branch on `origin`, checks out the best available local review branch for the PR, fetches the latest `origin/<base-branch>` tip, skips merging when the checked-out branch already contains that tip, otherwise merges the base branch into the review branch before brief generation, routes merge conflicts through an interactive Codex conflict-resolution session when needed, writes `.prs/` run artifacts, generates `review-brief.md`, prints the saved brief path plus a terminal preview, and then leaves you in an interactive Codex session on that branch for follow-up review questions or requested fixes. After that session exits, `prs` exits cleanly if there are no new reviewed commits to sync, or else runs the configured build command when there are follow-up file changes, offers the same reviewed commit-message flow used by the other local fix workflows, and pushes any new reviewed commits back to `origin/<pr-head-branch>`. |
| `prs pr fix-comments <pr-number>` | Requires a clean working tree, preflights the configured verification command, fetches pull request metadata and review comments from the configured forge, filters out obviously non-actionable comments, groups nearby threads into selectable review tasks, preserves non-trivial replies as thread context, writes richer `.prs/` run artifacts, opens the configured interactive runtime, runs the configured build command, previews a proposed commit message that you can edit, accept, or skip, and then pushes the reviewed commit back to `origin/<pr-head-branch>` when `HEAD` is ahead and not behind after fetching the latest remote head. |
| `prs pr fix-tests <pr-number>` | Requires a clean working tree, preflights the configured verification command, fetches pull request metadata and PR issue comments from the configured forge, finds the managed AI Test Suggestions comment, parses structured suggestion tasks including behavior, regression risk, protected paths, likely locations, edge cases, and implementation notes, writes focused `.prs/` run artifacts, opens the configured interactive runtime, runs the configured build command, previews a proposed commit message that you can edit, accept, or skip, and then pushes the reviewed commit back to `origin/<pr-head-branch>` when `HEAD` is ahead and not behind after fetching the latest remote head. |

Important behavior:

- `prs pr prepare-review <pr-number>` prints a beta workflow notice before execution
- `prs pr prepare-review <pr-number>` requires a clean working tree before it starts
- `prs pr fix-comments <pr-number>` requires a clean working tree before it starts
- `prs pr fix-tests <pr-number>` requires a clean working tree before it starts
- `prs pr prepare-review <pr-number>`, `prs pr fix-comments <pr-number>`, and `prs pr fix-tests <pr-number>` fail early when the configured verification command cannot run from the repository root
- `prs pr prepare-review <pr-number>` requires `codex` on `PATH`
- `prs pr prepare-review <pr-number>` validates that the live PR base branch still exists on `origin` before it checks out or fetches a review branch
- `prs pr prepare-review <pr-number>` reuses a linked issue branch when exactly one linked issue has saved local state and that branch still exists locally
- otherwise `prs pr prepare-review <pr-number>` checks out the local PR head branch when it already exists, or fetches the PR head into a dedicated `review/pr-<pr-number>-<slug>` branch
- after checkout, `prs pr prepare-review <pr-number>` fetches the latest `origin/<pr-base-branch>` tip and records whether the branch was already current or had to be merged with the latest base branch
- if that base-branch merge conflicts, `prs pr prepare-review <pr-number>` opens a focused Codex conflict-resolution session and only continues to review-brief generation after the merge is fully resolved
- `prs pr prepare-review <pr-number>` writes `prompt.md`, `metadata.json`, `output.log`, and `review-brief.md` under a timestamped `.prs/runs/` directory and may also write supporting workflow artifacts there
- after generating the brief, `prs pr prepare-review <pr-number>` drops you into an interactive Codex shell so you can ask follow-up questions or request fixes before exiting Codex
- after that interactive session exits, `prs pr prepare-review <pr-number>` skips build and commit review if there are no follow-up file changes, but still pushes any new reviewed commits created by the workflow, such as a base-sync merge
- if the follow-up session changed files, `prs pr prepare-review <pr-number>` runs the configured build command, previews a proposed commit message that you can accept, edit, or skip, and then pushes the resulting reviewed branch state back to the PR head branch when it is ahead of `origin/<pr-head-branch>`
- when a linked issue has a live saved Codex session, `prs pr prepare-review <pr-number>` reuses it for brief generation and the follow-up interactive session; stale sessions are warned about and fall back to a fresh run
- local PR comment-fix runs require the configured runtime CLI on `PATH`
- local PR test-fix runs require the configured runtime CLI on `PATH`
- PR comment-fix and test-fix runs execute the configured `buildCommand`, defaulting to `pnpm build`
- after an accepted reviewed commit, `prs pr fix-comments <pr-number>` and `prs pr fix-tests <pr-number>` fetch `origin/<pr-head-branch>` and only push when `HEAD` is ahead and not behind; if the branch diverged or the remote head cannot be resolved, the command fails clearly and keeps the local commit
- if you decline the reviewed commit message, `prs pr fix-comments <pr-number>` and `prs pr fix-tests <pr-number>` leave the changes uncommitted and do not attempt a push
- local interactive runtime prompts end with an explicit done-state summary, a short note about how to see the result or what was verified, and plain-language next steps
- the command expects the relevant PR branch to already be checked out locally before the runtime starts editing
- the interactive selector accepts numbered thread choices and, when available, grouped task choices like `g1`; `all` still selects every individual thread
- `prs pr fix-tests <pr-number>` accepts `all`, `none`, or a comma-separated suggestion list like `1,2`
- managed AI test suggestions now carry behavior covered, regression risk, suggested test type, protected paths, suggestion-level edge cases, and a short implementation note so the selected snapshot can be used directly as implementation guidance
- when `forge.type` is `github`, PR fetching uses `gh pr view` when available, otherwise the GitHub API
- when `forge.type` is `github`, GitHub API access for PR metadata, review comments, and PR issue comments uses `GH_TOKEN` or `GITHUB_TOKEN` when present
- when `forge.type` is `none`, pull request workflows are disabled for the repository

### `prs review`

Usage:

```bash
prs review [--base <git-ref>] [--head <git-ref>] [--format <markdown|json>]
              [--issue-number <number>]
```

Flags:

| Flag | What it does |
| --- | --- |
| `--base <git-ref>` | Reviews the diff from `<git-ref>...HEAD` by default, or `<git-ref>...<head>` when `--head` is also provided. Without `--base`, `prs review` uses `git diff HEAD`. |
| `--head <git-ref>` | Optional comparison head revision. Requires `--base`. |
| `--format markdown` | Prints a readable Markdown pre-review signal for a human reviewer, capped to the strongest reviewer-ready risks. This is the default. |
| `--format json` | Prints the structured review payload, including higher-level findings and line-linked comments, with the combined risk set trimmed to the strongest few items. |
| `--issue-number <number>` | Fetches the linked issue from the configured forge and includes it as review context. |

Examples:

```bash
prs review
prs review --base origin/main
prs review --base origin/main --head HEAD --format json
GITHUB_TOKEN=... prs review --issue-number 50
```

Important behavior:

- `prs review` requires the configured provider to be usable; with the default configuration that means `OPENAI_API_KEY`
- without `--base`, it reviews the current `git diff HEAD`
- with `--issue-number`, the CLI fetches the issue title and body from the configured forge and grounds the review in that context
- markdown output is optimized as a compact pre-review checklist that highlights only the top 3 to 5 reviewer-ready risks when the diff supports that many, and fewer when the diff is low risk
- JSON output keeps the same `summary` / `findings` / `comments` structure for automation, with severity, confidence, affected file, why-this-matters context, optional suggested fixes, and right-side line numbers taken from the diff

### `prs test-backlog`

Usage:

```bash
prs test-backlog [--format <markdown|json>] [--top <count>]
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
prs test-backlog
prs test-backlog --format json --top 5
GITHUB_TOKEN=... prs test-backlog --create-issues --max-issues 3
prs test-backlog --label testing --label backlog
prs test-backlog --labels testing,backlog
```

Important behavior:

- when `--create-issues` is enabled, `prs` checks for matching open issue titles first so it can reuse existing backlog items instead of creating duplicates
- if `forge.type` is `none`, backlog issue creation is disabled for that repository

### `prs feature-backlog`

Usage:

```bash
prs feature-backlog [repo-path] [--format <markdown|json>] [--top <count>]
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
prs feature-backlog
prs feature-backlog ../other-repo --top 3
GITHUB_TOKEN=... prs feature-backlog . --create-issues --label product
prs feature-backlog . --format json
```

Important behavior:

- `prs feature-backlog` prints a beta workflow notice before execution
- the repository analysis is heuristic and based on the repository structure, current product surface, and automation signals
- with the default GitHub forge integration, `--create-issues` requires `GH_TOKEN` or `GITHUB_TOKEN`
- feature backlog issue creation uses the analyzed repository's configured forge, so the required credentials follow that forge's issue-creation path
- with the default GitHub forge integration, issue creation targets the analyzed repository's `origin` remote, not just the current working directory
- before each issue is created, `prs` prompts for the final title, optional extra description, and labels
- if an open GitHub issue already exists with the chosen title, `prs` reuses it instead of creating a duplicate
- if `forge.type` is `none`, feature backlog issue creation is disabled for that repository

## Developing `prs`

This section is for contributors working on this monorepo rather than users running the CLI in another repository.

### Monorepo layout

| Path | Responsibility |
| --- | --- |
| `packages/cli` | The `prs` CLI entrypoint, argument parsing, repository config loading, forge integration, and local issue workflow orchestration. |
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
| `pnpm cli:commit` | Builds the CLI package and runs `prs commit`. |
| `pnpm cli:diff` | Builds the CLI package and runs `prs diff`. |
| `pnpm cli:feature-backlog -- <args>` | Builds the CLI package and runs `prs feature-backlog <args>`. |
| `pnpm cli:issue -- <args>` | Builds the CLI package and runs `prs issue <args>`. |
| `pnpm cli:review -- <args>` | Builds the CLI package and runs `prs review <args>`. |
| `pnpm cli:test-backlog -- <args>` | Builds the CLI package and runs `prs test-backlog <args>`. |

### Package-level commands

Use these when working on an individual workspace directly.

| Package | Command | What it does |
| --- | --- | --- |
| `packages/cli` | `pnpm --filter @prs/cli build` | Builds the `prs` CLI into `packages/cli/dist`. |
| `packages/cli` | `pnpm --filter @prs/cli commit` | Builds the CLI package and runs `node dist/index.js commit`. |
| `packages/cli` | `pnpm --filter @prs/cli diff` | Builds the CLI package and runs `node dist/index.js diff`. |
| `packages/cli` | `pnpm --filter @prs/cli feature-backlog -- <args>` | Builds the CLI package and runs `node dist/index.js feature-backlog <args>`. |
| `packages/cli` | `pnpm --filter @prs/cli issue -- <args>` | Builds the CLI package and runs `node dist/index.js <args>`. Use this when testing CLI issue flows directly. |
| `packages/cli` | `pnpm --filter @prs/cli review -- <args>` | Builds the CLI package and runs `node dist/index.js review <args>`. |
| `packages/core` | `pnpm --filter @prs/core build` | Builds the shared core library. |
| `packages/contracts` | `pnpm --filter @prs/contracts build` | Builds the shared contract and schema package. |
| `packages/providers` | `pnpm --filter @prs/providers build` | Builds the provider integrations package. |
| `actions/pr-assistant` | `pnpm --filter @prs/pr-assistant-action build` | Builds the PR assistant GitHub Action bundle. |
| `actions/pr-review` | `pnpm --filter @prs/pr-review-action build` | Builds the PR review GitHub Action bundle. |
| `actions/test-suggestions` | `pnpm --filter @prs/test-suggestions-action build` | Builds the test suggestions GitHub Action bundle. |

### GitHub Action local entrypoints

These actions are bundled for GitHub Actions, but you can also run them locally after building the workspace.

#### PR review action

Build:

```bash
pnpm build
```

Run locally:

```bash
git diff --unified=3 -- . ':!pnpm-lock.yaml' > /tmp/prs-pr-review.diff

INPUT_DIFF_FILE="/tmp/prs-pr-review.diff" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Closes #50" \
INPUT_ISSUE_NUMBER="50" \
INPUT_ISSUE_TITLE="Implement AI-Powered Pull Request Review Functionality" \
INPUT_ISSUE_BODY="Create a function that utilizes AI to review pull requests line by line." \
INPUT_ISSUE_URL="https://github.com/DevwareUK/prs/issues/50" \
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
git diff -- . ':!pnpm-lock.yaml' > /tmp/prs-pr-assistant.diff
git log --reverse --format='%s%n%b%n---' HEAD~3..HEAD > /tmp/prs-pr-assistant-commits.txt

INPUT_DIFF_FILE="/tmp/prs-pr-assistant.diff" \
INPUT_COMMIT_MESSAGES_FILE="/tmp/prs-pr-assistant-commits.txt" \
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
git diff -- . ':!pnpm-lock.yaml' > /tmp/prs-test-suggestions.diff

INPUT_DIFF_FILE="/tmp/prs-test-suggestions.diff" \
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

All three pull-request-triggered AI workflows generate their diff input through the built CLI helper and hand it to the local action through a temporary file, so `.prs/config.json` `aiContext.excludePaths` is honored in pull request automation without hitting GitHub Actions argument-length limits.
