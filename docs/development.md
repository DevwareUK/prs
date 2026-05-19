# Development Guide

## Developing `prs`

This section is for contributors working on this monorepo rather than users running the CLI in another repository.

### Monorepo layout

| Path | Responsibility |
| --- | --- |
| `packages/cli` | The `prs` CLI entrypoint, argument parsing, repository config loading, forge integration, and local issue workflow orchestration. |
| `packages/core` | Shared workflow logic for commit messages, diff summaries, PR review, issue drafting, issue planning, and backlog analysis. |
| `packages/contracts` | Shared Zod contracts and schema types for workflow inputs and outputs. |
| `packages/providers` | AI provider integrations, including OpenAI and Bedrock Claude adapters plus shared provider selection helpers. |
| `actions/pr-review` | GitHub Action bundle for AI pull request review. |
| `actions/pr-assistant` | GitHub Action bundle for managed pull request assistant sections. |
| `actions/test-suggestions` | GitHub Action bundle for AI test suggestions on pull requests. |

### Root workspace commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm install` | Installs all workspace dependencies. |
| `pnpm build` | Runs `pnpm -r build` and builds every workspace package and action bundle. |
| `pnpm test` | Runs `vitest run --coverage` across the repository. |
| `pnpm lint` | Runs `eslint .`. |
| `pnpm dev` | Runs `pnpm -r dev` for workspace packages that define a `dev` script. |
| `pnpm prepare` | Runs `husky` to install or update Git hooks. This also runs automatically during install. |
| `pnpm cli:commit` | Builds the CLI package and runs `prs commit`. |
| `pnpm cli:diff` | Builds the CLI package and runs `prs diff`. |
| `pnpm cli:feature-backlog -- <args>` | Builds the CLI package and runs `prs feature-backlog <args>`. |
| `pnpm cli:issue -- <args>` | Builds the CLI package and runs `prs issue <args>`. |
| `pnpm cli:review -- <args>` | Builds the CLI package and runs `prs review <args>`. |
| `pnpm cli:test-backlog -- <args>` | Builds the CLI package and runs `prs test-backlog <args>`. |

### Package-level commands

Use these when working on an individual workspace directly.

| Package | Command | What it does |
| --- | --- | --- |
| `packages/cli` | `pnpm --filter @prs/cli build` | Builds the `prs` CLI into `packages/cli/dist`. |
| `packages/cli` | `pnpm --filter @prs/cli commit` | Builds the CLI package and runs `node dist/index.js commit`. |
| `packages/cli` | `pnpm --filter @prs/cli diff` | Builds the CLI package and runs `node dist/index.js diff`. |
| `packages/cli` | `pnpm --filter @prs/cli feature-backlog -- <args>` | Builds the CLI package and runs `node dist/index.js feature-backlog <args>`. |
| `packages/cli` | `pnpm --filter @prs/cli issue -- <args>` | Builds the CLI package and runs `node dist/index.js <args>`. Use this when testing CLI issue flows directly. |
| `packages/cli` | `pnpm --filter @prs/cli review -- <args>` | Builds the CLI package and runs `node dist/index.js review <args>`. |
| `packages/core` | `pnpm --filter @prs/core build` | Builds the shared core library. |
| `packages/contracts` | `pnpm --filter @prs/contracts build` | Builds the shared contract and schema package. |
| `packages/providers` | `pnpm --filter @prs/providers build` | Builds the provider integrations package. |
| `actions/pr-assistant` | `pnpm --filter @prs/pr-assistant-action build` | Builds the PR assistant GitHub Action bundle. |
| `actions/pr-review` | `pnpm --filter @prs/pr-review-action build` | Builds the PR review GitHub Action bundle. |
| `actions/test-suggestions` | `pnpm --filter @prs/test-suggestions-action build` | Builds the test suggestions GitHub Action bundle. |

### GitHub Action local entrypoints

These actions are bundled for GitHub Actions, but you can also run them locally after building the workspace.

#### PR review action

Build:

```bash
pnpm build
```

Run locally:

```bash
git diff --unified=3 -- . ':!pnpm-lock.yaml' > /tmp/prs-pr-review.diff

INPUT_DIFF_FILE="/tmp/prs-pr-review.diff" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Closes #50" \
INPUT_ISSUE_NUMBER="50" \
INPUT_ISSUE_TITLE="Implement AI-Powered Pull Request Review Functionality" \
INPUT_ISSUE_BODY="Create a function that utilizes AI to review pull requests line by line." \
INPUT_ISSUE_URL="https://github.com/DevwareUK/prs/issues/50" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-review/dist/index.js
```

Inputs:

- `INPUT_DIFF` optional when `INPUT_DIFF_FILE` is set
- `INPUT_DIFF_FILE` optional file path, preferred for large diffs
- `INPUT_PR_TITLE` optional
- `INPUT_PR_BODY` optional
- `INPUT_ISSUE_NUMBER` optional
- `INPUT_ISSUE_TITLE` optional
- `INPUT_ISSUE_BODY` optional
- `INPUT_ISSUE_URL` optional
- `INPUT_OPENAI_API_KEY` required
- `INPUT_OPENAI_MODEL` optional, defaults to `gpt-4o-mini`
- `INPUT_OPENAI_BASE_URL` optional

Outputs:

- `summary`
- `body`
- `findings_json`
- `comments_json`

