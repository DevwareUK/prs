# Codex and prs Workflows

This guide is for operators using `prs` from Codex, the Codex CLI, or Codex-backed repository automation.

The recommended launch path remains GitHub forge, OpenAI provider, and Codex runtime. Other providers and runtimes are supported in specific places, but the product does not present them as full parity paths.

## Runtime boundaries

Codex is the default interactive runtime when `ai.runtime.type` is unset.

Managed `/prs` Codex skills also read `ai.codex.preferSubagents` from the active repository `.prs/config.json`. The setting defaults to `true`; when it is enabled or omitted, that repository config is treated as the user's standing request to delegate suitable independent tasks to subagents when the subagent tool is available. Setting it to `false` opts the repository out. Subagents are for independent exploration, implementation, review, or verification work; approval gates, sandbox/network restrictions, final coordination, and final verification stay in the main Codex session.

Managed `/prs` skills also resolve `ai.roles` through `ai.profiles` for the active workflow role before delegating or launching separate Codex work. Roles are `planner`, `implementer`, `reviewer`, and `tester`; default setup routes planner/reviewer to the `premium` profile and implementer/tester to the `standard` profile. The already-open Codex app conversation keeps the model and thinking level selected in that app window; if a configured role profile cannot be applied to delegated or separate work, the skill should report that blocker instead of silently continuing with the app window model.

Runtime-specific behavior:

- `prs pr resolve-conflicts <pr-number>` always requires `codex` on `PATH` for guided merge-conflict resolution, even though Codex only opens when the base merge conflicts.
- `prs issue <number> --unattended` and multi-issue `prs issue <number> <number> ...` require `ai.runtime.type` to be `codex`.
- Interactive local workflows such as `prs issue refine <number>` and `prs issue <number>` use the configured runtime, with fallback to Codex when a configured non-default runtime is unavailable. PR fix commands prepare handoff artifacts for the active Codex session and do not launch another runtime. `prs issue draft --draft-file <path>` ingests a draft from the active Codex skill context and does not launch another runtime.
- Legacy unattended issue commands launch `codex exec` only from an outer terminal or automation context. When Codex session markers are already present, prs blocks the nested launch and tells the active session to use `prs tool issue ready <issue-number> --unattended --json` instead.
- Structured-text workflows such as `prs commit`, `prs diff`, `prs review`, and provider-backed issue-plan generation use the configured provider, defaulting to OpenAI. Codex-first issue finalization never uses the configured provider; Codex performs the repository work, and `prs` uses deterministic local commit and PR text for the CLI-owned final step.

The `prs codex ...` nested launcher group is retired. From a shell, run Codex directly with the `/prs` skill request:

```bash
codex -C /path/to/repo "/prs issue <number> refine"
codex exec -C /path/to/repo "/prs pr <number> review"
```

GitHub Actions in this repository are OpenAI-only today. They do not expose Bedrock Claude or runtime-selection inputs.

## Using `/prs` from Codex

Use the local `prs` skill aliases as workflow routing, not as a separate command surface. The CLI command surface remains the source of truth:

```bash
prs issue draft --draft-file <path>
prs issue refine <number>
prs issue plan <number> [--refresh]
prs issue <number> [--unattended|--auto|--jdi|--mode <interactive|unattended>]
prs issue <number> <number> [...number] [--unattended|--auto|--jdi]
prs tool pr review <pr-number> [--unattended|--auto|--jdi] --json
prs tool pr publish-review <pr-number> --report <path> --comments <path> [--unattended|--auto|--jdi] --json
prs tool pr push-reviewed <pr-number> --json
prs tool worktrees cleanup [--apply] --json
```

For `/prs create` and `/prs create issue`, keep drafting in the active Codex conversation. The skill should inspect the repository, ask any necessary clarifying questions, write the issue draft or issue-set manifest itself, and call `prs issue draft --draft-file <path>` or `prs issue draft --issue-set-file <path>` only to persist artifacts, preview the result, and create GitHub issues after approval. Use `prs issue draft --runtime` only when a human explicitly wants a separate drafting session with prompt-file context.

