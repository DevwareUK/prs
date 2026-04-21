# Launch Demo Guide

Use this guide when you need to show the first-offer `git-ai` workflows to a consulting buyer without dragging them through the full technical README.

The goal is not to prove that every automation path exists. The goal is to show a tight GitHub-first loop that earns trust in stages:

1. better pull request signal
2. better test guidance
3. local pre-review before edits
4. guided fixes from live review comments
5. guided fixes from managed test suggestions
6. repository-wide testing backlog once the narrower loop is trusted

## Recommended Demo Order

| Step | Surface | What to show | Why it builds trust | Trust boundary |
| --- | --- | --- | --- | --- |
| 1 | `actions/pr-review` and `actions/pr-assistant` | Show the AI pre-review comment and the managed PR assistant section in the pull request body. | Starts in GitHub, on the live PR, with visible reviewer-facing output and no code changes. | GitHub Action reads PR diff context and writes comments or PR body text. It does not check out a developer branch or edit repository files. |
| 2 | `actions/test-suggestions` | Show the managed AI test suggestions comment for the same pull request. | Extends the story from “what looks risky” to “what should we test next” without changing code. | GitHub Action reads PR diff context and writes a PR comment only. |
| 3 | `git-ai review --base origin/main` | Run the local review against the checked-out branch and compare the result with the GitHub review signal. | Shows that the team can get review value locally before granting AI edit authority. | Local diff analysis only. No branch switching, no `.git-ai/runs/` handoff, no code writes. |
| 4 | `git-ai pr fix-comments <pr-number>` | Pull selected GitHub review comments into a focused local fix flow. | This is the first guided write path, but it stays tightly scoped to chosen review tasks. | Requires a clean working tree, GitHub PR access, and an interactive runtime. Writes a timestamped `.git-ai/runs/` directory, then proposes a reviewed commit before pushing updated PR code. |
| 5 | `git-ai pr fix-tests <pr-number>` | Pull selected items from the managed AI test suggestions comment into a focused local testing flow. | Proves that AI can move from review signal to concrete automated test work with preserved task context. | Same local trust boundary as comment fixing, but the source of truth is the managed test-suggestions comment. Writes a dedicated `.git-ai/runs/` directory before the runtime session starts. |
| 6 | `git-ai test-backlog --top 5` | Generate the highest-value repo-wide testing gaps after the PR flows have landed. | Expands from one pull request to a broader backlog only after the buyer has seen the narrower review-and-fix loop work. | Repository scan and report generation. Keep `--create-issues` out of the first demo unless the buyer explicitly wants backlog issue creation. |

## Suggested Talk Track

Use the same pull request all the way through the first five steps. That keeps the buyer anchored on one change instead of forcing them to re-learn context between tools.

Open with the GitHub Actions outputs because they are the lowest-risk proof points. They show immediate value in the place reviewers already work. Then move to `git-ai review` to show that the local CLI can surface similar signal without editing code. Only after that should you cross the trust boundary into `git-ai pr fix-comments <pr-number>` and `git-ai pr fix-tests <pr-number>`, where the runtime is allowed to make scoped changes on the checked-out PR branch.

End with `git-ai test-backlog --top 5` as the “what comes next” view. It broadens the story from a single PR to sustained quality improvement without jumping straight into unattended issue automation.

## Audit Trail Story

For the first-offer flows, `.git-ai/` is part of the product story. It gives the operator concrete local artifacts to inspect instead of asking them to trust a black box.

Relevant paths:

- `.git-ai/config.json`: repository-level defaults such as `ai.provider.type`, `ai.runtime.type`, `baseBranch`, and `buildCommand`
- `.git-ai/runs/`: timestamped workflow directories for local guided runs
- `.git-ai/issues/`: issue snapshots, generated drafts, and unattended per-issue session state
- `.git-ai/batches/`: unattended batch queue state

For buyer demos, the most useful proof point is a local PR fix run directory such as:

- `.git-ai/runs/<timestamp>-pr-<pr-number>-fix-comments/`
- `.git-ai/runs/<timestamp>-pr-<pr-number>-fix-tests/`

Those directories contain a practical audit trail:

- `prompt.md`: the exact coding-agent instructions for that run
- `metadata.json`: pull request identifiers, selected tasks or suggestions, and artifact paths
- `output.log`: command and runtime log output captured during the handoff
- `pr-review-comments.md` or `pr-test-suggestions.md`: the preserved source snapshot that the runtime was told to use

If you need to prove that the runtime worked from selected context rather than from vague intent, open `metadata.json` and the snapshot file side by side after a fix run.

## First-Offer Onboarding Notes

Keep the onboarding story narrow and opinionated:

- Repository scope: GitHub repositories and GitHub pull requests only. This is not positioned as a multi-forge launch.
- Recommended provider path: use the default `openai` provider first. The GitHub Actions in this repo take OpenAI inputs directly, so OpenAI is the cleanest first demo path across actions and CLI usage.
- Recommended runtime path: use the default `codex` interactive runtime for `git-ai pr fix-comments <pr-number>` and `git-ai pr fix-tests <pr-number>`.
- Deeper-launch options: `bedrock-claude` and `claude-code` are supported, but they are not the simplest first-offer setup and should stay out of the first demo unless the buyer already requires them.
- Local prerequisites: `git`, Node.js, `pnpm`, the `git-ai` CLI linked from this repository, `codex` on `PATH` for interactive fix workflows, and GitHub authentication for PR-backed local commands.
- Repository setup expectation: run `git-ai setup` in the target repository so `.git-ai/config.json`, `.gitignore`, and optional managed `AGENTS.md` guidance are aligned before the first live fix workflow.
- Pull request setup expectation: for `git-ai pr fix-comments <pr-number>` and `git-ai pr fix-tests <pr-number>`, have the PR branch checked out locally and keep the working tree clean.

## Commands To Keep Out Of The First Demo

Do not mix these into the primary buyer journey unless the buyer asks for broader automation:

- Advanced: `git-ai issue draft`, `git-ai issue plan <number> [--refresh]`, `git-ai issue prepare <number>`, `git-ai issue finalize <number>`, `git-ai issue <number>`
- Beta: `git-ai issue batch <number> <number> [...number]`, `git-ai pr prepare-review <pr-number>`, `git-ai feature-backlog`

Those commands are real and supported, but they ask the buyer to trust wider branch automation, issue orchestration, or higher-variance repository discovery earlier than the first-offer path needs.