The managed `body` output is written as pre-review signal for a human reviewer. `comments_json` carries severity, confidence, affected file, why-this-matters context, and optional suggested fixes for each candidate comment.

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout.

#### PR assistant action

Build:

```bash
pnpm build
```

Run locally:

```bash
git diff -- . ':!pnpm-lock.yaml' > /tmp/prs-pr-assistant.diff
git log --reverse --format='%s%n%b%n---' HEAD~3..HEAD > /tmp/prs-pr-assistant-commits.txt

INPUT_DIFF_FILE="/tmp/prs-pr-assistant.diff" \
INPUT_COMMIT_MESSAGES_FILE="/tmp/prs-pr-assistant-commits.txt" \
INPUT_PR_TITLE="Example PR title" \
INPUT_PR_BODY="Human-authored PR notes" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/pr-assistant/dist/index.js
```

Inputs:

- `INPUT_DIFF` optional when `INPUT_DIFF_FILE` is set
- `INPUT_DIFF_FILE` optional file path, preferred for large diffs
- `INPUT_COMMIT_MESSAGES` optional
- `INPUT_COMMIT_MESSAGES_FILE` optional file path for commit messages
- `INPUT_PR_TITLE` optional
- `INPUT_PR_BODY` optional
- `INPUT_RESOLVED_SUGGESTIONS` legacy optional JSON array of previously addressed AI test suggestions for manual callers; generated workflows use the existing managed comment file instead
- `INPUT_OPENAI_API_KEY` required
- `INPUT_OPENAI_MODEL` optional, defaults to `gpt-4o-mini`
- `INPUT_OPENAI_BASE_URL` optional

Outputs:

- `summary`
- `section` with `Summary`, `Risk areas`, `Files changed`, `Testing notes`, `Rollout concerns`, and `Reviewer checklist`
- `body`

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout.

`Files changed` is derived from the diff headers in code so the managed section stays grounded in the actual patch.

#### Test suggestions action

Build:

```bash
pnpm build
```

Run locally:

```bash
git diff -- . ':!pnpm-lock.yaml' > /tmp/prs-test-suggestions.diff

INPUT_DIFF_FILE="/tmp/prs-test-suggestions.diff" \
INPUT_PR_TITLE="Example PR title" \
INPUT_OPENAI_API_KEY="<your-key>" \
INPUT_OPENAI_MODEL="gpt-4o-mini" \
node actions/test-suggestions/dist/index.js
```

For subsequent-run checklist assessment, also set `INPUT_EXISTING_COMMENT_FILE` to a file containing the current managed comment body.

Inputs:

- `INPUT_DIFF` optional when `INPUT_DIFF_FILE` is set
- `INPUT_DIFF_FILE` optional file path, preferred for large diffs
- `INPUT_PR_TITLE` optional
- `INPUT_PR_BODY` optional
- `INPUT_EXISTING_COMMENT` optional existing managed AI Test Suggestions comment body
- `INPUT_EXISTING_COMMENT_FILE` optional file path for the existing managed AI Test Suggestions comment body
- `INPUT_OPENAI_API_KEY` required
- `INPUT_OPENAI_MODEL` optional, defaults to `gpt-4o-mini`
- `INPUT_OPENAI_BASE_URL` optional

Outputs:

- `summary`
- `body`

When `GITHUB_OUTPUT` is not set, outputs are printed to stdout.

The generated workflow looks for the newest managed bot comment containing `<!-- prs:test-suggestions -->` before it calls the action. If no managed comment exists and the PR diff is non-empty, the action creates the first checklist-style managed comment. If a managed comment already exists, the workflow passes it through `existing_comment_file`; the action preserves the original suggestion text and checked boxes, assesses only unchecked suggestions against the current diff, and checks any suggestions that are now addressed. Checked boxes are monotonic, including boxes checked manually in GitHub.

The generated managed comment keeps each suggestion compact but task-ready by including an `Addressed` checkbox, behavior covered, likely regression risk, suggested test type, protected paths, likely implementation locations, suggestion-specific edge cases when useful, and a short implementation note.

### Testing and CI expectations

Run the shared monorepo checks with:

```bash
pnpm build
pnpm test
pnpm lint
```

Vitest is the default repository test runner. Tests live alongside the packages they cover using `*.test.ts` files under `packages/` and `actions/`.

This repository includes these GitHub workflows:

- `.github/workflows/test.yml`: builds the workspace and runs `pnpm test` on pushes to `main` and on pull requests
- `.github/workflows/pr-review.yml`: generates an AI PR pre-review signal, updates a managed PR comment, reconciles previous PRS-authored inline review threads, and posts only non-duplicate high-confidence inline review comments on changed lines
- `.github/workflows/pr-assistant.yml`: updates the pull request body with a managed PR assistant section
- `.github/workflows/test-suggestions.yml`: creates or updates a managed PR comment with suggested automated test coverage
- `.github/workflows/issue-to-pr.yml`: manual issue-to-PR automation that prepares issue context, runs Codex in GitHub Actions, builds the repository, commits generated changes, and opens or reuses a PR
- `.github/workflows/test-backlog.yml`: manual repository-wide test backlog scan with optional issue creation

All three pull-request-triggered AI workflows generate their diff input through the built CLI helper and hand it to the local action through a temporary file, so `.prs/config.json` `aiContext.excludePaths` is honored in pull request automation without hitting GitHub Actions argument-length limits.