Managed issue workflows track available token telemetry in one managed `<!-- prs:token-usage -->` comment per issue. `/prs create`, `/prs issue <number> refine`, `/prs issue <number> estimate`, and `/prs issue <number>` implementation/finalization runs keep per-run `codex-token-usage.json` evidence or estimate artifacts under `.prs/runs`. Actual usage publishes with `prs tool token-usage publish --issue <number> --file <path> --json`; estimates publish with `prs tool issue publish-estimate <number> --file <path> --json`. A token artifact may contain one entry or an `entries` array for multiple Codex goals/sessions in the same run; each entry should carry a stable `id` for its workflow phase plus current run/session. The managed GitHub comment is the merge source of truth: each publish fetches the current comment, upserts only the entry IDs from the current artifact, preserves rows from other machines/runs, and rewrites separate visible usage and estimate tables plus hidden structured ledger data. Estimate publication adds forecast rows without deleting actual usage rows. In active Codex app sessions, `/prs create` and `/prs issue <number> refine` create or reuse a planner-scoped Codex goal, verify `get_goal` can see the active goal before drafting/refining continues, and call `get_goal` again before writing `codex-token-usage.json`; token totals from `tokensUsed` or `usage.totalTokens` are recorded as tracked usage, and unavailable rows are reserved for cases where no active goal is visible or the goal usage fields are genuinely unavailable. Raw per-run details and estimate rationale stay in the local artifact and hidden structured ledger data. The deterministic `prs tool issue create --json` result includes `tokenUsageComments` when it publishes `codex-token-usage.json` from the supplied `--run-dir`; that publication happens before managed spec/plan comments. Model names prefer actual Codex session metadata when available; configured role/profile models are shown only as fallback provenance. The ledger is available run/session telemetry and planning forecasts, not exact billing.

`/prs cleanup worktrees` is the safe cleanup route for PRS-managed worktrees. It runs `prs tool worktrees cleanup --json` first, summarizes the candidates in plain language, and only applies removals when the operator explicitly requests it or approves the dry-run report. The tool only removes clean PRS-managed worktrees that cannot lose user work.

For no-number `/prs issue` and `/prs pr`, use `prs tool issue list [--actionable] --json` and `prs tool pr list [--actionable] --json` as the source of truth. The returned items include a `url` field; show each item with its number, title, and GitHub URL before offering follow-up actions.

For `/prs pr <number> review`, keep the review in the active Codex conversation. The skill should run `prs tool pr review <number> --json`, read the returned `promptFilePath` and `contextFilePath`, inspect the prepared checkout, write the consolidated Markdown report to `reportFilePath`, write structured line-linked review candidates to `commentsFilePath`, and present a concise approval summary before posting anything to GitHub. Only after the user approves should it run `prs tool pr publish-review <number> --report <reportFilePath> --comments <commentsFilePath> --json`. The publish tool updates the managed PR audit comment and creates real GitHub inline review comments for high-confidence candidates that anchor to changed right-side diff lines. This workflow must not edit code, commit, push, resolve comments, or post directly to GitHub outside the approved managed publish tool.

For `/prs pr <number> review --unattended`, `/prs pr <number> review --auto`, or `/prs pr <number> review --jdi`, run `prs tool pr review <number> --unattended --json`. The returned prompt may publish automatically with `prs tool pr publish-review <number> --report <reportFilePath> --comments <commentsFilePath> --unattended --json`; GitHub-visible output must keep visible automation framing.

For `/prs pr <number> address-comments`, `/prs pr <number> fix-tests`, and `/prs pr <number> add-tests`, keep the fix work in the active Codex conversation. The skill should run the deterministic `prs tool pr <action> <number> --json` preparation command, read the returned prompt and snapshot, apply the selected fixes, run configured verification, commit reviewed changes, and then run `prs tool pr push-reviewed <number> --json`. That final tool fetches the PR head, checks ahead/behind status, and pushes only when `HEAD` is ahead and not behind `origin/<pr-head-branch>`.

When the Codex skill alias `/prs issue <number> --unattended` is requested, treat it as an operator workflow. `--auto` and `--jdi` are equivalent aliases. The intended end-to-end path is:

1. inspect the issue and verify the implemented command surface from source
2. work from an updated `origin/<baseBranch>` rather than the user's current checkout
3. keep prompts, metadata, logs, and local artifacts under `.prs/runs/`
4. make the implementation in an issue branch or isolated worktree
5. run the configured verification command
6. commit, push, and open or update a pull request

For one issue, the built-in `prs issue <number> --unattended` path prepares a branch, launches Codex non-interactively, verifies, commits, pushes, and opens a pull request when it is run from an outer terminal or automation context. From inside an active Codex session, use `prs tool issue ready <number> --unattended --json` and continue the implementation in that session instead of launching the built-in unattended path. For multiple issues, `prs issue <number> <number> ...` creates one isolated worktree per issue from the configured updated `baseBranch`; the older batch spelling remains documented only as a compatibility alias in the CLI reference.

When the active Codex app exposes goal tools, `/prs issue <number> --unattended`, `/prs issue <number> --auto`, and `/prs issue <number> --jdi` should create or reuse an issue-scoped goal such as `Complete PRS issue #<number>: <title>`. During `/prs finish`, capture the latest available usage and estimate-style model profile metadata into `codex-token-usage.json` in the issue run directory and update the original issue's managed `<!-- prs:token-usage -->` comment with `prs tool token-usage publish --issue <number> --file <path> --json`. Model metadata should mirror `prs issue estimate` profile formatting, such as `standard (gpt-5.4-mini, medium thinking)` for the default implementer profile or `premium (gpt-5.5, high thinking)` for premium-profile work, but actual active Codex session metadata wins over configured fallback profile data. The `.prs/runs/.../codex-token-usage.json` artifact is the workflow source of truth. Codex goal data may populate it, but the token-usage comment must be published before the skill marks the goal or managed run complete. This is actual available run/session telemetry, not exact billing and not the forecast from the managed plan.

