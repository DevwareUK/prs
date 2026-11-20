---
name: prs
description: Use when choosing or coordinating a prs issue, pull-request, creation, completion, or multi-issue workflow in a prs-configured GitHub repository.
---

# prs

Use `prs` as the router for the local issue and GitHub PR workflow. The active coding agent owns reasoning and implementation; deterministic `prs tool ... --json` commands provide state and perform approved writes.

## Route

- New issue or linked set: use `prs-create`.
- One existing issue: use `prs-issue`.
- Several linked issues with separate outcomes: use `prs-orchestrate`.
- Verify, commit, open or update a pull request, and publish final evidence: use `prs-finish`.
- Existing pull request: use `prs-pr` for main-checkout readiness, review, conflict resolution, comment fixes, or failing-test repairs; preserve the PR number and requested action.
- No selected issue or pull request: run `prs tool issue list --actionable --json` or `prs tool pr list --actionable --json` and show number, title, and URL.

## Integration boundaries

Issue workflows and issue audits use `issueTracker.type`; PR workflows and PR audits use `forge.type`. Issue trackers support GitHub and Monday; the forge supports GitHub. A GitHub forge with a Monday tracker is a valid configuration. An omitted tracker type inherits the forge type for compatibility. Both GitHub integrations share the existing `forge.githubCliPath` and local `forge.githubAccount` settings.

Check `linkedPullRequestsStatus` in issue context/list results. `unavailable` means the link evidence is unknown; never treat an empty array or false linked-PR flag as proof of no PR in that state. Actionable issue listing blocks without link evidence. Before starting an issue-to-PR implementation lifecycle, verify both integrations are enabled; tracker-only creation/refinement and forge-only PR work remain independent.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

## GitHub credential-store recovery

- When `forge.githubAccount` is configured, honor that account without switching the global GitHub account or falling back to another account or an inherited token. Never run `gh auth switch`.
- If a structured result says `retry-with-credential-store-access`, retry the exact PRS command through the active host's normal permission mechanism. PRS must not elevate itself or invoke a host-specific permission mechanism.
- Preserve unchanged approval, artifact paths, targets and known issue numbers across the permission-only retry.
- Ask the user to log in or refresh credentials only after an unrestricted retry still reports missing or rejected credentials.
- Never print or capture token values, authentication headers, subprocess stderr, credential paths or inherited token variables in diagnostic output.

## Shared safeguards

- Get explicit user approval immediately before creating issues or publishing tracker or forge comments. For routine completion and token-usage audits from an explicitly requested JDI issue implementation, apply the audit publication authorization in `prs-finish`; carry its originating request, mode and issue/PR targets through handoffs instead of asking again.
- Get explicit user approval before destructive cleanup. Never discard uncommitted or unpushed work.
- For issue implementation, prefer an isolated branch or worktree. If isolation is unavailable, continue in the active workspace and report that fallback. Existing-PR local testing follows `prs-pr` in the main checkout used by the local runtime.
- Delegate independent work only when the host supports delegation and the user has authorized it. Otherwise execute sequentially.
- Run fresh verification before completion. Report failures and preserve evidence under `.prs/runs`.
- Use the host's normal Git and GitHub capabilities for pushing and pull-request creation; do not invent a missing `prs tool` command.

## Common mistakes

- Treating a readiness response as implementation completion.
- Publishing locally drafted content before approval.
- Claiming parity based on command spelling instead of matching outcomes and safeguards.

## Provider identity and project defaults

Numeric issue arguments are native identifiers for the configured tracker: GitHub issue numbers or Monday item IDs. The JSON `issueNumber` field remains a compatibility name. PR numbers always belong to the forge. Issue reads, artifacts, readiness and issue audits use the tracker; PR work and PR audits use the forge. Never require the two provider types to match.

Creation defaults and project scope are separate configuration objects. Defaults set initial metadata (including a Monday Epic link); they do not identify which items belong to the project, and readiness does not reapply them. Subitem defaults use the actual target board schema. Workflow groups are placement/status, not issue dependencies, Epic membership or hierarchy.

After Monday conversion, follow the returned active replacement ID/URL and `replacementOf` receipt lineage for subsequent commands and reports. Verify content/artifacts and both hierarchy directions before the original is retired; never delete/recreate items as a workaround or discard partial receipts. Preserve the original only as provenance, not as the active work target.
