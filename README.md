# prs

`prs` is a small, deterministic toolkit that lets an active coding agent coordinate work through GitHub issues and pull requests.

The agent does the reasoning and implementation. `prs` provides the repeatable local operations around it: loading issue context, publishing approved artifacts, preparing a branch, validating a pull request, and publishing an audit trail.

The repository does not execute a model, require an AI-provider API key, or distribute GitHub Actions. Codex, Claude Code, and GitHub Copilot can all call the same local JSON tools. Issue tracking and repository collaboration use separate integrations. The issue tracker can be GitHub or Monday and owns issues, hierarchy and issue artifacts; the GitHub forge owns pull requests, reviews and checks. Project configuration selects the tracker independently.

## Install

Prerequisites:

- Node.js 20 or later
- pnpm 10.7
- Git
- GitHub CLI (`gh`), authenticated for GitHub-backed commands; local setup and workflows with both integrations disabled can run without it

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

`prs skills install all` installs for all three hosts, just like `prs setup --skills all`. On macOS, interactive `prs skills install copilot` / `all`, and interactive `prs setup` when you choose `copilot` / `all`, offer local usage tracking for the Copilot app once it is not already configured. Accepting adds user login settings for a private local export plus a private `preToolUse` hook that records only a short-lived repository/session binding; content capture remains disabled. Fully quit and reopen Copilot from the Dock normally. This also affects Copilot CLI and other subsequently launched processes that honor those environment variables and personal hooks. Skill installation alone does not enable telemetry. Scripted/JSON installs and setup with explicit `--skills` never prompt: opt in with `--copilot-telemetry enable`, leave settings alone with `skip`, or remove PRS's configuration with `disable`. See [setup details and limitations](docs/github-copilot.md#optional-macos-app-usage-tracking).

Copilot telemetry setup treats empty macOS launch-environment values as unset; conflicting nonempty settings are preserved and stop setup.

`prs skills validate --json` installs each host pack in an isolated temporary home and checks its inventory, hashes, retained operation references, and the named `artifact-locality` and `staged-only-finalization` instructions. It also requires the `prs-pr` skill, its router entry and non-empty sections for all four PR actions, even if every host installs the same incomplete pack. It independently checks create and refine artifact preparation, unified approval and completion instructions, including refinement on the original issue and its stopping boundary, and rejects contradictory staged approval gates or pre-approval remote writes. It also checks the JDI completion-audit authorization and its handoffs without weakening interactive or create/refine approval. These are static checks: they do not launch a native host runtime. Native behavioral evidence is a separate manual smoke matrix with one independently attributed row for each host; see [the agent parity guide](docs/agent-parity.md).

