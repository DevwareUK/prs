# CLI Reference

## Command tiers

Run `prs help` or `prs --help` for the same tiered overview in the terminal.

Primary offer commands:

- `prs review`: review the current diff or a branch comparison
- `/prs pr <pr-number> review`: prepare a live PR checkout for deeper local Codex review and write a consolidated report under `.prs/runs`
- `/prs pr <pr-number> address-comments`: prepare selected PR review comments for the active Codex session, then push verified committed fixes with guarded PR-head checks
- `/prs pr <pr-number> fix-tests`: capture failing local verification output, prepare focused artifacts for the active Codex session, then push verified committed fixes with guarded PR-head checks
- `/prs pr <pr-number> add-tests`: prepare selected AI PR test suggestions and their preserved task details, then push verified committed test changes with guarded PR-head checks
- `prs test-backlog`: find high-value automated testing gaps

Advanced commands:

- `prs issue draft --draft-file <path> [--media-manifest <path>]`: ingest a skill-produced issue draft without launching another runtime
- `prs issue refine <number>`: refine an existing GitHub issue into an implementation-ready specification
- `prs issue plan <number> [--refresh]`: maintain an issue-resolution plan comment as secondary execution support
- `prs issue estimate <number>`: estimate the implementation token budget for executing an issue plan
- `prs issue <number>`: run the full local issue-to-PR workflow
- `prs issue prepare <number>` and `prs issue finalize <number>`: split issue setup from local completion

Beta commands:

- `prs issue <number> <number> ...`: fan out unattended issue-to-PR runs in parallel worktrees
- `prs issue batch ...`: compatibility alias for multi-issue unattended runs
- `prs pr resolve-conflicts <pr-number>`: sync a PR branch with its base branch and resolve conflicts in a focused Codex session
- `prs feature-backlog`: find high-value feature opportunities

Supporting commands:

- `prs setup`: guided repository onboarding for `prs`
- `prs setup --update-skills`: refresh only managed Codex `/prs` skills
- `prs update skills`: refresh managed Codex `/prs` skills after upgrading the CLI
- `prs tool issue list [--actionable] --json`: list open GitHub issues, optionally filtered to actionable-for-me issues; returned items include number, title, URL, ownership, labels, update time, linked-PR status, and PRS plan status; PRS plan status recognizes direct managed plan comments and audit comments containing `<!-- prs:issue-plan -->`
- `prs tool issue estimate <issue-number> --json`: return a structured implementation token estimate for the issue's managed plan comment
- `prs tool issue create (--draft-file <path>|--issue-set <path>) --json [--spec-file <path>] [--plan-file <path>] [--media-manifest <path>]`: deterministically create GitHub issues from approved local issue draft artifacts and return managed comment hints for estimate readiness
- `prs tool pr list [--actionable] --json`: list open GitHub pull requests, optionally filtered to actionable-for-me PRs; returned items include number, title, URL, ownership, branch, labels, update time, and action signals such as conflicts
- `prs tool pr ready <pr-number> [--unattended|--auto|--jdi] --json`: local PR readiness for `/prs:pr`; checks out the actual PR head branch, fetches and merges the latest PR base branch, runs configured `prReadiness.commands`, reports local step results in `localReadiness`, reports GitHub-hosted review signals in `prContext`, includes grouped PR comment summaries with source links when comments are available, reports actionable/handled/duplicate/resolved/outdated review-thread counts, and skips broad local verification beyond explicit readiness commands
- `prs tool pr review <pr-number> [--unattended|--auto|--jdi] --json`: deterministic local Codex PR review preparation; checks out/syncs the PR head, writes review context plus prompt artifacts, and returns paths where the active Codex session should write the Markdown report plus structured inline review candidates
- `prs tool pr publish-review <pr-number> --report <path> --comments <path> [--unattended|--auto|--jdi] --json`: publishes the completed local Codex PR review report to the managed PR audit comment and posts high-confidence line-linked review comments on changed lines; unattended aliases add visible automation framing
- `prs tool pr prepare-review <pr-number> --json`: deterministic Codex-safe review preparation
- `prs tool pr address-comments <pr-number> [--selection <value>] --json`: deterministic Codex-safe review-comment fix preparation; writes `.prs/` artifacts and returns file paths without launching a runtime
- `prs tool pr fix-tests <pr-number> --json`: deterministic Codex-safe failing-test fix preparation; captures failing verification output and returns file paths without launching a runtime
- `prs tool pr add-tests <pr-number> [--selection <value>] --json`: deterministic Codex-safe AI-test-suggestion preparation; writes selected-suggestion artifacts and returns file paths without launching a runtime
- `prs tool pr push-reviewed <pr-number> --json`: deterministic guarded push for reviewed PR fix commits; fetches the PR head and pushes only when local `HEAD` is ahead and not behind
- `prs commit`: generate a commit message from staged changes
- `prs diff`: summarize `git diff HEAD`

