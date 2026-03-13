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
