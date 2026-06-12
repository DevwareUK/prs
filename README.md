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

For GitHub repositories, `prs setup` asks which managed GitHub Action workflows to enable. Enabled managed workflows are installed or updated under `.github/workflows/prs-*.yml`; disabled prs-managed workflow files are removed so they do not keep running. Setup also writes `ai.codex.preferSubagents`, which defaults to `true`; managed `/prs` Codex skills treat that enabled repository setting as standing consent to delegate suitable independent tasks to subagents when the tool is available, while still keeping approvals and final verification in the main session. Setup writes PRS-managed AI profiles too: `premium` uses `gpt-5.5` with `high` thinking, `standard` uses `gpt-5.4-mini` with `medium` thinking, and `ai.roles` routes planner/reviewer to `premium` and implementer/tester to `standard`.

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

- `prs issue draft --draft-file <path> [--media-manifest <path>]`
- `prs issue refine <number>`
- `prs issue plan <number> [--refresh]`
- `prs issue estimate <number>`
- `prs issue <number>`
- `prs issue prepare <number>`
- `prs issue finalize <number>`

Beta commands:

- `prs issue <number> <number> ...`
- `prs issue batch <number> <number> [...number]`
- `prs pr resolve-conflicts <pr-number>`
- `prs feature-backlog`

Supporting commands:

- `prs setup`
- `prs setup --update-skills`
- `prs update skills`
- `prs audit publish (--issue <number>|--pr <number>) --file <path> --section <name> [--local-run <path>] [--media-manifest <path>]`
- `prs tool issue list [--actionable] --json`
- `prs tool issue ready <issue-number> [--unattended|--auto|--jdi] --json`
- `prs tool issue estimate <issue-number> --json`
- `prs tool issue estimate-context <issue-number> --json`
- `prs tool issue publish-estimate <issue-number> --file <path> --json`
- `prs tool issue create (--draft-file <path>|--issue-set <path>) --json [--run-dir <path>] [--spec-file <path>] [--plan-file <path>] [--media-manifest <path>]`
- `prs tool pr list [--actionable] --json`
- `prs tool pr ready <pr-number> [--unattended|--auto|--jdi] --json`
- `prs tool pr review <pr-number> [--unattended|--auto|--jdi] --json`
- `prs tool pr publish-review <pr-number> --report <path> --comments <path> [--unattended|--auto|--jdi] --json`
- `prs tool pr prepare-review <pr-number> --json`
- `prs tool pr push-reviewed <pr-number> --json`
- `prs commit`
- `prs diff`

The old `prs codex ...` nested launcher group has been retired. To start an agentic `/prs` workflow from a shell, run Codex directly in the repository, for example `codex -C <repo> "/prs issue <number> refine"` or `codex exec -C <repo> "/prs pr <number> review"`. Inside an active Codex session, use the deterministic `prs tool ... --json` commands for handoff data. Legacy runtime-launching commands that would start a child Codex process are blocked when Codex session markers are present; for unattended issue work, use `prs tool issue ready <issue-number> --unattended --json` and continue in the active session.

`prs tool issue list [--actionable] --json` and `prs tool pr list [--actionable] --json` include a `url` field for every returned issue or pull request. Issue list PRS plan status recognizes direct managed `<!-- prs:issue-plan -->` comments; audit trail comments published by `prs audit publish` do not count as source-of-truth plan comments. The interactive `/prs issue` and `/prs pr` entrypoints use those list tools and should show each returned item with its number, title, and GitHub URL before offering follow-up actions.