The old `prs codex ...` command group is retired. Start agentic `/prs` workflows with Codex itself, for example `codex -C <repo> "/prs issue <number> refine"` or `codex exec -C <repo> "/prs pr <number> review"`. Use `prs tool ... --json` for deterministic handoff data inside an active Codex session.

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
prs setup --update-skills
```

Runs a guided repository setup flow for the current Git repository. The command inspects the repo, suggests defaults for `baseBranch`, `forge.type`, `ai.runtime.type`, `ai.issue.useCodexSuperpowers`, `ai.codex.preferSubagents`, `buildCommand`, and extra `aiContext.excludePaths`, prints the detection source for each suggestion, warns when it had to fall back because signals were missing or conflicting, and first offers a one-confirmation "use the recommended setup" path before dropping into per-field prompts when you want to customize values. It writes setup-managed `.prs/config.json` and `.prs/.gitignore`, writes default `ai.profiles` and `ai.roles` routing for delegated Codex work, preserves existing `ai.provider`, `ai.profiles`, `ai.roles`, `localRuntime`, explicit `ai.issue.useCodexSuperpowers` values, and treats legacy `ai.issueDraft.useCodexSuperpowers` as a backward-compatible input. It leaves root `.gitignore` unchanged except for warning when it blocks tracked `.prs` setup files, and only touches `AGENTS.md` when you explicitly opt in to a minimal scaffold for non-obvious repository guidance. Local runtime suggestions are not persisted unless you explicitly confirm or enter them.

`ai.codex.preferSubagents` defaults to `true`. Managed `/prs` Codex skills read the active repository config and treat the enabled or omitted setting as the user's standing request to delegate suitable independent work to subagents when that tool is available. Setting it to `false` opts the repository out; approval gates, sandbox/network restrictions, final coordination, and final verification remain in the main Codex session either way.

`prs setup` does not install or refresh global Codex skills during repository setup. `prs setup --update-skills` skips repository setup prompts and only refreshes managed Codex skills. It is equivalent to `prs update skills`.

When Codex is available locally, setup also checks whether the Superpowers plugin is present under the active `CODEX_HOME` and reports whether Codex Superpowers-backed issue workflows were enabled or disabled. Setup does not install Codex plugins for you.

When `forge.type` is `github`, setup asks whether to enable each recommended pull-request workflow:

- `.github/workflows/prs-pr-review.yml`
- `.github/workflows/prs-pr-assistant.yml`
- `.github/workflows/prs-test-suggestions.yml`

The choices are stored in `.prs/config.json` under `githubActions.workflows.<action-id>.enabled`, where the current action IDs are `pr-review`, `pr-assistant`, and `test-suggestions`. Enabled prs-managed workflows are installed or updated. Disabled prs-managed workflow files are removed so they do not keep running, while disabled unmanaged workflow files are left untouched. Installed workflows reference `DevwareUK/prs/actions/...@main` and require a GitHub repository secret named `OPENAI_API_KEY`. Optional repository variables: `PRS_OPENAI_MODEL` and `PRS_OPENAI_BASE_URL`.

When you opt into the `AGENTS.md` scaffold, setup adds only placeholder prompts such as protected paths, generated files, deployment caveats, and domain rules. It intentionally does not copy repository config values like branch names or build commands into `AGENTS.md`.

The setup flow still expects you to create `.env` yourself because it cannot safely write secrets like `OPENAI_API_KEY`. It also calls out the recommended GitHub/OpenAI/Codex launch path and points advanced users to `bedrock-claude` and `claude-code` as customization paths rather than parity guarantees.

### `prs update skills`

```bash
prs update skills
```

Refreshes the managed Codex `/prs` skills under the active Codex skills directory. Generated skill files include a prs-managed marker and content hash so the CLI can detect stale skills after upgrades. The command updates missing or stale managed skills, leaves current skills unchanged, and skips files at managed paths that do not look like prs-managed skill files. Refreshed skills read repository `ai.roles` and `ai.profiles` for delegated or separate Codex work, but they cannot change the model of an already-open Codex app conversation.

### `prs issue`

Usage:

```bash
prs issue <number> [--unattended|--auto|--jdi|--mode <interactive|unattended>]
prs issue <number> <number> [...number] [--unattended|--auto|--jdi]
prs issue batch <number> <number> [...number] [--unattended|--auto|--jdi]
prs issue draft --draft-file <path> [--rough-idea <text>|--rough-idea-file <path>] [--context <text>] [--context-file <path>] [--superpowers-spec-file <path>] [--superpowers-plan-file <path>] [--media-manifest <path>]
prs issue draft --issue-set-file <path> [--rough-idea <text>|--rough-idea-file <path>] [--context <text>] [--context-file <path>] [--superpowers-spec-file <path>] [--superpowers-plan-file <path>]
prs issue draft --runtime
prs issue refine <number>
prs issue plan <number> [--refresh]
prs issue estimate <number>
prs issue prepare <number> [--mode <local|github-action>]
prs issue finalize <number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `prs issue <number>` | Full local issue-to-PR flow in interactive mode. Preflights the configured forge, verification command, and `baseBranch`, fetches the configured forge issue, creates a missing managed issue plan comment before writing the runtime snapshot, checks the plan's `### Likely files` against files changed by open pull requests, then either prompts you to review or merge overlapping PRs first, branches from the recommended overlapping PR head, or continues from the configured base. It creates the issue branch, writes `.prs/` workspace files, opens the configured interactive runtime, runs the configured build command after that runtime exits, generates deterministic local commit and PR text from the completed issue context for review, and then either creates the commit plus PR title/body text or leaves the branch uncommitted. The finalization step never uses the configured text provider. The completed diff includes tracked changes and included untracked files. Before runtime launch it prints the prepared branch and run artifact directory, reports when the runtime exits back to `prs`, and ends with a branch, commit, PR URL, manual-PR, or skipped-PR summary. Creating the pull request pushes the reviewed issue branch first. Generated PR bodies use a concise change narrative plus issue-closing references, include an `Open PR File Overlap` note when overlap was detected and the run continued, and keep reviewer-operational detail in the managed PR assistant section. |
| `prs issue <number> --unattended` | Full local issue-to-PR flow in unattended mode. `--auto` and `--jdi` are aliases. Requires `ai.runtime.type` to be `codex`, creates a missing managed issue plan comment before writing the runtime snapshot, checks open PR file overlap without prompting, automatically uses the recommended base branch or overlapping PR head, reuses the same per-issue branch and session state as interactive runs, launches Codex non-interactively, includes tracked changes and included untracked files in the generated commit and PR diff, commits with deterministic local commit text automatically, pushes the issue branch through the pull-request creation path, and then opens the pull request with deterministic local PR title/body text. The post-Codex completion step never uses `OPENAI_API_KEY` or any configured text provider. If Codex and verification succeed but no included tracked or untracked files changed, the run records a skipped `no-changes` outcome instead of committing or opening a pull request. When Codex session markers are already present, prs blocks the nested unattended launch and directs the active session to `prs tool issue ready <number> --unattended --json` instead. |
| `prs issue <number> <number> [...number]` | Parallel unattended issue fan-out. Defaults to unattended mode, requires at least two unique issue numbers, creates one isolated worktree per issue from the configured updated `baseBranch`, and launches each issue through the same unattended single-issue path. Parent progress stays under `.prs/batches/` and `.prs/runs/`, while each issue keeps its own `.prs/issues/<number>/session.json` and run artifacts inside its worktree. Completed no-change issues are recorded as completed/skipped `no-changes`; failed child runs are recorded independently, and the parent exits non-zero after all launched issues finish. |
| `prs issue batch <number> <number> [...number]` | Compatibility alias for `prs issue <number> <number> [...number]`. It routes through the same parallel worktree fan-out implementation and keeps the same `.prs/batches/` state key for the ordered issue set. |
| `prs issue draft --draft-file <path>` | Skill-first issue draft ingestion. The active Codex skill writes the implementation-ready Markdown draft, then this command copies it into `.prs/issues/`, writes matching `.prs/runs/<timestamp>-issue-draft/` metadata, prompt, and output log artifacts with `draftProducer: "caller"`, previews the draft, and keeps the normal approve/modify/cancel gate before creating a GitHub issue. It does not launch Codex or Claude. |
| `prs issue draft --issue-set-file <path>` | Skill-first linked issue-set ingestion. The active Codex skill writes an issue-set manifest plus draft files, then this command copies those drafts into the run directory, validates the manifest and Markdown before network writes, previews the set, and creates linked GitHub issues after approval. |
| `prs issue draft --runtime` | Explicit legacy interactive issue drafting flow. Prompts for a rough idea, creates `.prs/` draft-run artifacts, prints that a separate AI session is being opened with only prompt-file context, launches the configured runtime, and then follows the same preview/create flow after the runtime writes a draft or issue set. Prefer `/prs create` plus `--draft-file` or `--issue-set-file` when operating from an existing Codex thread. |
| `prs issue refine <number>` | Interactive existing-issue refinement flow. Fetches the current issue body plus comments, resumes the saved runtime session when that session is still tracked locally, otherwise asks whether to specify changes to the original requirements, defaults to no, only asks for change text when you answer yes, and starts a fresh refinement run, writes resumable state to `.prs/issues/<number>/refine-session.json` plus run artifacts to `.prs/runs/<timestamp>-issue-refine-<number>/`. The runtime may write one refined Markdown draft or a multi-issue set in `.prs/runs/<timestamp>-issue-refine-<number>/issue-set.json`. Single drafts keep the existing behavior: update a PRS-managed source issue or create one linked PRS-managed issue from a non-managed source. Multi-issue refinements are validated and reviewed as a set, then created as PRS-managed linked issues with sibling links and `Source issue: #<number>` entries; the source issue body is not overwritten. If GitHub authentication is unavailable, the refined draft or set is kept on disk instead of being applied. |
| `prs issue plan <number> [--refresh]` | Secondary issue-execution support. By default it creates the managed implementation plan comment once and safely reuses the latest edited managed comment on later runs. Pass `--refresh` or `--update` to regenerate and update the managed comment when the issue context has changed. When `ai.issue.useCodexSuperpowers` is active, the selected runtime is Codex, and local Codex Superpowers is available, the command launches a plan-only Codex run and publishes the resulting `.prs/runs/<timestamp>-issue-plan-<number>/superpowers-plan.md` as the managed `<!-- prs:issue-plan -->` comment. If Superpowers is disabled, unavailable, or produces no plan artifact, `prs` falls back to the structured provider-generated plan. |
| `prs issue estimate <number>` | Reads the issue's managed `<!-- prs:issue-plan -->` comment, scans bounded repository context from concrete likely files plus configured verification commands, compares configured AI profiles including the implementer profile, and prints estimated implementation token ranges, confidence, drivers, warnings, and a recommendation. It does not launch a runtime, call a text provider, modify files, or post to GitHub. If no managed plan exists, it names the expected `<!-- prs:issue-plan -->` marker and asks you to publish a managed plan comment or run `prs issue plan <number>` first. |
| `prs issue prepare <number>` | Preflights the configured forge, verification command, and `baseBranch`, creates a missing managed issue plan comment before writing the runtime snapshot, checks the plan's `### Likely files` against files changed by open pull requests, prompts in interactive terminals when overlap remains, prepares the issue branch from the selected base, and then prints machine-readable JSON describing the run. |
| `prs issue prepare <number> --mode github-action` | Same preparation flow, including missing-plan creation, but writes prompt instructions tailored for non-interactive GitHub Actions runs. |
| `prs issue finalize <number>` | Generates a deterministic local proposed commit message from the current repository diff, including included untracked files, lets you preview, edit, or skip it, and creates the commit only after confirmation. It never uses the configured text provider, so it does not require `OPENAI_API_KEY` just to finalize Codex-produced changes. It does not push or open a pull request. |

