# pr-assistant action

Generate a managed PR assistant section from a pull request diff via OpenAI and merge it into the existing PR body.

## Local test

1. Install and build workspace packages:

```bash
pnpm install
pnpm build
```

2. Run the action entry locally:

```bash
INPUT_DIFF="$(git diff -- . ':!pnpm-lock.yaml')" \
INPUT_COMMIT_MESSAGES="$(git log --reverse --format='%s' HEAD~3..HEAD)" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Human-authored PR notes" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-assistant/dist/index.js
```

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout as `summary=...`, `section=...`, and `body=...`.
