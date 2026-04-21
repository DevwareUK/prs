# pr-review action

Generate an AI pull request pre-review signal, higher-level findings, and line-linked review comments from a pull request diff via OpenAI.

This GitHub Action is OpenAI-only today. Advanced local CLI provider and runtime customization such as `bedrock-claude` or `claude-code` does not change this action's input surface.

## Local test

1. Install and build workspace packages:

```bash
pnpm install
pnpm build
```

2. Write the diff to a file and run the action entry locally:

```bash
git diff --unified=3 -- . ':!pnpm-lock.yaml' > /tmp/git-ai-pr-review.diff

INPUT_DIFF_FILE="/tmp/git-ai-pr-review.diff" \
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

`INPUT_DIFF` is still supported for smaller local runs, but `INPUT_DIFF_FILE` avoids shell and GitHub Actions argument-length limits.

The managed `body` output is positioned as pre-review signal for a human reviewer. `comments_json` includes severity, confidence, affected file, why-this-matters context, and an optional suggested fix for each line-linked comment candidate.

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout as `summary=...`, `body=...`, `findings_json=...`, and `comments_json=...`.