Important behavior:

- `prs issue draft --draft-file <path>`, `prs issue draft --issue-set-file <path>`, `prs issue draft --runtime`, `prs issue plan <number> [--refresh]`, `prs issue prepare <number>`, `prs issue finalize <number>`, and full `prs issue <number>` runs print an advanced workflow notice before execution
- `prs issue <number> <number> ...` and `prs issue batch ...` print a beta workflow notice before execution
- `prs issue estimate <number>` is read-only and bounded; it estimates implementation effort from the managed plan rather than drafting/refinement effort
- `/prs create` and `prs issue draft` keep the GitHub issue body concise. After issue creation, `<!-- prs:issue-spec -->` is the managed source-of-truth specification marker and `<!-- prs:issue-plan -->` is the managed implementation plan marker required by `prs issue estimate <number>`. `prs audit publish` comments are audit trail comments, not a substitute for confirming the marker-based managed issue comments.
- `prs tool issue create --json` accepts `--spec-file` and `--plan-file` for approved local artifacts and returns `managedCommentHints` showing which marker comments remain to make the created issue estimate-ready
- Managed active-Codex `/prs issue <number> --unattended`, `--auto`, and `--jdi` runs track actual Codex goal usage when goal tools are available. The skill records `codex-token-usage.json` in the issue run directory, includes available estimate-style model profile metadata such as `standard (gpt-5.4-mini, medium thinking)`, and includes a `token-usage` section in the final PR audit comment during `/prs finish`. This is actual session usage when available, not the forecast returned by `prs issue estimate <number>`.
- `prs issue` requires a clean working tree before it starts
- `prs issue <number>` and `prs issue prepare <number>` fail before checkout if the configured verification command cannot run from the repository root
- `prs issue <number>` and `prs issue prepare <number>` fail before checkout if the configured base branch is missing locally, missing on `origin`, or cannot be fast-forwarded cleanly
- multi-issue runs require at least two unique issue numbers and reject duplicate issue numbers
- `prs issue draft` requires one of `--draft-file`, `--issue-set-file`, or explicit `--runtime`
- `prs issue draft --draft-file <path>` and `prs issue draft --issue-set-file <path>` preview generated drafts in the terminal and only open `$VISUAL`, `$EDITOR`, or `vim` when you explicitly choose modify
- `prs issue draft --runtime` and `prs issue refine <number>` require an available interactive runtime CLI on `PATH`; if the configured non-default runtime is unavailable, `prs` falls back to `codex` when possible
- `prs issue draft --issue-set-file <path>`, `prs issue draft --runtime`, and `prs issue refine <number>` reserve `.prs/runs/<timestamp>-.../issue-set.json`; when present, it must point only to draft files inside the same run directory and all referenced drafts must parse as issue Markdown before prs creates or updates anything remotely
- approved multi-issue sets are created before links are injected, then each created issue is updated with a deterministic `## Linked Issues` section containing real GitHub issue numbers for `dependsOn`, `blocks`, `related`, the set `linkingStrategy`, and the source issue for refinements
- `prs issue <number>`, `prs issue <number> --unattended`, `prs issue prepare <number>`, and each child of a multi-issue run create a missing managed issue plan comment before the issue snapshot is written; if a managed plan comment already exists, whether as a direct managed comment or inside a `prs audit publish` comment, the latest edited comment is used unchanged
- fresh `prs issue <number>`, `prs issue <number> --unattended`, `prs issue prepare <number>`, and each child of a multi-issue run compare the managed plan's concrete `### Likely files` entries with changed files from open pull requests before creating the issue branch; the check is skipped with a concise log message when the plan has no concrete likely files
- interactive local issue runs default to reviewing or merging overlapping pull requests first; if the overlapping PRs are still open after that prompt, `prs` exits before creating the issue branch, and if you continue instead it offers the recommended branch base with an override prompt
- unattended issue runs, multi-issue child runs, and GitHub Action prepare mode never prompt for open PR file overlap; they automatically use the recommended base and add an `Open PR File Overlap` section to generated PR bodies when overlap was detected and the run continued
- full local and unattended issue runs record their final branch, commit, and pull request outcome in the run `metadata.json` and print a final summary with the PR URL, manual PR commands, or the reason PR creation was skipped
- GitHub-visible output follows workflow mode: manual/guided commands publish developer-approved comments without automation framing, while unattended comments add a visible `prs automation note` after any hidden managed marker so update/reuse behavior still finds markers such as `<!-- prs:issue-plan -->`, `<!-- prs:audit -->`, and `<!-- prs:test-suggestions -->`
- issue finalization includes untracked, non-ignored files that are not excluded by `aiContext.excludePaths` when generating commit and pull request text; excluded tracked or untracked paths do not make a run count as changed
- true no-change unattended issue runs record `pullRequest.reason: "no-changes"` in run metadata, print the standard final issue summary, and skip `git commit`, `git push`, and pull request creation
- when `prs issue <number>` or unattended issue execution opens a pull request for a PRS-created linked issue from `prs issue refine <source-number>`, the generated PR body includes closing references for both the linked implementation issue and the original source issue
- `ai.issue.useCodexSuperpowers` affects explicit `prs issue draft --runtime`, `prs issue refine <number>`, and `prs issue plan <number>` and is ignored unless the launched or selected runtime is Codex; legacy `ai.issueDraft.useCodexSuperpowers` is still accepted when the broader setting is absent
- when `ai.issue.useCodexSuperpowers` is active, draft runs keep the final single draft at `.prs/issues/issue-draft-<timestamp>.md` or multi-issue drafts under `.prs/runs/<timestamp>-issue-draft/`, and record reserved Superpowers spec/plan artifact paths under the run directory
- `--media-manifest <path>` can be used with `prs issue draft --draft-file`, `prs tool issue create --draft-file`, or `prs audit publish` to add a Visual References/Visual Evidence section. The manifest is a JSON array or `{ "media": [...] }`; items provide exactly one of `url` or `path`, optional `kind` (`image` or `video`), optional `caption`, and optional `alt`. Supported local files are limited to 25 MB for images and 100 MB for videos. URL images are embedded, URL videos are linked, and tracked repository image/video paths are rendered as raw GitHub URLs for the current branch. Local files that are not tracked in git are validated but omitted from GitHub-facing Markdown until a configured external storage backend exists.
- when `ai.issue.useCodexSuperpowers` is active, refine runs keep the refined single draft or multi-issue draft set under `.prs/runs/<timestamp>-issue-refine-<number>/` and record reserved Superpowers spec/plan artifact paths in the same run directory
- when `ai.issue.useCodexSuperpowers` is active, plan runs reserve `superpowers-spec.md` and `superpowers-plan.md` under `.prs/runs/<timestamp>-issue-plan-<number>/` and publish the non-empty plan artifact to the managed issue plan comment
- if Superpowers-backed issue workflows are enabled but local Codex Superpowers is no longer available, explicit `prs issue draft --runtime`, `prs issue refine <number>`, and `prs issue plan <number>` print a fallback notice and continue with the standard prompt or structured provider-generated plan
- `prs issue refine <number>` stores resumable state at `.prs/issues/<number>/refine-session.json` and keeps run-local prompt, metadata, log, and draft artifacts under `.prs/runs/<timestamp>-issue-refine-<number>/`
- `prs issue refine <number>` resumes a saved tracked runtime session only when the saved runtime still matches, the session is still tracked, and the saved run workspace still exists; otherwise it warns and starts a fresh refinement run
- fresh `prs issue refine <number>` runs ask whether to specify changes to the original requirements, default that prompt to no, and only include requested change text in run prompts and metadata when you answer yes
- `prs issue refine <number>` treats the issue body as the execution source of truth and uses issue comments as refinement context only
- approving a single refined draft updates the source issue only when that issue is already PRS-managed; otherwise `prs issue refine <number>` creates a linked PRS-managed issue and leaves the original issue body untouched
- approving a multi-issue refinement creates linked PRS-managed implementation issues and leaves the source issue body untouched
- declining the apply step, or running without usable GitHub authentication, keeps the refined draft on disk and records the refine session as completed without applying it remotely
- after an approved Superpowers-backed draft or refinement, a non-empty `superpowers-plan.md` creates or updates the managed `<!-- prs:issue-plan -->` issue plan comment; missing or empty plan artifacts are logged and do not block issue creation or refinement
- `prs issue plan <number> [--refresh]` requires issue access through the configured forge; creating or refreshing a managed plan comment also requires the configured provider plus GitHub authentication
- `prs tool issue estimate <issue-number> --json` returns the same estimate as structured JSON for active Codex sessions and automation
- `prs issue finalize <number>` requires local file changes and always uses deterministic local commit text
- local full issue runs require an available interactive runtime CLI on `PATH`
- local full issue runs never use the configured provider for commit or PR text during finalization
- full local issue runs execute the configured `buildCommand`, defaulting to `pnpm build`
- local full issue runs preview the proposed commit message and let you edit or skip it before committing
- local interactive runtime prompts end with an explicit done-state summary, a short note about how to see the result or what was verified, and plain-language next steps
- for local full issue runs, `prs` resumes the build, commit, and PR steps after you exit the runtime
- unattended issue runs require `ai.runtime.type` to be `codex`
- unattended single-issue and multi-issue child runs keep per-issue resume state in `.prs/issues/<number>/session.json`
- multi-issue runs reject `--mode interactive`
- multi-issue runs keep parent progress separately in `.prs/batches/`, record skipped `no-changes` outcomes in the batch state and summary, and skip issues already marked completed on later reruns of the same ordered issue set
- issue preparation checks out the selected branch base and fast-forwards it from `origin`; this is the configured `baseBranch` by default, or an overlapping PR head branch when the overlap recommendation chooses a stacked issue branch
- PR creation uses the selected issue branch base, defaulting to the configured `baseBranch` and using the overlapping PR head branch when the issue branch was prepared from that PR
- GitHub-backed PR creation requires `gh` to be installed and authenticated
- GitHub-backed issue plan comments require `GH_TOKEN` or `GITHUB_TOKEN`, or an authenticated `gh` session, when they are created or refreshed
- if an issue resolution plan comment exists, `prs issue prepare <number>` and full `prs issue <number>` runs copy the latest edited plan into the generated issue snapshot
- when `forge.type` is `github`, issue fetching uses `gh issue view` when available, otherwise the GitHub API
- when `forge.type` is `github`, GitHub API access for issue fetching, plan comments, or issue creation uses `GH_TOKEN` or `GITHUB_TOKEN` when present
- when `forge.type` is `github`, `prs issue draft` can create issues and `prs issue refine <number>` can create linked issues or update PRS-managed issues with either `gh`, `GH_TOKEN`, or `GITHUB_TOKEN`
- when `forge.type` is `none`, issue and PR creation features are disabled for the repository