`prs issue refine <number>` is the guided issue-refinement flow for rough or non-technical tickets. It uses the GitHub issue comments as the refinement conversation, asks every currently blocking high-value question needed to understand the user's intention and likely knock-on effects, and does not publish a partial specification or plan while important answers are still missing. The original issue body is preserved as the initial request. If brainstorming is not satisfied yet, prs posts the next clarification questions as a normal issue comment and stops so the async discussion can continue. Once refinement is settled, prs keeps the original issue as the single ticket and publishes the source-of-truth artifacts as managed comments on that same issue: `<!-- prs:issue-spec -->` for the settled specification and `<!-- prs:issue-plan -->` for the implementation plan. In interactive runs, prs previews the refined issue draft, generated specification, and generated implementation plan, then waits for approval before posting those managed comments to GitHub. After the managed plan comment is created or updated, prs attempts a non-blocking deterministic estimate publication to the issue audit `Estimate` section. The active Codex `/prs issue <number> refine` route follows the same approval rule when it handles refinement directly in the current session. It then adds a final confidence comment confirming the issue is ready for development. This refinement flow does not create linked issues; split work should be decided explicitly outside refinement.

`prs issue draft --draft-file <path> --media-manifest <path>`, `prs tool issue create --draft-file <path> --media-manifest <path> --json`, and `prs audit publish ... --media-manifest <path>` attach visual evidence metadata to GitHub-facing Markdown. The manifest may be a JSON array or `{ "media": [...] }`; each item must provide exactly one of `url` or `path`, may set `kind` to `image` or `video`, and may include `caption` and `alt`. Supported local/URL extensions are `png`, `jpg`, `jpeg`, `gif`, `webp`, `mp4`, `mov`, and `webm`; local images are limited to 25 MB and local videos to 100 MB. URL images are embedded, URL videos are linked, and tracked repository image/video paths are rendered as raw GitHub URLs for the current branch. Local files that are not tracked in git are validated but omitted from GitHub-facing Markdown until a configured external storage backend exists.

For `/prs create` and `prs issue draft`, the GitHub issue body is concise summary/context. An estimate-ready issue needs marker-based managed issue comments after creation: `<!-- prs:issue-spec -->` for the source-of-truth specification and `<!-- prs:issue-plan -->` for the implementation plan consumed by `prs issue estimate <number>`. `prs audit publish` comments are audit trail comments; they do not replace confirming the managed issue spec/plan comments. When approved Superpowers spec and plan artifacts are supplied, the guided create flow publishes those managed comments automatically. `prs tool issue create --json` accepts `--spec-file` and `--plan-file`; when those artifacts exist and are non-empty, the tool publishes the managed comments, attempts a non-blocking deterministic estimate publication after the managed plan is visible, returns that status in `estimatePublicationHints`, and returns the marker comments in `managedComments`. If either marker comment still needs attention, the result includes `managedCommentHints` describing what remains before the issue is estimate-ready.

Managed issue workflows track available token usage in one issue-lifetime `token-usage` ledger. `/prs create`, `/prs issue <number> refine`, `/prs issue <number> estimate`, and `/prs issue <number>` implementation/finalization runs keep per-run `codex-token-usage.json` evidence under `.prs/runs` and update the issue audit table after each GitHub-visible phase. The ledger table is a concise overview with phase, role, model provenance, status, total tokens, rough estimated cost, elapsed time, and capture time; raw per-run details stay in the local artifact. The estimated-cost column uses configured model rates and blend ratios when a row has model and total-token data. `prs tool issue create --json` returns `auditPublicationHints` for the issue token-usage ledger when that artifact exists under the supplied `--run-dir`. Model names prefer actual Codex session metadata when available; configured role/profile models are shown only as fallback provenance.

`prs tool issue ready <issue-number> [--unattended|--auto|--jdi] --json` reports the current managed issue-refinement artifact status without blocking implementation. It recognizes direct managed `<!-- prs:issue-spec -->` and `<!-- prs:issue-plan -->` comments; audit trail comments are ignored for source-of-truth readiness. If the specification or plan comment is missing, the JSON result is still `status: "ready"` and notes that missing managed refinement artifacts will be generated and published during issue preparation. When `prs issue <number>` or `prs issue prepare <number>` needs to create a missing managed plan before implementation, it also publishes a managed `<!-- prs:issue-spec -->` comment from the available issue context.