All generated workflow artifacts use `.prs/runs/<task-specific-run>/` as their only repository-local root. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`. This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. These raw files remain local: never stage or commit them, and never create an alternative scratch root such as `.prs-work`.

## Workflow

For `prs-create`, the active agent uses Superpowers brainstorming to settle requirements and write and self-review each specification. It then uses Superpowers writing-plans to write and self-review each implementation plan and prepares the exact issue draft or linked set, without pausing for intermediate artifact approvals. Both files are required even for bounded work and stay under `.prs/runs`; the PRS locality rules override Superpowers document-path and commit defaults. Missing required skills block the workflow with a next action.

The agent presents the exact issue draft or linked set, every issue-specific specification and plan, dependency links, and intended native hierarchy together as one complete packet. One explicit approval accepts every artifact and authorizes creating or reusing those displayed issues, publishing both managed comments per issue, and applying the displayed hierarchy. Design approval alone does not authorize the GitHub write. A reply that asks a question, qualifies approval or changes scope, content or targets is not approval: the agent updates every affected artifact and relationship, presents the complete revised packet and asks for one fresh approval. Single-issue creation passes both files directly. Linked creation reads one `specFile` and `planFile` per issue from a version-2 manifest:

```bash
prs tool issue create --draft-file .prs/runs/<run>/issue.md --spec-file .prs/runs/<run>/spec.md --plan-file .prs/runs/<run>/plan.md --json
prs tool issue create --issue-set .prs/runs/<run>/issue-set.json --run-dir .prs/runs/<run> --json
```

For a linked set, every issue owns its approved specification and plan. Parent mode names a designated orchestrator and explicit `parentId` values; PRS creates native GitHub sub-issue relationships after resolving real database IDs. Dependency edges remain separate. Flat mode records why no parent is required and performs no hierarchy mutation. Creation is complete only when both managed comments per issue and every requested native relationship are verified. Partial runs retain `issue-set-receipt.json`; retry the same approved linked command to reconcile known issues, comments and links without force-reparenting. Version-1 linked manifests fail preflight with upgrade guidance. Single-issue comment recovery still uses `prs tool issue publish-artifacts`.

```json
{
  "version": 2,
  "mode": "multiple",
  "orchestration": { "mode": "parent", "orchestratorId": "delivery" },
  "issues": [
    {
      "id": "delivery",
      "issueNumber": 123,
      "draftFile": ".prs/runs/<run>/delivery.md",
      "specFile": ".prs/runs/<run>/delivery-spec.md",
      "planFile": ".prs/runs/<run>/delivery-plan.md",
      "dependsOn": [], "blocks": [], "related": []
    },
    {
      "id": "contract",
      "parentId": "delivery",
      "draftFile": ".prs/runs/<run>/contract.md",
      "specFile": ".prs/runs/<run>/contract-spec.md",
      "planFile": ".prs/runs/<run>/contract-plan.md",
      "dependsOn": [], "blocks": [], "related": []
    }
  ]
}
```

Omit `issueNumber` to create an issue. A flat manifest uses `"orchestration": { "mode": "flat", "reason": "Independent tasks" }` and omits `parentId`.

To refine an existing issue, use `prs-issue` with a refine request. It reads live issue context, prepares and self-reviews both artifacts without intermediate approval, then presents them with the original issue target for the same single approval before publishing or updating both comments. It preserves the issue number, URL and request body and creates no replacement issues. A refine-only request stops after verified publication.

When implementation is requested (including a `prs-issue` request with `--jdi`, `--auto` or `--unattended`), the agent reuses approved, unchanged artifacts, prepares context with `prs tool issue ready`, and works in an isolated branch or worktree. When both managed artifacts are present, readiness uses the issue tracker to add the PRS-selected GitHub account to the issue's assignees and set an existing organization issue field `Status` to its `In Progress` option. It preserves other assignees and fields, reports each outcome in JSON and local metadata, and keeps local readiness available if an update cannot be made. If either managed artifact is missing, it skips both GitHub updates. The organization must have that field and option for the status update; GitHub's Project Status and labels are not changed. Because readiness now writes to GitHub, call it only when starting implementation is authorized. Implementation authorization does not waive the unified artifact approval gate. It stages intended changes, inspects `git diff --cached --name-status`, and uses `prs issue finalize` to preview and create a deterministic commit after confirmation. It then opens or updates the PR. An explicit JDI issue-implementation request is upfront authorization to publish routine completion and token-usage audits to that issue and its resulting PR, carried through `prs-finish` and `prs-pr` without another prompt. The agent still writes and reviews the reports, verifies results and targets, and keeps raw evidence private. Interactive runs without that authorization show the reports and wait for publication approval.

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
prs tool issue create --draft-file <path> [--spec-file <path>] [--plan-file <path>]
                      [--media-manifest <path>] [--label <name>] [--labels <a,b>] [--force-prs-managed] --json
prs tool issue create --issue-set <path> [--run-dir <path>]
                      [--label <name>] [--labels <a,b>] [--force-prs-managed] --json
prs issue finalize <issue-number>

prs tool pr list [--actionable] --json
prs tool pr ready <pr-number> [--unattended|--auto|--jdi] --json

prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name>
                  [--local-run <path>] [--media-manifest <path>]
prs tool token-usage render --file <path> --output <path> --json
prs tool token-usage capture --host <codex|claude-code|copilot> --output <path> [--session <id>] [--source <path>] [--since <ISO>] --json
```

