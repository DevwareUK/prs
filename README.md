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

## Primary offer

Start here if you are evaluating `prs` for a team:

| Surface | Why it is part of the primary offer |
| --- | --- |
| `actions/pr-review` | Adds AI pull request pre-review signal, a shared structured impact profile, higher-level findings, and line-linked review comments in GitHub. Generated setup workflows mark inline comments with hidden PRS metadata, reconcile older PRS-authored review threads before posting, and avoid repeating the same active finding. |
| `actions/pr-assistant` | Maintains a managed PR assistant section in the pull request body without overwriting unrelated manual content and renders the same shared structured impact profile used by PR review. |
| `actions/test-suggestions` | Posts practical, task-ready test suggestions for the current pull request diff in GitHub. |
| `prs review` | Runs a local top-risk diff pre-review that surfaces the shared structured impact profile and strongest reviewer-ready concerns before or during a pull request. |
| `/prs pr <pr-number> review` | Prepares the live PR checkout plus repo-aware review context for the active Codex session, then writes a consolidated report plus line-linked comment candidates under `.prs/runs`; guided runs ask for approval before publishing the managed PR audit comment and high-confidence inline review comments. |
| `/prs pr <pr-number> address-comments` | Prepares selected GitHub review comments as local `.prs/` artifacts for the active Codex session, then expects verified committed fixes to be pushed with the guarded `prs tool pr push-reviewed <pr-number> --json` path. |
| `/prs pr <pr-number> fix-tests` | Captures currently failing local verification output on a PR branch, prepares a focused fix snapshot for the active Codex session, then expects verified committed fixes to be pushed through the guarded PR-head push tool. |
| `/prs pr <pr-number> add-tests` | Prepares selected managed AI test suggestions as local `.prs/` artifacts with preserved task context, then expects verified committed test changes to be pushed through the guarded PR-head push tool. |
| `prs test-backlog` | Finds the highest-value automated testing gaps in the repository. |

Internally, local PR actions route through a PR lifecycle coordinator; older workflow folders such as `pr-fix-comments`, `pr-fix-failing-tests`, and `pr-fix-tests` remain implementation steps behind the public command names above.

Use [docs/launch-demo.md](docs/launch-demo.md) when you need a buyer-facing walkthrough of this first-offer path.

## Recommended workflows

These are the fastest paths to a useful first result:

1. Review a pull request better: use `actions/pr-review` in GitHub, run `prs review --base origin/main` locally, or use `/prs pr <pr-number> review` for deeper local Codex review of a live PR checkout.
2. Respond to live PR feedback from Codex: use `/prs pr <pr-number> address-comments`, `/prs pr <pr-number> fix-tests`, or `/prs pr <pr-number> add-tests` when the PR branch is checked out locally.
3. Raise test confidence: use `actions/test-suggestions` on pull requests and `prs test-backlog --top 5` for repository-wide gaps.

Add `actions/pr-assistant` when you also want managed PR-body updates that preserve human-written context.

## Quick start

Install the CLI from this repository:

```bash
cd /path/to/prs
pnpm install
pnpm --filter @prs/cli build
cd packages/cli
pnpm link --global
```

Configure a target repository:

```bash
cd /path/to/your-repo
prs setup
```

For GitHub repositories, `prs setup` asks which managed GitHub Action workflows to enable. Enabled managed workflows are installed or updated under `.github/workflows/prs-*.yml`; disabled prs-managed workflow files are removed so they do not keep running. Setup also writes `ai.codex.preferSubagents`, which defaults to `true`; managed `/prs` Codex skills treat that enabled repository setting as standing consent to delegate suitable independent tasks to subagents when the tool is available, while still keeping approvals and final verification in the main session. Setup does not write PRS-owned model profiles or role-to-model mappings; rerunning it removes those obsolete keys while preserving unrelated AI settings.

Install or refresh the global managed Codex `/prs` skills after installing or upgrading the CLI:

```bash
prs update skills
```

For the recommended OpenAI provider path, create a `.env` file in the target repository with `OPENAI_API_KEY`. `OPENAI_MODEL` and `OPENAI_BASE_URL` are optional. GitHub-backed local workflows can use `GH_TOKEN`/`GITHUB_TOKEN`, but normal developer and Codex shells can also use an authenticated `gh`; if that binary is outside PATH, set `forge.githubCliPath` in `.prs/config.json` or `PRS_GH_PATH` in the shell.

