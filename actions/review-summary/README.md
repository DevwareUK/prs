# review-summary action

Generate a concise PR-level review summary from a pull request diff via OpenAI.

## Local test

1. Install and build workspace packages:

```bash
pnpm install
pnpm build
```

2. Run the action entry locally:

```bash
INPUT_DIFF="$(git diff -- . ':!pnpm-lock.yaml')" \
INPUT_PR_TITLE="Example PR title" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/review-summary/dist/index.js
```

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout as `summary=...` and `body=...`.
