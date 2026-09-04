---
name: prs-pr
description: Use when an existing pull request needs local testing in the main checkout, review, conflict resolution, review-comment fixes, or failing-test repairs, including PRs with no linked issue.
---

# Work a prs pull request

Prepare the actual PR branch in the main checkout used by the local application, then carry out the requested action. Keep the PR number and repository attached to every operation. A linked issue is optional.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

## Select and prepare

1. Read repository instructions and `.prs/config.json`. Preserve the selected PR and requested action. If no PR is selected, run `prs tool pr list --actionable --json`, show number, title and URL, and let the user select. Report a blocked result's message and next action; unavailable context is not an empty list.
2. Locate the main checkout with `git worktree list --porcelain`; confirm it is the checkout used by the user's local runtime. Run preparation and follow-up actions there, not in a newly created review worktree. If it is unavailable, report that limitation before substituting another checkout.
3. Inspect the main checkout's status and the PR's actual head/base through the host's GitHub tooling. Preserve unrelated work. If the PR branch is held by another worktree, inspect that worktree before readiness: the tool may remove a clean blocking worktree. Obtain explicit user approval for that removal first; a dirty worktree is a blocker. Never discard uncommitted or unpushed work.
4. In the main checkout, run `prs tool pr ready <number> --json`. It checks out the PR head, fetches and merges the latest base, runs configured `prReadiness.commands`, and returns a run directory, `baseSync`, `localReadiness`, `prContext`, `runtime`, and `nextAction`. This changes local Git state. Compare the local branch and commit with the current remote PR head; reconcile a stale or diverged branch before reviewing or fixing it, preserving local commits.
5. Read all readiness results and linked logs. For `blocked`, explain the failed step and continue into a fix only when that action was requested. For `needs-action`, surface the runtime guidance. Report unavailable checks/comments as unknown, and pending checks as pending. A `ready` result means local preparation succeeded, not review or PR completion.

With no action, perform readiness only and offer local testing followed by relevant actions below. On the readiness tool, `--unattended`, `--auto`, and `--jdi` only add its implemented unattended behaviour, including configured runtime startup. They do not authorize review, fixes, commits, pushes, publication, approval or merging. An explicit action request controls subsequent work.

## Actions

These are skill actions handled by the active agent, not additional `prs` CLI subcommands. Use the supported PRS tools and the host's normal Git/GitHub capabilities. Ensure direct GitHub tooling uses the repository's selected account from `.prs/config.local.json` when configured; it does not inherit that setting automatically. Never change the globally active account as a workaround.

### review

Prepare review context using `gh pr view <number> --json body,closingIssuesReferences,headRefName,headRefOid,baseRefName,files,reviewDecision,statusCheckRollup`, `gh pr diff <number>`, and relevant source and tests, or equivalent host tools. Record the reviewed remote head SHA. Inspect the published PR diff; distinguish unpushed base-sync changes from that diff.

Write a local report and line-linked finding candidates with repository paths, verified diff lines/sides, evidence and severity. Choose `REQUEST_CHANGES`, `COMMENT`, or `APPROVE` according to the findings. Show the exact report, inline comments and outcome; obtain explicit user approval before publishing. Reviewing does not authorize code edits, commits, pushes or thread resolution.

Publish the approved review through the host's review capability. With `gh`, a body-only review can use `gh pr review <number> --body-file <report-path>` plus the chosen outcome flag. For inline findings, use `gh api --method POST repos/<owner>/<repo>/pulls/<number>/reviews --input <review-json-path>` with `commit_id`, `event`, `body`, and `comments` containing `path`, `line`, `side`, and `body`. Recheck the remote head before posting; if it changed, refresh the review and approval. Inspect the response and record its URL. If approval is rejected (for example, a self-review), report it; do not silently change the approved outcome or claim publication succeeded.

### resolve-conflicts

Inspect `baseSync` and `git status`. If readiness already left a merge in progress, resolve that merge without rerunning readiness or starting another merge. Inspect both sides and linked requirements, resolve the conflicting files, and run the affected verification. Ask only when the intended behaviour cannot be determined. Finish the merge through the verified-change steps below; do not blanket-select one side or discard unrelated work.

### address-comments

Treat requests to resolve comments and the older `fix-comments` wording as this action. Read the full actionable review threads, including replies and source links, using the host's GitHub review-thread capability (or paginated `gh api graphql`); readiness summaries may be truncated. Exclude resolved, outdated, duplicate and already-handled findings. Group related actionable comments, preserve a selected subset, and inspect each claim against current code before fixing it. Explain disagreement with evidence.

Implement the requested fixes and relevant regression tests, then follow the verified-change steps. Draft any thread replies locally and obtain explicit user approval before posting replies or resolving threads. Only mark a thread addressed after the fix is pushed and verified; preserve unresolved disagreements.

### fix-tests

Treat the older `fix-failing-tests` wording as this action. Inspect failed checks with `gh pr checks <number>` and their logs (`gh run view <run-id> --log-failed` for GitHub Actions), or equivalent host tools. For local failures, read the readiness log or reproduce the failing verification command. Confirm the failure applies to the current PR head; pending or unavailable checks are not failures. Repair the cause, rerun the failing test plus relevant regression checks, and follow the verified-change steps. Report inherited or external failures with evidence rather than suppressing tests.

## Verify and push changes

1. Review the diff against the requested fix and run fresh relevant verification. Stage only intended paths, inspect `git diff --cached --name-status` and the staged diff, and commit only the existing index; preserve unstaged changes and untracked files. When there is no linked issue, use a normal Git commit with a reviewed message. Never invent an issue number for `prs issue finalize`.
2. Push only when authorized. Resolve the destination repository, remote and branch from live PR metadata; a fork's head may not be on `origin`. Confirm the current branch is the intended PR head. Fetch the destination branch, record its tip, and use `git rev-list --left-right --count <fetched-head>...HEAD` to check that local HEAD is ahead and not behind (left count zero, right count positive). Inspect the outgoing commits. If behind/diverged, reconcile and verify again; if equal, no push is needed. Use `git push <head-remote> HEAD:refs/heads/<head-branch>` to push explicitly to that destination, never force push. A race rejection requires a fresh fetch and review.
3. Refresh hosted checks and review state for the current PR head after pushing. Use a bounded wait and report pending, failed or unavailable checks honestly. Write completion evidence in the run directory, identifying the PR URL, verified commit, changed scope, local results, hosted state and remaining blockers. Obtain explicit user approval before publishing the reviewed audit with `prs audit publish --pr <number> --file <path> --section <name>`.

Keep existing-PR work here; do not route back to issue creation or loop through `prs-finish`. Merging and destructive cleanup require separate explicit authorization. Never claim verified completion from readiness alone, stale evidence, pending checks, or an unpushed commit.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). Copilot needs its exact session ID plus a local export selected by `--source` or `COPILOT_OTEL_FILE_EXPORTER_PATH`, enabled before starting the session. Do not guess the latest session, search transcript contents, install hooks, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Obtain explicit user approval before publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.