GitHub-visible output should match that mode split. Manual/guided output is treated as developer-approved and does not include automation framing. Unattended output can be posted directly, but managed issue comments, audit comments, local PR review comments, and test suggestion comments include a visible `prs automation note` after any hidden marker.

## Superpowers-backed issue planning

`ai.issue.useCodexSuperpowers` controls Superpowers-backed issue refine and plan workflows, plus any explicit legacy `prs issue draft --runtime` run.

When it is enabled and the selected runtime is Codex:

- `prs issue draft --runtime` can use Codex Superpowers-specific instructions while keeping final drafts under `.prs/issues/` or the current draft run directory.
- `prs issue refine <number>` can use Superpowers-specific instructions while keeping refined drafts and optional issue sets under `.prs/runs/<timestamp>-issue-refine-<number>/`.
- `prs issue plan <number> [--refresh]` reserves `superpowers-spec.md` and `superpowers-plan.md` under `.prs/runs/<timestamp>-issue-plan-<number>/` and publishes a non-empty plan artifact to the managed `<!-- prs:issue-plan -->` issue comment.
- `/prs issue <number> estimate` reads the managed `<!-- prs:issue-plan -->` comment through `prs tool issue estimate-context <number> --json`, has the active Codex session estimate implementation token usage from the plan across configured AI profiles, and publishes the Codex-authored JSON artifact to the managed token telemetry comment with `prs tool issue publish-estimate <number> --file <path> --json`. `prs tool issue estimate <number> --json` remains a deterministic compatibility estimate for non-Codex automation.
- The deterministic compatibility estimate includes rough USD cost ranges calculated from PRS model-rate defaults, an 80% input / 20% output token split, and any `.prs/config.json` `ai.costEstimates` overrides; JSON output identifies the priced token range and formula for each cost range.

Issue plans should include an explicit `.prs/config.json` `prReadiness.commands` update when the work introduces required local checkout setup for future PR testing, such as migrations, config import, generated assets, dependency updates, or cache rebuilds.

If Superpowers is unavailable or produces no plan artifact, `prs` prints a fallback notice and continues with the standard prompt or structured provider-generated plan.

## Local artifacts

`.prs/config.json` and `.prs/.gitignore` are setup-managed repository files. Generated `.prs/` workflow state should stay local and is ignored through `.prs/.gitignore`.

Typical paths:

- `.prs/runs/`: prompts, metadata, logs, output snapshots, and Superpowers spec/plan artifacts
- `.prs/issues/`: issue snapshots, generated drafts, and per-issue session state
- `.prs/batches/`: multi-issue run state
- `.prs/worktrees/`: generated issue worktrees for parallel issue runs

For Codex planner and implementation runs, `codex-token-usage.json` may appear in the run directory. It records whether actual token usage was `tracked`, `partial`, or `unavailable`, workflow identity, available workflow role/profile/tier/model/thinking metadata, capture phase, publication state, and usage fields exposed by the active Codex environment. Create, refine, estimate, implementation, and finalization artifacts all contribute rows to the issue-lifetime managed `<!-- prs:token-usage -->` comment on the created/source/original issue, not the pull request audit. The `.prs/runs/.../codex-token-usage.json` artifact is the workflow source of truth. Codex goal data may populate it, but the relevant token-usage comment must be published before the skill marks the goal or managed run complete.

For Codex-guided local fix workflows, the most useful files are usually `prompt.md`, `metadata.json`, `output.log`, and the preserved source snapshot such as `pr-review-comments.md` or `pr-test-suggestions.md`.

## GitHub Actions issue-to-PR flow

The manual `.github/workflows/issue-to-pr.yml` workflow:

1. builds the CLI
2. runs `node packages/cli/dist/index.js issue prepare "$ISSUE_NUMBER" --mode github-action`
3. runs `openai/codex-action@v1` with the prepared prompt file
4. runs `pnpm build`
5. runs `node packages/cli/dist/index.js issue finalize "$ISSUE_NUMBER"`
6. pushes the issue branch
7. creates or reuses a pull request
8. comments on the issue with the PR link

The workflow requires `OPENAI_API_KEY` for `openai/codex-action@v1` and uses the repository `GITHUB_TOKEN` for issue and pull request writes. The final `prs issue finalize` step itself never uses a configured text provider.
