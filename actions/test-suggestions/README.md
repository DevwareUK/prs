# test-suggestions action

Generate practical PR-level test suggestions from a pull request diff via OpenAI.

## Local test

1. Install and build workspace packages:

```bash
pnpm install
pnpm build
```

2. Write the diff to a file and run the action entry locally:

```bash
git diff -- . ':!pnpm-lock.yaml' > /tmp/git-ai-test-suggestions.diff

INPUT_DIFF_FILE="/tmp/git-ai-test-suggestions.diff" \
INPUT_PR_TITLE="Example PR title" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/test-suggestions/dist/index.js
```

`INPUT_DIFF` is still supported for smaller local runs, but `INPUT_DIFF_FILE` avoids shell and GitHub Actions argument-length limits.

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout as `summary=...` and `body=...`.