### `prs pr`

The direct `prs pr prepare-review <pr-number>` launcher is retired. Use `prs tool pr prepare-review <pr-number> --json` for deterministic Codex-safe review preparation, or run Codex directly with `/prs pr <pr-number> review` when you want an agentic review workflow.

The managed `/prs pr <number> review` skill route uses `prs tool pr review <number> --json` to prepare a live PR checkout for deeper local Codex review. The tool writes `.prs/runs/<timestamp>-pr-<number>-review/pr-review-context.md`, `prompt.md`, `metadata.json`, `output.log`, and target `codex-pr-review.md` plus `codex-pr-review-comments.json` paths, then returns those paths without launching a nested runtime. The active Codex session reads the context and prompt, inspects the checked-out repository, writes one consolidated report to `reportFilePath`, writes structured inline review candidates to `commentsFilePath`, presents a concise approval summary, and publishes with `prs tool pr publish-review <number> --report <reportFilePath> --comments <commentsFilePath> --json` only after the user approves posting to GitHub. `/prs pr <number> review --unattended`, `/prs pr <number> review --auto`, and `/prs pr <number> review --jdi` use `prs tool pr review <number> --unattended --json`; their prompt can publish automatically with `prs tool pr publish-review <number> --report <reportFilePath> --comments <commentsFilePath> --unattended --json`, and GitHub-visible output includes automation framing.