`prs issue finalize` does not stage files for you. It previews the deterministic commit message and exact staged paths, refuses an empty index, and commits only changes already in the index, leaving unstaged and untracked files untouched.

Remote mutations—starting issue work, creating issues, and publishing managed comments or audits—need user authorization before the active agent invokes them. An issue-implementation request authorizes the assignment and issue Status update performed by `prs tool issue ready`; a readiness-tool flag alone does not. An explicit `--jdi`, `--auto` or `--unattended` issue-implementation request supplies approval for routine completion and token-usage audits only. Issue creation, spec/plan publication, discussion comments, PR reviews, merging and destructive cleanup retain their approval gates. Read-only context commands need no approval. `prs tool pr ready` changes the local checkout and may merge the latest base branch, but it does not push or merge a pull request.

## Local usage and cost evidence

`prs tool token-usage render` validates version-1 local evidence from Codex, Claude Code, or Copilot and writes publication-safe Markdown with one subtotal per host/model and one overall row. Request-level contributions, event IDs, exclusions, and full rate-card snapshots remain in the command's local JSON result. Both files must stay in the same `.prs/runs/<runId>/` directory. Rendering needs no GitHub authentication, provider connection, or model calls. Publish the reviewed report separately with `prs audit publish ... --section token-usage` under the JDI audit authorization described above, or after explicit report approval in an interactive run.

`prs tool token-usage capture` creates that evidence directly from a selected native session or local telemetry export. Recognized exact native model IDs receive an applicable immutable snapshot from the checked-in OpenAI, Anthropic, or GitHub Copilot rate catalogue; capture never fetches prices. Start it when the task's run directory exists, then repeat with the same output before reporting; its original session/source/start boundary and previously selected snapshots are retained. The first call starts at now unless you provide a known task-start `--since` timestamp. Codex can use `CODEX_THREAD_ID`; Claude Code needs its session ID and transcript path. For opted-in local Copilot app/CLI sessions, the bare command consumes a fresh managed session binding for the same repository and the verified managed exporter. Explicit `--session` and `--source` values remain authoritative. Missing, stale, invalid, or ambiguous bindings are reported as unavailable, not zero; PRS never selects the newest session. Hosted Copilot coding-agent evidence remains unsupported. Codex and Copilot JSONL are read in fixed chunks, with per-record limits of 64 MiB and 8 MiB respectively and at most 100,000 retained relevant records; JSON arrays and Claude Code sources keep the 64 MiB whole-file cap. Capture makes no model calls and does not install or modify hooks—the separate telemetry opt-in owns that setup. These are selected-session checkpoints, not guaranteed full-task/subagent totals. See [native setup and supported formats](docs/usage-evidence.md#native-capture) before testing on real issues.

The catalogue includes GPT-6 Sol and Luna for Codex and Copilot, plus GPT-6.1 Sol for Codex, with default and long-context rates. GPT-6.1 Sol cards apply from September 29, 2026 and use its lower cached-input rate. New captures select these cards by exact model ID and observation date; existing capture files keep their original pricing selections and are not repriced on repeat capture. Capture into a new run artifact to price previously unpriced observations with newly added cards.

Cumulative snapshots are differenced, never added as independent phase totals. Missing baselines, uncertain parent/child overlap, and unavailable captures remain visibly incomplete. Codex goal counters are host counters—not raw model tokens. Credits, provider charges, and estimates remain separate. Manually supplied sourced rate cards remain supported. Unknown or ambiguous models, unresolved bounded context tiers, and observations outside a card's effective dates remain unpriced. See [usage evidence and examples](docs/usage-evidence.md) for the contract, rate sources, native mappings, legacy handling, and limitations. Synthetic tests and static skill parity do not claim live host validation.

## Repository configuration

`.prs/config.json` accepts only local workflow settings:

```json
{
  "baseBranch": "main",
  "buildCommand": ["pnpm", "build"],
  "forge": { "type": "github" },
  "issueTracker": { "type": "github" },
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

The configured account applies to every GitHub operation performed by `prs` and takes precedence over inherited token variables. `.prs/config.local.json` selects that identity for PRS; it does not change the globally active GitHub CLI account, and PRS never uses `gh auth switch`. GitHub CLI owns the stored credential and its login or refresh process. Without a local account choice, `gh` uses its normal authentication, including `GH_TOKEN`/`GITHUB_TOKEN` for automation. GitHub CLI is required even when a token is supplied; `prs` no longer makes direct GitHub HTTP requests. A linked worktree has its own local account file.

For `prs tool issue list`, `prs tool pr list`, and `prs tool issue create`, a configured account that GitHub CLI still knows about but whose credential cannot be read by the host process returns `github-credential-store-inaccessible` with `retry-with-credential-store-access`. This includes status checks that become indeterminate because the restricted process cannot reach the credential store or GitHub. Retry the exact command through the host's normal permission mechanism, preserving approvals, artifact paths, targets, and any known issue number; PRS does not elevate itself or invoke a host-specific mechanism. Only after that unrestricted retry still reports missing or rejected credentials should the selected account be logged in or refreshed. A missing or rejected credential returns `github-auth-required` with `configure-github-auth`. Neither result authorizes exposing credentials, switching accounts, changing targets, or repeating an uncertain creation after a partial remote write. See [setup configuration](docs/setup-configuration.md) and [the CLI reference](docs/cli-reference.md#github-authentication-results).

Configure `forge.type` (`github` or `none`) for pull request workflows and `issueTracker.type` (`github`, `monday` or `none`) for issue workflows. If the tracker type is omitted, it inherits the effective forge type, preserving existing configurations. Setup writes both effective types explicitly. Both GitHub integrations use the same origin repository and existing `forge.githubCliPath` / local `forge.githubAccount` settings.

| Forge | Issue tracker | Available workflows |
|---|---|---|
| `github` | `github` | Issues, PRs and native issue–PR links |
| `github` | `none` | PR listing, readiness, reviews, checks and PR audits |
| `none` | `github` | Issue creation, listing, context, readiness, hierarchy, managed artifacts and issue audits |
| `none` | `none` | Local setup, usage evidence and staged-only local finalization |

Issue context and ordinary issue listing report unavailable linked-PR evidence explicitly when the forge is disabled. `issue list --actionable` blocks without that evidence. Issue-to-PR completion needs both integrations enabled. Issue arguments remain numeric: GitHub issue numbers for a GitHub tracker, native Monday item IDs for a Monday tracker. PR numbers always belong to the configured forge. See the Monday configuration below; separate GitHub tracker repositories/accounts are not supported.

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

## Monday issue tracking and task defaults

The same `prs tool issue list`, `context`, `ready`, `create`, `publish-artifacts`, `prs issue finalize` and issue audit commands work with either configured tracker. Monday requires the token named by `tokenEnv` (default `MONDAY_API_TOKEN`) in the environment or the repository's ignored `.env`; GitHub forge operations still require the selected GitHub CLI account. PR-only and tracker-only workflows remain independent.

For example, FOCAL's Tasks board uses an Epic relationship to identify project membership, independently of workflow groups:

```json
{
  "forge": { "type": "github" },
  "issueTracker": {
    "type": "monday",
    "defaults": {
      "groupId": "topics",
      "columnValues": { "task_epic": { "item_ids": ["3276311061"] } }
    },
    "monday": {
      "boardId": "5105675010",
      "scope": {
        "columnRules": [{ "columnId": "task_epic", "operator": "any_of", "compareValue": [3276311061] }]
      },
      "doneGroupIds": ["group_mkr5k2yh"],
      "defaultsByBoard": { "5105675017": { "columnValues": {} } },
      "workflow": {
        "5105675010": {
          "peopleColumnId": "task_owner", "statusColumnId": "task_status",
          "inProgressLabel": "In Progress", "doneLabels": ["Done", "No Longer Needed"],
          "closedLabel": "No Longer Needed"
        },
        "5105675017": {
          "peopleColumnId": "person", "statusColumnId": "status",
          "inProgressLabel": "Working on it", "doneLabels": ["Done"]
        }
      }
    }
  }
}
```

Use actual board/column IDs and existing options for each project. This example needs a configured dropdown `labelsColumnId` on each relevant board before requesting labels, and a writable subitem text `migrationSourceColumnId` before converting existing items. PRS checks these prerequisites without adding columns or labels. `apiVersion` defaults to `2026-07`; `doneBoardIds`, `doneGroupIds` and `bodyUpdatePrefix` are optional. `bodyUpdatePrefix` enables reading existing sync-owned body mirrors without editing them.

`defaults` are initial task values, not repeated updates. Monday accepts optional `groupId` and arbitrary supported writable `columnValues` as actual JSON values. Group placement applies only to top-level items; subitems inherit their parent's placement. `defaultsByBoard` overrides top-level default properties; a board override's `columnValues` replaces the complete base map, including when empty. Copied source values and explicit task values take precedence; explicit null/empty values clear fields where supported. Protected title/parent/migration identities cannot be supplied as defaults. Existing/reused tasks, readiness and artifact/audit writes are not retroactively patched with defaults. GitHub defaults accept `labels`, `assignees` and `milestone`; default and explicit labels are combined without duplicates.

`scope` controls reads, reuse and writes independently of defaults. Optional `groupIds` and column rules are combined with AND; supported operators are `any_of`, `not_any_of`, `contains_text`, `is_empty` and `is_not_empty`. With no scope restrictions, the whole configured board is in scope. Subtasks belong through their top-level ancestor, even when their own board has no Epic field. Completed boards, groups and configured status labels are excluded from actionable selection and protected from writes.

Monday request bodies, specifications, plans and audits use separate PRS-owned Updates containing escaped Markdown. Repeated publication verifies and edits the same managed update; human discussion and imported body mirrors remain separate. Foreign-owned or duplicate managed updates block writes. Readiness returns `trackerUpdate` with separate assignment/status outcomes; GitHub also retains `githubUpdate` for compatibility.

Parent-mode linked sets create new children directly as native subitems. Attaching an existing top-level Monday item creates a replacement subitem, copies its request and mapped metadata/artifacts, verifies links and both hierarchy directions, and only then sets the original's configured closed status. Receipts retain `replacementOf`, and the returned issue records contain the active subitem IDs/URLs. Partial failures preserve the original and resume the recorded replacement; unrelated parents and linked open PRs block conversion. Conversion is limited to source items without descendants: PRS stops before writes when it cannot preserve a source subtree. Classic boards support one subitem level; multi-level boards use their native depth limit. Flat sets perform no hierarchy conversion.

For a PR originating from a Monday item, include its canonical item URL and `<!-- prs:issue-ref monday ITEM_ID -->` in the PR body. PRS scans all repository PR pages and follows verified original/replacement references and same-repository imported GitHub source links. Unavailable evidence is reported explicitly and blocks actionable selection. GitHub closing syntax cannot close a Monday item; PR completion audits and subsequent Monday status management remain separate from merge behavior. PR audits, reviews and checks always use the forge.

Incomplete Monday creations retain local receipts under `.prs/runs/*-monday-create/`. A known item ID is read back and repaired using the original request; an uncertain result without a known ID requires receipt reconciliation rather than a blind retry or ordinary title reuse. Creation checks placement and every effective writable value, and rejects calculated/rollup targets that cannot preserve requested values.

Native Monday write validation is explicitly opt-in: after exact-target approval and preparation of a complete local pilot config, run `PRS_MONDAY_PILOT_CONFIG=/absolute/path/config.json PRS_MONDAY_PILOT_APPROVED=issue-375 PRS_MONDAY_PILOT_REPO=/absolute/path/repository PRS_MONDAY_PILOT_RUN=/absolute/path/prs/.prs/runs/pilot pnpm exec vitest run packages/cli/src/monday-live-pilot.test.ts`. Supply the configured token through the environment before running it. This trial creates/updates disposable named items and retires its disposable conversion source; normal tests skip it. The environment binding is a guard, not authorization to change live data.