`/prs issue <issue-number> estimate` is the primary model-based estimate flow. It runs `prs tool issue estimate-context <issue-number> --json` to gather the managed `<!-- prs:issue-plan -->` comment, configured model profiles, and verification commands for the active Codex session. Codex then produces a structured estimate artifact from that plan and publishes it with `prs tool issue publish-estimate <issue-number> --file <path> --json`, which creates or updates the issue's managed `<!-- prs:audit -->` comment `Estimate` section. The rendered estimate uses the same compact table layout as the token-usage ledger, with token ranges and rough cost ranges in the matching columns plus concise recommendation, drivers, warnings, and assumptions. The CLI does not need an OpenAI API key for this flow because Codex is the model step.

`prs tool issue estimate <issue-number> --json` remains a deterministic compatibility estimate for automation that cannot ask Codex to reason over the plan. It returns rough USD cost ranges that explicitly identify the priced token range, formula, and cost-basis metadata. Dollar ranges are rough planning estimates calculated from PRS model-rate defaults, an 80% input / 20% output token split, and any `.prs/config.json` `ai.costEstimates` overrides. Actual billing can vary with model pricing, input/output mix, cached tokens, retries, and future price changes. New Codex-facing integrations should prefer `estimate-context` plus `publish-estimate`.

Managed `/prs issue <issue-number> --unattended`/`--jdi` Codex skill runs track actual Codex usage with a prs-owned run artifact when the active Codex environment exposes usage data. Codex goals are optional telemetry sources, not the lifecycle authority for completion. The workflow records `codex-token-usage.json` under the issue run directory, includes workflow identity, capture phase, and audit publication state when available, and updates the issue-lifetime `token-usage` ledger before reporting the managed skill run complete. Model metadata mirrors `prs issue estimate` profile formatting, such as `standard (gpt-5.4-mini, medium thinking)` for the default implementer profile or `premium (gpt-5.5, high thinking)` for premium-profile work, but actual active Codex session metadata wins over configured fallback profile data. If usage or model metadata is unavailable, the workflow records that status without blocking verification, commit, push, or PR creation. The ledger is actual available run/session telemetry, not exact billing and not the same as estimate forecasts.

Codex-first issue completion never uses the configured text provider for finalization. `prs issue finalize <number>`, local `prs issue <number>`, and unattended `prs issue <number> --jdi` let Codex do the repository work, then use deterministic local commit and PR text for the CLI-owned final step.

`prs tool pr ready <pr-number> --json` is the local PR-readiness path used by `/prs:pr`: it checks out the actual PR head branch, fetches and merges the latest PR base branch, runs configured `.prs/config.json` `prReadiness.commands`, writes readiness metadata with local readiness step results and GitHub-hosted context such as failed/pending checks, managed AI test suggestions, actionable review comments, and grouped comment summaries with source links, and does not run broad local verification beyond those explicit readiness commands. Readiness commands are skipped when base sync is blocked by merge conflicts. A failing readiness command returns a blocked result with the failed step and output log path. Review comment readiness uses the same resolved/outdated thread filtering as `prs pr address-comments`, suppresses duplicate PRS-authored inline findings, and reports separate counts for actionable, handled older-head, duplicate, resolved, and outdated review threads. Add `--unattended`, `--auto`, or `--jdi` when you also want the configured local runtime started when possible after readiness commands pass.

`/prs pr <pr-number> review` uses `prs tool pr review <pr-number> --json` to check out/sync the PR head, collect linked issues, changed files, diff, checks, issue comments, review comments, metadata, and a focused review prompt, then lets the active Codex session write `.prs/runs/<timestamp>-pr-<number>-review/codex-pr-review.md` and `.prs/runs/<timestamp>-pr-<number>-review/codex-pr-review-comments.json`. In guided mode, the active session presents a concise approval summary and only runs `prs tool pr publish-review <pr-number> --report <reportFilePath> --comments <commentsFilePath> --json` after the user approves posting to GitHub. Declining approval leaves the local artifacts under `.prs/runs` and creates no GitHub comments or reviews. Add `--unattended`, `--auto`, or `--jdi` to the review command when the active session should publish automatically; it then uses `prs tool pr publish-review <pr-number> --report <reportFilePath> --comments <commentsFilePath> --unattended --json`. The workflow does not edit code, commit, push, or resolve comments.

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