The managed `/prs pr <number> address-comments`, `/prs pr <number> fix-tests`, and `/prs pr <number> add-tests` skill routes use the deterministic `prs tool pr ... --json` commands. These commands write `.prs/runs/...` context artifacts and return `promptFilePath`, `snapshotFilePath`, `metadataFilePath`, `outputLogPath`, and `nextAction` for the active Codex session. They do not launch Codex. After active Codex verifies and commits selected fixes, run `prs tool pr push-reviewed <pr-number> --json` to fetch the PR head, check ahead/behind status, and push only when `HEAD` is ahead and not behind `origin/<pr-head-branch>`.

The direct local `prs pr address-comments`, `prs pr fix-tests`, and `prs pr add-tests` commands are Codex-safe preparation aliases. They write the same `.prs/runs/...` artifacts and print the preparation result for the active session without launching a configured runtime, running final verification, committing, or pushing. Compatibility aliases remain during the rename window: `fix-comments` maps to `address-comments`, and `fix-failing-tests` maps to `fix-tests`. The old AI-test-suggestion meaning of `fix-tests` has moved to `add-tests`.

Usage:

```bash
prs tool pr review <pr-number> [--unattended|--auto|--jdi] --json
prs tool pr publish-review <pr-number> --report <path> --comments <path> [--unattended|--auto|--jdi] --json
prs tool pr address-comments <pr-number> [--selection <value>] --json
prs tool pr fix-tests <pr-number> --json
prs tool pr add-tests <pr-number> [--selection <value>] --json
prs tool pr push-reviewed <pr-number> --json
prs pr resolve-conflicts <pr-number>
prs pr address-comments <pr-number>
prs pr fix-tests <pr-number>
prs pr add-tests <pr-number>
```