Then try the safest local CLI workflows:

```bash
prs review
prs test-backlog --top 5
```

If you already have a live GitHub pull request branch checked out locally in Codex, try:

```bash
/prs pr 88 address-comments
/prs pr 88 review
/prs pr 88 fix-tests
/prs pr 88 add-tests
```

See [docs/setup-configuration.md](docs/setup-configuration.md) for prerequisites, `prs setup`, `.env`, setup-managed `.prs/config.json` and `.prs/.gitignore`, provider/runtime fallback, and generated `.prs/` working-state details.

## Command tiers

Run `prs help` or `prs --help` for the same tiered overview in the terminal.

Primary offer commands:

- `prs review`
- `/prs pr <pr-number> review`
- `/prs pr <pr-number> address-comments`
- `/prs pr <pr-number> fix-tests`
- `/prs pr <pr-number> add-tests`
- `prs test-backlog`

Advanced commands:

- `/prs create observability [--site <site>] [--env <env>] [--since <duration>]`
- `prs issue draft --observability-findings <path>`
- `prs issue draft --draft-file <path> [--media-manifest <path>]`
- `prs issue refine <number>`
- `prs issue plan <number> [--refresh]`
- `prs issue estimate <number>`
- `prs issue <number>`

Beta commands:

- `prs issue <number> <number> ...`
- `prs pr resolve-conflicts <pr-number>`
- `/prs cleanup worktrees`
- `prs feature-backlog`

Supporting commands:

- `prs setup`
- `prs setup --update-skills`
- `prs update skills`
- `/prs cleanup branches`
- `prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name> [--local-run <path>] [--media-manifest <path>]`
- `prs tool token-usage publish (--issue <number>|--pr <number>) --file <path> --json`
- `prs tool issue list [--actionable] --json`
- `prs tool issue ready <issue-number> [--unattended|--auto|--jdi] --json`
- `prs tool issue estimate <issue-number> --json`
- `prs tool issue estimate-context <issue-number> --json`
- `prs tool issue publish-estimate <issue-number> --file <path> --json`
- `prs tool issue create (--draft-file <path>|--issue-set <path>) --json [--run-dir <path>] [--spec-file <path>] [--plan-file <path>] [--media-manifest <path>]`
- `prs tool pr list [--actionable] --json`
- `prs tool pr ready <pr-number> [--unattended|--auto|--jdi] --json`
- `prs tool pr review <pr-number> [--unattended|--auto|--jdi] --json`
- `prs tool pr publish-review <pr-number> --report <path> --comments <path> [--review-status <request-changes|comment|approve>] [--unattended|--auto|--jdi] --json`
- `prs tool pr prepare-review <pr-number> --json`
- `prs tool pr push-reviewed <pr-number> --json`
- `prs tool branches cleanup [--apply] --json`
- `prs tool worktrees cleanup [--apply] --json`
- `prs commit`
- `prs diff`

`/prs cleanup worktrees` routes to the managed `prs:cleanup-worktrees` skill and uses `prs tool worktrees cleanup --json` for the dry-run report. Apply mode is intentionally explicit because the command can remove PRS-managed worktrees only when they are clean and proven safe to remove.

Legacy issue support commands such as the batch alias, runtime-launched drafting, and split prepare/finalize flows stay callable for older automation, GitHub Action support, and manual recovery, but they are not first-choice command-tier entries. See [docs/cli-reference.md](docs/cli-reference.md) for their reference behavior and current replacements.

The old `prs codex ...` nested launcher group has been retired. To start an agentic `/prs` workflow from a shell, run Codex directly in the repository, for example `codex -C <repo> "/prs issue <number> refine"` or `codex exec -C <repo> "/prs pr <number> review"`. Inside an active Codex session, use the deterministic `prs tool ... --json` commands for handoff data. Legacy runtime-launching commands that would start a child Codex process are blocked when Codex session markers are present; for unattended issue work, use `prs tool issue ready <issue-number> --unattended --json` and continue in the active session.

