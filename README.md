# git-ai

AI tooling for Git workflows, including a CLI and GitHub Actions.

Pull request workflows in this repo currently cover AI PR descriptions, review summaries, test suggestions, and repo-wide test backlog generation.

## Local Setup

Install dependencies:

```bash
pnpm install
```

Create a `.env` file in the repo root:

```bash
cp .env.example .env
```

Then set your OpenAI API key:

```env
OPENAI_API_KEY=your_key_here
```

The CLI tools and Husky commit hook will read environment variables from this file.

Example usage:

```bash
git-ai commit
```

This will generate a commit message from the staged diff.

```bash
git-ai diff
```

This will summarize the current `git diff HEAD`.

```bash
git-ai issue 123
```

This will fetch GitHub issue `#123`, create a branch named from the issue title,
write a local issue snapshot under `.git-ai/issues/`, write run artifacts under
`.git-ai/runs/`, run `codex exec` against that local workspace, verify the
build with `pnpm build`, commit the resulting changes, and if `gh` is installed
and authenticated, push the branch and open a pull request automatically.

`.git-ai/` is local working state for issue snapshots and run artifacts. It is
intentionally gitignored and should not be committed.

```bash
git-ai test-backlog
```

This scans the current repository, detects the current testing setup, and prints
a prioritized backlog of missing automated test coverage.

Use JSON output when you want to script the result:

```bash
git-ai test-backlog --format json --top 5
```

GitHub issue creation is explicit and opt-in:

```bash
GITHUB_TOKEN=... git-ai test-backlog --create-issues --max-issues 3
```

When `--create-issues` is enabled, `git-ai` checks for matching open issue
titles first so it can reuse existing backlog items instead of creating
duplicates.

## GitHub Actions issue flow

This repository also includes a manual `Issue to PR` workflow under
`.github/workflows/issue-to-pr.yml`.

Trigger it with `workflow_dispatch`, provide an issue number, and the workflow
will:

- fetch the GitHub issue details
- create the issue branch and Codex prompt workspace
- run Codex remotely in GitHub Actions
- build the repository with `pnpm build`
- commit and push the generated changes
- create or reuse a PR targeting `main`
- comment on the issue with the PR link

Required secrets:

- `OPENAI_API_KEY`

## Repo-wide test backlog workflow

This repository also includes a manual `Test Backlog` workflow under
`.github/workflows/test-backlog.yml`.

Trigger it with `workflow_dispatch` to:

- scan the repository for existing test setup and likely gaps
- publish a prioritized backlog summary in the workflow run
- optionally create GitHub issues for the highest-value findings

Issue creation is disabled by default and requires a deliberate manual trigger.