Available subcommands:

| Command | What it does |
| --- | --- |
| `prs tool pr ready <pr-number> [--unattended\|--auto\|--jdi] --json` | Requires a clean working tree, checks out the actual PR head branch, fetches and merges the latest PR base branch, skips local readiness commands when merge conflicts block base sync, runs configured `.prs/config.json` `prReadiness.commands` in order after a successful base sync, writes each step output under `.prs/runs/<timestamp>-pr-<number>-ready/`, returns `localReadiness.status: "failed"` plus `nextAction: "inspect-local-readiness"` when a command exits non-zero, reports GitHub-hosted PR context in `prContext`, and starts the configured `localRuntime` only for unattended aliases after readiness commands pass. |
| `prs tool pr review <pr-number> [--unattended\|--auto\|--jdi] --json` | Requires a clean working tree, preflights the configured verification command plus the live PR base branch on `origin`, checks out the best available local review branch for the PR, fetches and merges the latest PR base branch when needed, captures linked issues, changed files, diff, checks, issue comments, and review comments when available, writes `pr-review-context.md`, `prompt.md`, `metadata.json`, `output.log`, and target `codex-pr-review.md` plus `codex-pr-review-comments.json` paths, and returns JSON with `nextAction: "write-codex-pr-review-report"` without launching a runtime, editing code, committing, pushing, or resolving comments. The guided prompt tells active Codex to ask for approval before publishing; unattended aliases tell it to publish automatically with visible automation framing. |
| `prs tool pr publish-review <pr-number> --report <path> --comments <path> [--unattended\|--auto\|--jdi] --json` | Requires the completed local Codex PR review report and structured comments JSON, validates comments against the captured review diff, keeps only high-confidence comments anchored to changed right-side diff lines, adds hidden `prs:pr-review-inline` metadata, skips duplicate active PRS-authored findings, publishes the Markdown report through the managed audit comment, and creates a GitHub pull request review when at least one inline comment remains. Unattended aliases apply visible automation framing to the audit comment, review body, and inline review comments. |
| `prs tool pr address-comments <pr-number> [--selection <value>] --json` | Requires a clean working tree, preflights the configured verification command, fetches pull request metadata and lifecycle-aware review threads from the configured forge, filters/group selectable review tasks, defaults `--selection` to `all`, writes `pr-review-comments.md`, `prompt.md`, `metadata.json`, and `output.log`, and returns JSON file paths plus `nextAction: "continue-in-current-codex-session"` without launching a runtime, running final verification, committing, or pushing. |
| `prs tool pr fix-tests <pr-number> --json` | Requires a clean working tree, preflights and runs the configured verification command, exits with `Configured verification command passed. No failing test output was captured.` when it already passes, otherwise writes `failing-tests.md`, `prompt.md`, `metadata.json`, and `output.log`, and returns JSON file paths plus `nextAction: "continue-in-current-codex-session"` without launching a runtime, committing, or pushing. |
| `prs tool pr add-tests <pr-number> [--selection <value>] --json` | Requires a clean working tree, preflights the configured verification command, fetches pull request metadata and PR issue comments, parses unchecked managed AI Test Suggestions, defaults `--selection` to `all`, writes selected-suggestion `pr-test-suggestions.md`, `prompt.md`, `metadata.json`, and `output.log`, and returns JSON file paths plus `nextAction: "continue-in-current-codex-session"` without launching a runtime, marking suggestions resolved, committing, or pushing. |
| `prs tool pr push-reviewed <pr-number> --json` | Requires a clean working tree, fetches pull request metadata, writes `.prs/runs/<timestamp>-pr-<number>-push-reviewed/output.log`, fetches `origin/<pr-head-branch>`, compares `origin/<pr-head-branch>...HEAD`, returns `status: "already-up-to-date"` without pushing when `HEAD` is not ahead, pushes `HEAD:<pr-head-branch>` only when local `HEAD` is ahead and not behind, and fails clearly while keeping local commits when the remote head diverged or cannot be resolved. |
| `prs pr resolve-conflicts <pr-number>` | Requires a clean working tree, requires `codex` on `PATH`, preflights the configured verification command plus the live PR base branch on `origin`, checks out the PR head branch, fetches the latest `origin/<base-branch>` tip, exits without build or push when the checked-out branch already contains that tip, otherwise merges the base branch into the PR head branch, opens a focused Codex conflict-resolution session when the merge conflicts, verifies that the final branch has no in-progress merge or unmerged paths and contains the fetched base tip, runs the configured build command after a completed merge, writes `prompt.md`, `conflict-resolution-prompt.md`, `metadata.json`, and `output.log` under `.prs/runs/<timestamp>-pr-<number>-resolve-conflicts/`, and pushes the resolved branch back to `origin/<pr-head-branch>` only when `HEAD` is ahead and not behind. |
| `prs pr address-comments <pr-number>` | Requires a clean working tree, preflights the configured verification command, fetches pull request metadata and lifecycle-aware review threads from the configured forge, filters out obviously non-actionable comments plus resolved and outdated GitHub review threads, groups nearby threads into selectable review tasks, preserves non-trivial replies as thread context, suppresses duplicate PRS-authored bot findings and PRS-authored bot threads that predate the latest successful `address-comments` or legacy `fix-comments` commit unless a newer reply reopened the concern, writes `pr-review-comments.md`, `prompt.md`, `metadata.json`, and `output.log`, and prints file paths plus `nextAction: "continue-in-current-codex-session"` without launching a runtime, committing, resolving comments, or pushing. |
| `prs pr fix-tests <pr-number>` | Requires a clean working tree, preflights and runs the configured verification command, fetches pull request metadata and linked issues from the configured forge, exits with `Configured verification command passed. No failing test output was captured.` when verification already passes, otherwise writes `.prs/runs/<timestamp>-pr-<number>-fix-tests` artifacts with captured stdout and stderr and prints file paths plus `nextAction: "continue-in-current-codex-session"` without launching a runtime, rerunning final verification, committing, or pushing. |
| `prs pr add-tests <pr-number>` | Requires a clean working tree, preflights the configured verification command, fetches pull request metadata and PR issue comments from the configured forge, finds the managed AI Test Suggestions comment, parses unchecked structured suggestion tasks including behavior, regression risk, protected paths, likely locations, edge cases, and implementation notes, writes focused `.prs/` run artifacts, and prints file paths plus `nextAction: "continue-in-current-codex-session"` without launching a runtime, marking suggestions resolved, committing, or pushing. |