`prs tool issue list [--actionable] --json` and `prs tool pr list [--actionable] --json` include a `url` field for every returned issue or pull request. Issue list PRS plan status recognizes direct managed `<!-- prs:issue-plan -->` comments; audit trail comments published by `prs audit publish` do not count as source-of-truth plan comments. The interactive `/prs issue` and `/prs pr` entrypoints use those list tools and should show each returned item with its number, title, and GitHub URL before offering follow-up actions.

`/prs cleanup branches` uses `prs tool branches cleanup --json` to dry-run local branch cleanup. It reports local branches that are already merged into the configured `.prs/config.json` `baseBranch`, plus skipped branches such as the current branch, protected branch names, unmerged branches, and branches checked out by any worktree. Apply mode is explicit: `prs tool branches cleanup --apply --json` recomputes the safe candidates and deletes them with normal safe local branch deletion. It does not force-delete branches, delete remote branches, prune remotes, or clean stale upstream branches.

`prs issue refine <number>` is the guided issue-refinement flow for rough or non-technical tickets. It uses the GitHub issue comments as the refinement conversation, asks every currently blocking high-value question needed to understand the user's intention and likely knock-on effects, and does not publish a partial specification or plan while important answers are still missing. The original issue body is preserved as the initial request. If brainstorming is not satisfied yet, prs posts the next clarification questions as a normal issue comment and stops so the async discussion can continue. Once refinement is settled, prs keeps the original issue as the single ticket and publishes the source-of-truth artifacts as managed comments on that same issue: `<!-- prs:issue-spec -->` for the settled specification and `<!-- prs:issue-plan -->` for the implementation plan. In interactive runs, prs previews the refined issue draft, generated specification, and generated implementation plan, then waits for approval before posting those managed comments to GitHub. After the managed plan comment is created or updated, prs attempts a non-blocking deterministic estimate publication to the issue token telemetry ledger. The active Codex `/prs issue <number> refine` route follows the same approval rule when it handles refinement directly in the current session. It then adds a final confidence comment confirming the issue is ready for development. This refinement flow does not create linked issues; split work should be decided explicitly outside refinement.

`prs issue draft --observability-findings <path>` imports a DSM-owned `dsm grafana triage` JSON findings artifact. PRS validates artifact `version: 1`, skips malformed individual findings with diagnostics, keeps only actionable findings at medium severity or higher for the active GitHub repository, skips likely duplicates by finding ID, fingerprint, or suggested title, and writes local draft/spec/plan artifacts under `.prs/runs/<timestamp>-issue-draft/`. One selected finding follows the normal single issue draft preview; multiple selected findings follow the linked issue-set preview. In both cases, PRS stops at the existing approve/modify/cancel gate before creating GitHub issues. PRS does not query Grafana, Prometheus, Loki, or Faro directly.

`/prs create observability` is the managed Codex shortcut for the DSM-to-PRS handoff. The skill infers the site from the current repository when possible, defaults to `--env prod` and `--since 24h`, runs `dsm grafana triage` to write JSON and Markdown artifacts under `.prs/runs`, then passes the JSON artifact to `prs issue draft --observability-findings <path>`. The shortcut is a command wrapper around the artifact contract; PRS still does not query Grafana, Prometheus, Loki, or Faro directly.
If pasted notes, logs, attachments, or old draft text accompany the shortcut, the skill still treats DSM triage output as the issue source instead of drafting directly from that context.

`prs issue draft --draft-file <path> --media-manifest <path>`, `prs tool issue create --draft-file <path> --media-manifest <path> --json`, and `prs audit publish ... --media-manifest <path>` attach visual evidence metadata to GitHub-facing Markdown. The manifest may be a JSON array or `{ "media": [...] }`; each item must provide exactly one of `url` or `path`, may set `kind` to `image` or `video`, and may include `caption` and `alt`. Supported local/URL extensions are `png`, `jpg`, `jpeg`, `gif`, `webp`, `mp4`, `mov`, and `webm`; local images are limited to 25 MB and local videos to 100 MB. URL images are embedded, URL videos are linked, and tracked repository image/video paths are rendered as raw GitHub URLs for the current branch. Local files that are not tracked in git are validated but omitted from GitHub-facing Markdown until a configured external storage backend exists.

