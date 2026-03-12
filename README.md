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
