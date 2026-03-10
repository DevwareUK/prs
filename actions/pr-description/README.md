# pr-description action

First vertical slice implementation for generating a PR title/body from a diff via OpenAI.

## Local test

1. Install and build workspace packages:

```bash
pnpm install
pnpm build
```

2. Run the action entry locally:

```bash
INPUT_DIFF="$(git diff -- . ':!pnpm-lock.yaml')" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-description/dist/index.js
```

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout as `title=...` and `body=...`.