For `/prs create` and `prs issue draft`, the GitHub issue body is concise summary/context. An estimate-ready issue needs marker-based managed issue comments after creation: `<!-- prs:issue-spec -->` for the source-of-truth specification and `<!-- prs:issue-plan -->` for the implementation plan consumed by `prs issue estimate <number>`. `prs audit publish` comments are audit trail comments; they do not replace confirming the managed issue spec/plan comments. When approved Superpowers spec and plan artifacts are supplied, the guided create flow publishes those managed comments automatically. `prs tool issue create --json` accepts `--spec-file` and `--plan-file`; when those artifacts exist and are non-empty, the tool publishes the managed comments, attempts a non-blocking deterministic estimate publication after the managed plan is visible, returns that status in `estimatePublicationHints`, and returns the marker comments in `managedComments`. If either marker comment still needs attention, the result includes `managedCommentHints` describing what remains before the issue is estimate-ready.

Managed issue workflows track available token telemetry in one managed `<!-- prs:token-usage -->` comment per issue. `/prs create`, `/prs issue <number> refine`, `/prs issue <number> estimate`, and `/prs issue <number>` implementation/finalization runs keep per-run `codex-token-usage.json` evidence or estimate artifacts under `.prs/runs` and publish the consolidated comment with `prs tool token-usage publish --issue <number> --file <path> --json` or `prs tool issue publish-estimate <number> --file <path> --json`. A token artifact may contain one entry or an `entries` array for multiple Codex goals/sessions in the same run; each entry should carry a stable `id` for its workflow phase plus current run/session. The managed GitHub comment is the merge source of truth: each publish fetches the current comment, upserts only the entry IDs from the current artifact, preserves rows from other machines/runs, and rewrites the visible tables plus hidden structured ledger data. Actual usage and forecast estimates render as separate compact tables. Estimate publication uses the same merge-safe comment and adds forecast rows without deleting actual usage rows. In active Codex app sessions, `/prs create` and `/prs issue <number> refine` create or reuse a planner-scoped Codex goal, verify `get_goal` can see the active goal before drafting/refining continues, and call `get_goal` again before writing `codex-token-usage.json`; token totals from `tokensUsed` or `usage.totalTokens` are recorded as tracked usage, and unavailable rows are reserved for cases where no active goal is visible or the goal usage fields are genuinely unavailable. Token publishers normalize elapsed time from `timeUsedSeconds`, `usage.timeUsedSeconds`, or compatibility `elapsedTimeSeconds`, enrich current Codex-session rows from the local Codex thread state when `CODEX_THREAD_ID` is available, and preserve only model metadata explicitly supplied by the active session or artifact. Raw per-run details and estimate rationale stay in the local artifact and hidden structured ledger data. `prs tool issue create --json` publishes token usage before managed spec/plan comments when `codex-token-usage.json` exists under the supplied `--run-dir` and reports it in `tokenUsageComments`; otherwise it may return `auditPublicationHints` for older callers. During final audit publication, `prs audit publish --issue <number> --file <path> --section <name>` or `--pr <number>` also publishes a sibling `codex-token-usage.json` from the same run directory when one exists, so completion comments and token ledgers stay in sync. `prs audit publish --section token-usage` is a compatibility wrapper for the same managed token telemetry comment and must not publish raw JSON.

PR-related workflows use the same shared token audit renderer for PR-lifetime `<!-- prs:token-usage -->` comments. `prs tool pr ready <pr-number> --json`, `prs tool pr review <pr-number> --json`, `prs pr address-comments <pr-number>`, `prs pr add-tests <pr-number>`, and `prs pr fix-tests <pr-number>` return or persist `tokenUsage` metadata that points at the run-local `.prs/runs/.../codex-token-usage.json` artifact and the matching `prs tool token-usage publish --pr <number> --file <path> --json` publication target. PR token ledgers use the same compact usage table as issue ledgers, but render as `Codex token telemetry ledger for PR #<number>`. If usage or actual model metadata is unavailable, PR workflows should record partial or unavailable telemetry without blocking readiness, review publication, fixes, commits, or guarded pushes.

`prs tool issue ready <issue-number> [--unattended|--auto|--jdi] --json` reports the current managed issue-refinement artifact status without blocking implementation. It recognizes direct managed `<!-- prs:issue-spec -->` and `<!-- prs:issue-plan -->` comments; audit trail comments are ignored for source-of-truth readiness. If the specification or plan comment is missing, the JSON result is still `status: "ready"` and notes that missing managed refinement artifacts will be generated and published during issue preparation. When `prs issue <number>` or `prs issue prepare <number>` needs to create a missing managed plan before implementation, it also publishes a managed `<!-- prs:issue-spec -->` comment from the available issue context.

