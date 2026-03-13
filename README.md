# git-ai

AI tooling for Git workflows, including a CLI and GitHub Actions.

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
