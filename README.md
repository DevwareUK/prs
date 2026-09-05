# prs

`prs` is a small, deterministic toolkit that lets an active coding agent coordinate work through GitHub issues and pull requests.

The agent does the reasoning and implementation. `prs` provides the repeatable local operations around it: loading issue context, publishing approved artifacts, preparing a branch, validating a pull request, and publishing an audit trail.

The repository does not execute a model, require an AI-provider API key, or distribute GitHub Actions. Codex, Claude Code, and GitHub Copilot can all call the same local JSON tools. GitHub is the supported forge.

## Install

Prerequisites:

- Node.js 20 or later
- pnpm 10.7
- Git
- GitHub CLI (`gh`), authenticated for GitHub-backed commands; local setup and disabled-forge workflows can run without it

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

Setup writes `.prs/config.json` and `.prs/.gitignore`, then installs the canonical skills for the selected host or all hosts. Run `prs setup` in a terminal without `--skills` to choose personal skills and a GitHub account. An empty skills answer skips installation. Setup lists saved GitHub accounts plus “Use the default account”, writes an explicit account choice to ignored `.prs/config.local.json`, and preserves an existing choice unless you change it. Supplying `--skills`, or running without interactive input, skips account selection and preserves local settings. If an older configuration contains `ai` or `githubActions`, setup preserves supported settings, removes those retired sections, and prints a migration notice.

## Agent skills

The canonical, host-neutral skill pack lives under `skills/` and is indexed by `skills/manifest.json`:

- `prs` routes requests to the appropriate workflow;
- `prs-create` drafts and creates approved issues or issue sets;
- `prs-issue` carries one issue from context through implementation and validation;
- `prs-finish` verifies completed work and prepares its pull request and audit trail;
- `prs-pr` prepares an existing PR in the main checkout and handles requested review, conflicts, comment fixes and failing-test repairs;
- `prs-orchestrate` coordinates a dependency-aware issue set as separate pull requests.

These are the shared workflow bodies for Codex, Claude Code, and GitHub Copilot. Host installers place them in supported personal directories without rewriting their instructions.

For Codex, `prs skills install codex` installs the pack under `~/.agents/skills`. Re-running it safely updates unchanged PRS-managed copies, preserves customized or colliding files, and moves marked legacy copies under `~/.codex/skills` (including colon-named aliases such as `prs:pr`) to recoverable `.prs-retired` files. See [the Codex guide](docs/codex.md).

For Claude Code, `prs skills install claude-code` installs the same files under `~/.claude/skills`. See [the Claude Code guide](docs/claude-code.md).

For GitHub Copilot, `prs skills install copilot` shares the Codex installation under `~/.agents/skills` without duplicating managed files. See [the Copilot guide](docs/github-copilot.md).

`prs skills install all` installs for all three hosts, just like `prs setup --skills all`. On macOS, interactive `prs skills install copilot` / `all`, and interactive `prs setup` when you choose `copilot` / `all`, offer local usage tracking for the Copilot app once it is not already configured. Accepting adds user login settings for a private local export with content capture disabled; fully quit and reopen Copilot from the Dock normally. This also affects Copilot CLI and other subsequently launched processes that honor those environment variables. Skill installation alone does not enable telemetry. Scripted/JSON installs and setup with explicit `--skills` never prompt: opt in with `--copilot-telemetry enable`, leave settings alone with `skip`, or remove PRS's configuration with `disable`. See [setup details and limitations](docs/github-copilot.md#optional-macos-app-usage-tracking).

Copilot telemetry setup treats empty macOS launch-environment values as unset; conflicting nonempty settings are preserved and stop setup.

`prs skills validate --json` installs each host pack in an isolated temporary home and checks its inventory, hashes, retained operation references, and the named `artifact-locality` and `staged-only-finalization` instructions. It also requires the `prs-pr` skill, its router entry and non-empty sections for all four PR actions, even if every host installs the same incomplete pack. It independently checks the create and refine specification, plan, publication and completion instructions, including refinement on the original issue and its stopping boundary. These are static checks: they do not launch a native host runtime. Native behavioral evidence is a separate manual smoke matrix with one independently attributed row for each host; see [the agent parity guide](docs/agent-parity.md).