Important behavior:

- `prs pr resolve-conflicts <pr-number>` prints a beta workflow notice before execution
- `prs tool pr review <pr-number> --json` requires a clean working tree before it starts and does not require a configured runtime CLI on `PATH`
- `prs tool pr ready <pr-number> --json` runs configured PR local readiness commands during attended readiness because attended PR preparation is meant to make the checkout usable for local browsing and visual testing
- `prs tool pr ready <pr-number> --json` does not run configured PR local readiness commands when base sync is blocked by merge conflicts
- `prs pr resolve-conflicts <pr-number>` requires a clean working tree before it starts
- `prs pr address-comments <pr-number>` requires a clean working tree before it starts
- `prs pr address-comments <pr-number>` ignores resolved and outdated GitHub review threads by default; when only old PRS-authored bot comments remain after a successful fix run and checks are green, it exits with a no-new-actionable-comments message instead of opening another fix cycle
- `prs pr fix-tests <pr-number>` requires a clean working tree before it starts
- `prs pr add-tests <pr-number>` requires a clean working tree before it starts
- `prs tool pr review <pr-number> --json`, `prs pr resolve-conflicts <pr-number>`, `prs pr address-comments <pr-number>`, `prs pr fix-tests <pr-number>`, and `prs pr add-tests <pr-number>` fail early when the configured verification command cannot run from the repository root
- `prs pr resolve-conflicts <pr-number>` requires `codex` on `PATH` for the guided conflict-resolution session
- `prs pr resolve-conflicts <pr-number>` validates that the live PR base branch still exists on `origin` before it checks out or fetches the PR head branch
- `prs pr resolve-conflicts <pr-number>` checks out the local PR head branch when it already exists, or fetches the PR head from `origin` into a same-named local branch so it can be pushed back to `origin/<pr-head-branch>`
- after checkout, `prs tool pr review <pr-number> --json` fetches the latest `origin/<pr-base-branch>` tip and records whether the branch was already current, cleanly merged, or blocked by conflicts
- after checkout, `prs pr resolve-conflicts <pr-number>` fetches the latest `origin/<pr-base-branch>` tip and records whether the PR branch was already current, cleanly merged, or blocked by conflicts
- if the resolve-conflicts base merge conflicts, `prs pr resolve-conflicts <pr-number>` writes `conflict-resolution-prompt.md`, opens a focused Codex conflict-resolution session, and fails with recovery guidance if a merge is still in progress, unmerged paths remain, or `HEAD` does not contain the fetched base tip after Codex exits
- `prs tool pr review <pr-number> --json` writes a prompt that asks active Codex to separate blocking concerns, non-blocking concerns, test/QA gaps, rollout/documentation concerns, and evidence/confidence for each finding in `codex-pr-review.md`, write high-confidence line-linked comments to `codex-pr-review-comments.json`, then ask for approval before publishing through `prs tool pr publish-review`
- `prs pr resolve-conflicts <pr-number>` writes `prompt.md`, `conflict-resolution-prompt.md`, `metadata.json`, and `output.log` under `.prs/runs/<timestamp>-pr-<number>-resolve-conflicts/`
- after a clean or Codex-resolved resolve-conflicts merge, `prs pr resolve-conflicts <pr-number>` runs the configured build command before pushing
- after a completed resolve-conflicts merge, `prs pr resolve-conflicts <pr-number>` fetches `origin/<pr-head-branch>` and only pushes when `HEAD` is ahead and not behind; if the branch diverged or the remote head cannot be resolved, the command fails clearly and keeps the local branch state
- local PR comment-fix and test-addition preparation runs do not require a configured runtime CLI on `PATH`
- local PR failing-test-fix preparation runs do not require a configured runtime CLI on `PATH`; they run the configured verification command once to capture the initial failure
- PR comment-fix and test-addition preparation runs preflight the configured `buildCommand`, defaulting to `pnpm build`; failing-test-fix preparation runs execute it once before writing artifacts and exits without a run directory if it already passes
- `prs pr fix-tests <pr-number>` writes `failing-tests.md`, `prompt.md`, `metadata.json`, and `output.log` under `.prs/runs/<timestamp>-pr-<number>-fix-tests` after an initial verification failure; passing initial verification does not create a no-op run directory
- `prs pr add-tests <pr-number>` offers only unchecked AI Test Suggestions checklist items; if every managed suggestion is already checked, it exits with `All managed AI test suggestions are already addressed.`
- the direct PR fix preparation commands do not update managed PR comments, commit, or push; after making changes in the active Codex session, finish through the normal verification, commit, push, and audit flow
- `prs pr add-tests <pr-number>` does not update the managed AI Test Suggestions PR comment after local fixes; the GitHub Action owns checking addressed suggestions when it next evaluates the PR
- after an active Codex `/prs pr <number> ...` PR handoff has verified and committed changes, `prs tool pr push-reviewed <pr-number> --json` performs that same guarded fetch/ahead-behind/push check without launching another runtime
- local PR fix prompts end with an explicit done-state summary, a short note about how to see the result or what was verified, and plain-language next steps
- the command expects the relevant PR branch to already be checked out locally before the active session starts editing
- the interactive comment selector accepts numbered thread choices, grouped task choices like `g1` when available, `all`, `none`, and blank input; pressing Enter selects every individual thread
- `prs pr add-tests <pr-number>` accepts `all`, `none`, blank input, or a comma-separated suggestion list like `1,2`; pressing Enter selects every suggestion
- managed AI test suggestions now carry behavior covered, regression risk, suggested test type, protected paths, suggestion-level edge cases, and a short implementation note so the selected snapshot can be used directly as implementation guidance
- when `forge.type` is `github`, PR fetching uses `gh pr view` when available, otherwise the GitHub API
- when `forge.type` is `github`, GitHub API access for PR metadata, review comments, review thread lifecycle state, and PR issue comments uses `GH_TOKEN` or `GITHUB_TOKEN` when present
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
| `--create-issues` | Creates or reuses issues for the highest-priority findings through the configured forge without the interactive prompt. |
| `--max-issues <count>` | Limits how many issues are offered or created. Default: `3`, capped to `--top`. |
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

- reports include the current testing setup, detected frameworks, CI test integration status, and supporting evidence where available
- when no suitable unit or integration framework is detected, the report recommends a default framework with repository-specific rationale and concise alternatives
- CI assessment distinguishes missing, partial, and established test integration so local-only or manual-only test commands do not look fully enforced
- mature or unsupported repository shapes can return an empty findings list instead of forcing a placeholder issue
- Drupal repositories with custom themes or custom modules receive focused findings for repository-owned behavior even when broad theme or module tests already exist elsewhere
- in interactive Markdown mode, after printing findings, `prs` asks whether to create GitHub issues and which numbered findings to create
- when `--create-issues` is enabled, generated issue bodies include implementation steps, first tests to add, target paths, and acceptance criteria for focused backlog items
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
