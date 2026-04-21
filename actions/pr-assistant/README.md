# pr-assistant action

Generate a managed PR assistant section from a pull request diff via OpenAI and merge it into the existing PR body. The section uses a stable shape: summary, risk areas, files changed, testing notes, rollout concerns, and reviewer checklist.

This GitHub Action is OpenAI-only today. Advanced local CLI provider and runtime customization such as `bedrock-claude` or `claude-code` does not change this action's input surface.

## Local test

1. Install and build workspace packages:

```bash
pnpm install
pnpm build
```

2. Write large inputs to files and run the action entry locally:

```bash
git diff -- . ':!pnpm-lock.yaml' > /tmp/git-ai-pr-assistant.diff
git log --reverse --format='%s%n%b%n---' HEAD~3..HEAD > /tmp/git-ai-pr-assistant-commits.txt

INPUT_DIFF_FILE="/tmp/git-ai-pr-assistant.diff" \
INPUT_COMMIT_MESSAGES_FILE="/tmp/git-ai-pr-assistant-commits.txt" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Human-authored PR notes" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-assistant/dist/index.js
```

`INPUT_DIFF` and `INPUT_COMMIT_MESSAGES` are still supported for smaller local runs, but the `*_FILE` inputs avoid shell and GitHub Actions argument-length limits.

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout as `summary=...`, `section=...`, and `body=...`.

`Files changed` is derived from the diff headers in code so the managed section does not rely on the model to invent file paths.
