# Codex and prs Workflows

This guide is for operators using `prs` from Codex, the Codex CLI, or Codex-backed repository automation.

The recommended launch path remains GitHub forge, OpenAI provider, and Codex runtime. Other providers and runtimes are supported in specific places, but the product does not present them as full parity paths.

## Runtime boundaries

Codex is the default interactive runtime when `ai.runtime.type` is unset.

Runtime-specific behavior:

- `prs codex pr prepare-review <pr-number>` always requires `codex` on `PATH`.
- `prs pr resolve-conflicts <pr-number>` always requires `codex` on `PATH` for guided merge-conflict resolution, even though Codex only opens when the base merge conflicts.
- `prs issue <number> --mode unattended`, multi-issue `prs issue <number> <number> ...`, and `prs issue batch ...` require `ai.runtime.type` to be `codex`.
- Interactive local workflows such as `prs issue refine <number>` and `prs issue <number>` use the configured runtime, with fallback to Codex when a configured non-default runtime is unavailable. PR fix commands prepare handoff artifacts for the active Codex session and do not launch another runtime. `prs issue draft --draft-file <path>` ingests a draft from the active Codex skill context and does not launch another runtime.
- Structured-text workflows such as `prs commit`, `prs diff`, `prs review`, issue-plan generation, commit-message generation, and PR text generation use the configured provider, defaulting to OpenAI.

GitHub Actions in this repository are OpenAI-only today. They do not expose Bedrock Claude or runtime-selection inputs.

## Using `/prs` from Codex

Use the local `prs` skill aliases as workflow routing, not as a separate command surface. The CLI command surface remains the source of truth:

```bash
prs issue draft --draft-file <path>
prs issue refine <number>
prs issue plan <number> [--refresh]
prs issue <number> [--mode <interactive|unattended>]
prs issue <number> <number> [...number] [--mode unattended]
prs issue prepare <number> [--mode <local|github-action>]
prs issue finalize <number>
prs tool pr push-reviewed <pr-number> --json
```

For `/prs create` and `/prs create issue`, keep drafting in the active Codex conversation. The skill should inspect the repository, ask any necessary clarifying questions, write the issue draft or issue-set manifest itself, and call `prs issue draft --draft-file <path>` or `prs issue draft --issue-set-file <path>` only to persist artifacts, preview the result, and create GitHub issues after approval. Use `prs issue draft --runtime` only when a human explicitly wants a separate drafting session with prompt-file context.

For `/prs pr <number> fix-comments`, `/prs pr <number> fix-failing-tests`, and `/prs pr <number> fix-tests`, keep the fix work in the active Codex conversation. The skill should run the deterministic `prs tool pr fix-* <number> --json` preparation command, read the returned prompt and snapshot, apply the selected fixes, run configured verification, commit reviewed changes, and then run `prs tool pr push-reviewed <number> --json`. That final tool fetches the PR head, checks ahead/behind status, and pushes only when `HEAD` is ahead and not behind `origin/<pr-head-branch>`.

When the Codex skill alias `/prs issue <number> --all` is requested, treat it as an operator workflow rather than a literal CLI flag. The intended end-to-end path is:

1. inspect the issue and verify the implemented command surface from source
2. work from an updated `origin/<baseBranch>` rather than the user's current checkout
3. keep prompts, metadata, logs, and local artifacts under `.prs/runs/`
4. make the implementation in an issue branch or isolated worktree
5. run the configured verification command
6. commit, push, and open or update a pull request

For one issue, the built-in `prs issue <number> --mode unattended` path prepares a branch, launches Codex non-interactively, verifies, commits, pushes, and opens a pull request. For multiple issues, `prs issue <number> <number> ...` and `prs issue batch ...` create one isolated worktree per issue from the configured updated `baseBranch`.

## Superpowers-backed issue planning

`ai.issue.useCodexSuperpowers` controls Superpowers-backed issue refine and plan workflows, plus any explicit legacy `prs issue draft --runtime` run.

When it is enabled and the selected runtime is Codex:

- `prs issue draft --runtime` can use Codex Superpowers-specific instructions while keeping final drafts under `.prs/issues/` or the current draft run directory.
- `prs issue refine <number>` can use Superpowers-specific instructions while keeping refined drafts and optional issue sets under `.prs/runs/<timestamp>-issue-refine-<number>/`.
- `prs issue plan <number> [--refresh]` reserves `superpowers-spec.md` and `superpowers-plan.md` under `.prs/runs/<timestamp>-issue-plan-<number>/` and publishes a non-empty plan artifact to the managed `<!-- prs:issue-plan -->` issue comment.

If Superpowers is unavailable or produces no plan artifact, `prs` prints a fallback notice and continues with the standard prompt or structured provider-generated plan.

## Local artifacts

The `.prs/` directory is repository-local working state and should stay gitignored.

Typical paths:

- `.prs/runs/`: prompts, metadata, logs, output snapshots, and Superpowers spec/plan artifacts
- `.prs/issues/`: issue snapshots, generated drafts, and per-issue session state
- `.prs/batches/`: multi-issue run state

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

The workflow requires `OPENAI_API_KEY` and uses the repository `GITHUB_TOKEN` for issue and pull request writes.
