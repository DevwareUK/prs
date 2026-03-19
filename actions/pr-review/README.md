# pr-review action

Generate an AI pull request review summary, higher-level findings, and line-linked review comments from a pull request diff via OpenAI.

## Local test

1. Install and build workspace packages:

```bash
pnpm install
pnpm build
```

2. Run the action entry locally:

```bash
INPUT_DIFF="$(git diff --unified=3 -- . ':!pnpm-lock.yaml')" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Closes #50" \
INPUT_ISSUE_NUMBER="50" \
INPUT_ISSUE_TITLE="Implement AI-Powered Pull Request Review Functionality" \
INPUT_ISSUE_BODY="Create a function that utilizes AI to review pull requests line by line." \
INPUT_ISSUE_URL="https://github.com/DevwareUK/git-ai/issues/50" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-review/dist/index.js
```

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout as `summary=...`, `body=...`, `findings_json=...`, and `comments_json=...`.
