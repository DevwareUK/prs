# Setup and Configuration

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

`prs setup` also installs or refreshes managed Codex `/prs` skills. After upgrading the CLI, run `prs update skills` or `prs setup --update-skills` to refresh only those managed skills without changing repository setup.

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
prs pr fix-failing-tests 88
prs pr fix-tests 88
```

The matching GitHub automation surfaces are `actions/pr-review`, `actions/pr-assistant`, and `actions/test-suggestions`.

You only need extra tooling for advanced or deeper local workflows:

- an available interactive runtime CLI on `PATH` for `prs issue draft`, `prs issue refine <number>`, and local interactive `prs issue <number>` runs
  default: `codex`
  `ai.runtime.type: "claude-code"`: `claude`
  if the configured non-default runtime is unavailable, `prs` falls back to `codex` when it is installed
- `codex` on `PATH` for `prs codex pr prepare-review <pr-number>`, which checks out a reviewer workspace, syncs it with the latest PR base branch, resolves merge conflicts in Codex when needed, generates the review brief, leaves you in an interactive Codex session for follow-up questions or fixes, offers the same reviewed commit-message flow as other local fix workflows when that session makes changes, and pushes any new reviewed commits back to the PR head branch before exiting
- `codex` on `PATH` for `prs pr resolve-conflicts <pr-number>`, which checks out the PR head branch, syncs it with the latest PR base branch, opens a focused Codex session only when merge conflicts need local resolution, verifies the completed merge with the configured build command, writes `.prs/` run artifacts, and pushes the synced branch back to the PR head branch through the guarded push flow
- `codex` plus authenticated GitHub access for `prs issue <number> --mode unattended`, `prs issue <number> <number> ...`, and `prs issue batch ...`
- authenticated `gh`, `GH_TOKEN`, or `GITHUB_TOKEN` for GitHub-backed issue and pull request flows

`prs` resolves the active repository from your current Git working tree at runtime. It loads `.env` and `.prs/config.json` from that repository root, not from the CLI build location. If a repository has not been migrated yet, `prs` falls back to legacy `.git-ai/` config and workflow state when no `.prs/` equivalent exists.

### Runtime and provider asymmetry

The launch path is not presented as full runtime or provider parity:

- GitHub Actions in this repository are OpenAI-only today. They do not expose Bedrock Claude or runtime-selection inputs.
- `prs codex pr prepare-review <pr-number>` always requires `codex` on `PATH` and keeps its merge-conflict and review-brief flow Codex-specific.
- `prs pr resolve-conflicts <pr-number>` always requires `codex` on `PATH` for guided merge-conflict resolution, even though it only opens Codex when the base merge conflicts.
- `prs issue <number> --mode unattended`, multi-issue `prs issue <number> <number> ...`, and `prs issue batch ...` require `ai.runtime.type` to be `codex`.
- Interactive local workflows such as `prs issue draft`, `prs issue refine <number>`, and `prs issue <number>` use the configured runtime, with fallback to Codex when a configured non-default runtime is unavailable. PR fix commands prepare artifacts for the active session and do not launch a runtime.
- Structured-text workflows such as `prs commit`, `prs diff`, `prs review`, and issue-plan / PR-text generation use the configured provider, defaulting to OpenAI and allowing `bedrock-claude` as an advanced option.

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
    "type": "github",
    "githubCliPath": "/opt/homebrew/bin/gh"
  }
}
```

Recommended first configuration: leave `ai.provider.type` unset so it defaults to `openai`, leave `ai.runtime.type` unset so it defaults to `codex`, and use `forge.type: "github"` for GitHub-backed issue and PR flows. Change provider or runtime settings only when you need a deeper customization path. `forge.githubCliPath` is optional; use it only when the authenticated GitHub CLI lives outside the PATH used by `prs`.

Supported fields:

- `ai.runtime.type`: interactive runtime used by `prs issue draft`, `prs issue refine <number>`, and local `prs issue <number>`. PR fix commands prepare artifacts for the active session and do not use this runtime setting. Supported values: `"codex"` and `"claude-code"`. Default: `"codex"`.
- `ai.issue.useCodexSuperpowers`: repository default for Superpowers-backed issue draft, refine, and plan workflows. When `true`, `prs issue draft`, `prs issue refine <number>`, and `prs issue plan <number>` use Codex Superpowers-specific instructions if the launched or selected runtime is Codex and Superpowers is available in the current Codex installation. Final single issue drafts still use the normal `.prs/issues/` or refine-run draft paths, optional multi-issue draft sets use run-local draft files plus `issue-set.json`, and intermediate Superpowers spec and plan artifacts stay inside the current `.prs/runs/<timestamp>-issue-draft/`, `.prs/runs/<timestamp>-issue-refine-<number>/`, or `.prs/runs/<timestamp>-issue-plan-<number>/` directory. `prs setup` detects local Codex Superpowers availability and writes this preferred flag automatically. Default: `false`.
- `ai.issueDraft.useCodexSuperpowers`: backward-compatible legacy input for repositories that already configured Superpowers-backed issue drafting. `ai.issue.useCodexSuperpowers` takes precedence when both settings are present.
- `ai.provider.type`: structured text provider used by `prs commit`, `prs diff`, `prs review`, `prs issue plan <number> [--refresh]`, and commit/PR generation inside `prs issue <number>` and `prs issue finalize <number>`. Supported values: `"openai"` and `"bedrock-claude"`. Default: `"openai"`.
- `ai.provider.model`: optional for `"openai"`, required for `"bedrock-claude"`.
- `ai.provider.baseUrl`: optional override for `"openai"`.
- `ai.provider.region`: optional explicit AWS region for `"bedrock-claude"`. Falls back to `AWS_REGION` or `AWS_DEFAULT_REGION`.
- `aiContext.excludePaths`: repository-relative glob patterns excluded from AI diff and repository context. These exclusions apply across `prs commit`, `prs diff`, `prs review`, issue-to-PR flows, and repository backlog scans. Bare filename globs like `*.map` match by basename anywhere in the repository. Defaults: `["**/node_modules/**", "**/vendor/**", "**/dist/**", "**/build/**", "*.map"]`.
- `baseBranch`: base branch used by `prs issue <number>` and `prs issue prepare <number>` when switching, syncing from `origin`, and opening pull requests. If unset, the resolved default is `main`, but `prs setup` first tries the remote default branch and then prints an explicit fallback warning when it has to guess.
- `buildCommand`: command run after the interactive runtime exits during full local `prs issue <number>` flows and after a clean or Codex-resolved merge during `prs pr resolve-conflicts <pr-number>`. PR comment-fix and test-fix preparation commands preflight this command without running final verification; `prs pr fix-failing-tests <pr-number>` runs it once to capture the initial failure and exits without a run directory if it already passes. If unset, the resolved default is `["pnpm", "build"]`, but `prs setup` first tries repository-local `verify`, `build`, or `test` commands from `package.json`, `composer.json`, or PHPUnit signals and warns before falling back.
- `forge.type`: forge integration. Use `"github"` for GitHub-backed issue and PR flows or `"none"` to disable forge-backed issue and PR features for the repository.
- `forge.githubCliPath`: optional path to the authenticated `gh` executable that prs should use for local GitHub operations when environment tokens are not set. PRS resolves auth in this order: `GH_TOKEN`, `GITHUB_TOKEN`, `PRS_GH_PATH` or `PRS_GITHUB_CLI_PATH`, `forge.githubCliPath`, `gh` on PATH, then common local install paths such as `/opt/homebrew/bin/gh` and `/usr/local/bin/gh`. CI and headless environments can keep using `GH_TOKEN` or `GITHUB_TOKEN`; normal local Codex shells can rely on authenticated `gh` without adding project-specific token values to `.env`.

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

- `.prs/batches/`: persistent multi-issue run state for `prs issue <number> <number> ...` and the `prs issue batch ...` compatibility alias
- `.prs/issues/`: issue snapshots and generated drafts
- `.prs/runs/`: run prompts, metadata, logs, and run-local supporting artifacts such as optional issue-set manifests plus Superpowers issue draft/refine spec and plan files