`/prs issue <issue-number> estimate` is the plan-first estimate flow. It runs `prs tool issue estimate-context <issue-number> --json` to gather the managed `<!-- prs:issue-plan -->` comment and verification commands for the active Codex session. Codex then produces a structured estimate artifact from that plan and publishes it with `prs tool issue publish-estimate <issue-number> --file <path> --json`, which creates or updates the issue's managed `<!-- prs:token-usage -->` token telemetry comment. Model selection belongs to the active Codex/subagent session rather than PRS-owned repository profiles. The CLI does not need an OpenAI API key for this flow because Codex is the model step.

`prs tool issue estimate <issue-number> --json` remains a deterministic compatibility estimate for automation that cannot ask Codex to reason over the plan. It returns rough USD cost ranges that explicitly identify the priced token range, formula, and cost-basis metadata. Dollar ranges are rough planning estimates calculated from PRS model-rate defaults, an 80% input / 20% output token split, and any `.prs/config.json` `ai.costEstimates` overrides. Actual billing can vary with model pricing, input/output mix, cached tokens, retries, and future price changes. New Codex-facing integrations should prefer `estimate-context` plus `publish-estimate`.

The default model-rate table recognizes `gpt-5.6` and `gpt-5.6-sol` at a $10 blended planning rate per million tokens, `gpt-5.6-terra` at $5, and `gpt-5.6-luna` at $2. These effective rates use the same 80% input / 20% output assumption; they are rough standard-pricing estimates and do not model cached input, cache writes, long-context multipliers, batch/flex/priority processing, subscriptions, or regional pricing.

Managed `/prs issue <issue-number> --unattended`/`--jdi` Codex skill runs track actual Codex usage with a prs-owned run artifact when the active Codex environment exposes usage data. Codex goals are optional telemetry sources, not the lifecycle authority for completion. The workflow records `codex-token-usage.json` under the issue run directory, includes workflow identity, capture phase, and audit publication state when available, and updates the issue-lifetime `token-usage` ledger before reporting the managed skill run complete. Model metadata comes from the active Codex session when available; PRS no longer supplies configured model/profile fallbacks. If usage or model metadata is unavailable, the workflow records that status without blocking verification, commit, push, or PR creation.

Unattended issue runs write `.prs/runs/.../issue-orchestration-state.json` after the issue branch is verified and a pull request is opened or skipped. That state file records the issue lifecycle stages from preparation through PR readiness, review, comment fixing, bounded CI waiting/fixing, final audit, and marking a successful draft PR ready for review. The active `/prs issue <number> --jdi` skill should use this state as the resumable ledger for continuing post-PR work; skipped or blocked stages include summaries and retry guidance instead of being treated as completed work. After `/prs finish` creates or updates the pull request, the active issue pipeline continues by running `prs tool pr ready <pr-number> --unattended --json`, then `prs tool pr review <pr-number> --unattended --json`, writing and publishing the returned review report/comment artifacts with `prs tool pr publish-review <pr-number> --report <path> --comments <path> --review-status <request-changes|comment|approve> --unattended --json`, before moving on to comment fixes, bounded CI handling, final audit, and the ready-for-review promotion stage. The GitHub Actions `pr-review` workflow is a separate automation signal and does not satisfy this active Codex review stage.

Codex-first issue completion never uses the configured text provider for finalization. `prs issue finalize <number>`, local `prs issue <number>`, and unattended `prs issue <number> --jdi` let Codex do the repository work, then use deterministic local commit and PR text for the CLI-owned final step.

`prs tool pr ready <pr-number> --json` is the local PR-readiness path used by `/prs:pr`: it checks out the actual PR head branch, fetches and merges the latest PR base branch, runs configured `.prs/config.json` `prReadiness.commands`, writes readiness metadata with local readiness step results and GitHub-hosted context such as failed/pending checks, managed AI test suggestions, actionable review comments, and grouped comment summaries with source links, and does not run broad local verification beyond those explicit readiness commands. Readiness commands are skipped when base sync is blocked by merge conflicts. A failing readiness command returns a blocked result with the failed step and output log path. Review comment readiness uses the same resolved/outdated thread filtering as `prs pr address-comments`, suppresses duplicate PRS-authored inline findings, and reports separate counts for actionable, handled older-head, duplicate, resolved, and outdated review threads. Add `--unattended`, `--auto`, or `--jdi` when you also want the configured local runtime started when possible after readiness commands pass.