All generated workflow artifacts use `.prs/runs/<task-specific-run>/` as their only repository-local root. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`. This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. These raw files remain local: never stage or commit them, and never create an alternative scratch root such as `.prs-work`.

## Workflow

For `prs-create`, the active agent uses Superpowers brainstorming to write a specification, shows it and waits for approval. It then uses Superpowers writing-plans to write the implementation plan, shows it and waits for approval. Both files are required even for bounded work and stay under `.prs/runs`; the PRS locality rules override Superpowers document-path and commit defaults. Missing required skills block the workflow with a next action.

After presenting the issue draft or linked set and both reviewed artifacts, the agent obtains explicit authorization for issue creation and publication of both managed comments. Design approval alone does not authorize the GitHub write; a reply that asks a question or changes scope needs revised artifacts and explicit approval. The creation step uses both files:

```bash
prs tool issue create --draft-file .prs/runs/<run>/issue.md --spec-file .prs/runs/<run>/spec.md --plan-file .prs/runs/<run>/plan.md --json
prs tool issue create --issue-set .prs/runs/<run>/issue-set.json --run-dir .prs/runs/<run> --spec-file .prs/runs/<run>/spec.md --plan-file .prs/runs/<run>/plan.md --json
```

For a linked set, the approved shared specification and plan map requirements, tasks and dependencies to every stable issue ID and are published on every created or reused issue. Creation is complete only after both managed comments are verified and their URLs reported. A successful issue creation with missing artifact hints remains incomplete. Recover partial publication against the known issue number with `prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json` within authorization for those exact files and targets; then confirm live context and content with `prs tool issue context <number> --json`.

To refine an existing issue, use `prs-issue` with a refine request. It reads live issue context, follows the same specification, plan and publication approval gates, and publishes or updates both comments on that original issue. It preserves the issue number, URL and request body and creates no replacement issues. A refine-only request stops after verified publication.

When implementation is requested (including a `prs-issue` request with `--jdi`, `--auto` or `--unattended`), the agent reuses approved, unchanged artifacts, prepares context with `prs tool issue ready`, and works in an isolated branch or worktree. Implementation authorization does not waive artifact approval gates. It stages intended changes, inspects `git diff --cached --name-status`, and uses `prs issue finalize` to preview and create a deterministic commit after confirmation. It then opens or updates the PR and publishes reviewed audit evidence only after explicit approval.

For an existing pull request, use `prs-pr`. It locates the main checkout used by your local application and runs `prs tool pr ready` there to check out the actual head branch, synchronize the PR base, run configured local-readiness commands, and return GitHub checks and review-comment context. With no PR selected, it lists actionable PRs with links. With no follow-up action requested, it prepares local testing and offers relevant next steps.

The skill accepts `review`, `resolve-conflicts`, `address-comments` (including requests to resolve comments), and `fix-tests`. These are active-agent actions, not additional CLI subcommands. Review preparation and approved publication, deliberate commits, guarded pushes and fresh hosted checks remain part of the workflow; PRs need no linked issue. `fix-tests` repairs observed failures.

For example, ask: "Use prs-pr to prepare PR 88 for local testing", then "Use prs-pr to address comments on PR 88". See the host guides for native invocation syntax. Readiness flags such as `--jdi` apply only to preparation and configured runtime startup; they do not authorize review publication, fixes, pushes or merging.

## Commands

The implemented command surface is:

```text
prs setup [--skills <none|codex|claude-code|copilot|all>] [--copilot-telemetry <enable|disable|skip>]
prs skills install <codex|claude-code|copilot|all> [--json] [--copilot-telemetry <enable|disable|skip>]
prs skills validate [--json]

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
prs tool token-usage render --file <path> --output <path> --json
prs tool token-usage capture --host <codex|claude-code|copilot> --output <path> [--session <id>] [--source <path>] [--since <ISO>] --json
```

`prs issue finalize` does not stage files for you. It previews the deterministic commit message and exact staged paths, refuses an empty index, and commits only changes already in the index, leaving unstaged and untracked files untouched.

Remote mutations—creating issues and publishing managed comments or audits—must be approved by the user before the active agent invokes them. Read-only context commands need no approval. `prs tool pr ready` changes the local checkout and may merge the latest base branch, but it does not push or merge a pull request.

## Local usage and cost evidence

`prs tool token-usage render` validates version-1 local evidence from Codex, Claude Code, or Copilot and writes a publication-safe Markdown report. Both files must stay in the same `.prs/runs/<runId>/` directory. It needs no GitHub authentication, provider connection, or model calls. Publish the reviewed report separately with `prs audit publish ... --section token-usage` after approval.

`prs tool token-usage capture` creates that evidence directly from a selected native session or local telemetry export. Start it when the task's run directory exists, then repeat with the same output before reporting; its original session/source/start boundary is retained. The first call starts at now unless you provide a known task-start `--since` timestamp. Codex can use `CODEX_THREAD_ID`; Claude Code needs its session ID and transcript path; Copilot needs its session ID and a telemetry file exported before capture. Missing setup is reported as unavailable, not zero. Capture makes no model calls and installs no hooks. These are selected-session checkpoints, not guaranteed full-task/subagent totals. See [native setup and supported formats](docs/usage-evidence.md#native-capture) before testing on real issues.

Cumulative snapshots are differenced, never added as independent phase totals. Missing baselines, uncertain parent/child overlap, and unavailable captures remain visibly incomplete. Codex goal counters are host counters—not raw model tokens. Credits, provider charges, and estimates remain separate. Estimates require supplied, sourced model/context-specific rate snapshots; unknown models are unpriced and expired promotions cannot silently price later work. See [usage evidence and examples](docs/usage-evidence.md) for the contract, native mappings, legacy handling, and limitations. Synthetic tests and static skill parity do not claim live host validation.

## Repository configuration

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

For a personal account choice, run `gh auth login --hostname github.com` for each account and then interactive `prs setup`. You can also edit the ignored `.prs/config.local.json` after running setup:

```json
{
  "forge": { "githubAccount": "your-work-username" }
}
```

The configured account applies to every GitHub operation performed by `prs` and takes precedence over inherited token variables. Missing saved credentials produce a login error; account selection never changes the globally active account. Without a local account choice, `gh` uses its normal authentication, including `GH_TOKEN`/`GITHUB_TOKEN` for automation. GitHub CLI is required even when a token is supplied; `prs` no longer makes direct GitHub HTTP requests. A linked worktree has its own local account file. See [setup configuration](docs/setup-configuration.md) for reruns and non-interactive behavior.

See [the CLI reference](docs/cli-reference.md), [setup configuration](docs/setup-configuration.md), [agent parity guide](docs/agent-parity.md), [migration guide](docs/migration.md), and [development guide](docs/development.md).

## Development

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test:parity
pnpm test
```

The focused parity command validates the identical Codex, Claude Code, and GitHub Copilot skill installations plus the lifecycle evidence contract. The sole repository workflow, `.github/workflows/test.yml`, runs all of these checks for pull requests. It is repository CI, not a distributed `prs` action.