`/prs pr <pr-number> review` uses `prs tool pr review <pr-number> --json` to check out/sync the PR head, collect linked issues, changed files, diff, checks, issue comments, review comments, metadata, and a focused review prompt, then lets the active Codex session write `.prs/runs/<timestamp>-pr-<number>-review/codex-pr-review.md` and `.prs/runs/<timestamp>-pr-<number>-review/codex-pr-review-comments.json`. In guided mode, the active session presents a concise approval summary and only runs `prs tool pr publish-review <pr-number> --report <reportFilePath> --comments <commentsFilePath> --review-status <request-changes|comment|approve> --json` after the user approves posting to GitHub. Declining approval leaves the local artifacts under `.prs/runs` and creates no GitHub comments or reviews. Add `--unattended`, `--auto`, or `--jdi` to the review command when the active session should publish automatically; it then uses `prs tool pr publish-review <pr-number> --report <reportFilePath> --comments <commentsFilePath> --review-status <request-changes|comment|approve> --unattended --json`. The publish tool maps review statuses to GitHub review events `REQUEST_CHANGES`, `COMMENT`, and `APPROVE`; if omitted for compatibility, it infers `request-changes` when high-confidence inline findings remain and `comment` otherwise. When GitHub rejects an `APPROVE` review with validation status 422, prs retries the GitHub review as `COMMENT` and includes fallback details in the JSON result because the authenticated account usually cannot approve its own pull request. The workflow does not edit code, commit, push, or resolve comments.

GitHub-visible output follows the workflow mode. Manual/guided commands publish developer-approved comments without automation framing. Unattended outputs, including managed issue specs/plans, audit comments, local PR review comments, and test suggestion comments, include a visible `prs automation note` while keeping hidden managed markers such as `<!-- prs:issue-plan -->` stable for update/reuse behavior.

`/prs pr <pr-number> address-comments`, `/prs pr <pr-number> fix-tests`, and `/prs pr <pr-number> add-tests` use deterministic `prs tool pr ... --json` preparation commands. They write the focused `.prs/runs/...` prompt, snapshot, metadata, and output-log artifacts, return the file paths to the active Codex session, and do not launch a nested runtime. After active Codex verifies and commits selected fixes, run `prs tool pr push-reviewed <pr-number> --json` to fetch the PR head, check ahead/behind status, and push only when `HEAD` is ahead and not behind `origin/<pr-head-branch>`.

Compatibility aliases remain during the command rename window: `fix-comments` maps to `address-comments`, and `fix-failing-tests` maps to `fix-tests`. The old AI-test-suggestion meaning of `fix-tests` has moved to `add-tests`.

Detailed command behavior lives in [docs/cli-reference.md](docs/cli-reference.md). Codex and `/prs` operator guidance lives in [docs/codex-prs-workflows.md](docs/codex-prs-workflows.md).

## Documentation map

| Document | Use it for |
| --- | --- |
| [docs/setup-configuration.md](docs/setup-configuration.md) | Installation, `prs setup`, `.env`, `.prs/config.json`, PR local readiness commands, runtime/provider fallback, and `.prs/` state. |
| [docs/cli-reference.md](docs/cli-reference.md) | Full CLI command reference, flags, examples, important behavior, and workflow command details. |
| [docs/codex-prs-workflows.md](docs/codex-prs-workflows.md) | Codex runtime expectations, Superpowers-backed issue planning, unattended issue automation, and `/prs` operator usage. |
| [docs/launch-demo.md](docs/launch-demo.md) | Buyer-facing demo order and trust-boundary story for the first-offer workflows. |
| [docs/development.md](docs/development.md) | Monorepo layout, package scripts, GitHub Action local entrypoints, testing, and CI expectations. |

## Development

This is a pnpm workspace. The main checks are:

```bash
pnpm build
pnpm test
pnpm lint
```

Contributor command details, package-level scripts, local action entrypoints, and CI workflow notes are in [docs/development.md](docs/development.md).
