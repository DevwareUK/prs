---
name: prs-create
description: Use when turning a rough idea into one approved GitHub issue or a dependency-linked issue set in a prs-configured repository.
---

# Create prs issues

Draft implementation-ready work in a task-specific directory beneath `.prs/runs`, then use the deterministic creation tool only after approval.

## Local artifacts

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`.

This covers issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence. They are raw workflow artifacts and stay local. Never stage or commit them, and never create another repository-local scratch root such as `.prs-work`.

PRS artifact locality overrides the Superpowers default document paths and commit instructions. Both written artifacts are required even for bounded work. If either required Superpowers skill is unavailable, report the blocker and next action; do not skip a phase.

## Artifact preparation

Use `superpowers:brainstorming` to inspect repository behavior and clarify decisions that materially affect scope, data, access, rollout or acceptance criteria. Write and self-review each specification in the task-specific run directory. For a linked implementation set, every issue gets its own issue-specific specification; children reference shared architecture and prerequisites without copying sibling scope.

Use `superpowers:writing-plans` to write and self-review each implementation plan from its candidate specification. Include concrete files, steps, acceptance coverage and verification commands checked against repository source. The designated parent's plan owns coordination, integration and final acceptance; each child plan owns only that child's implementation. Prepare both artifacts without requesting intermediate approval between the specification and plan.

## Unified approval

Draft an H1-titled Markdown issue in the same run directory. For multiple tasks, keep one draft, specification and plan per issue plus a version-2 linked-set manifest. Recommend a designated parent/orchestrator for coordination, integration and final acceptance. Reuse a parent only when the user explicitly designates its `issueNumber`; never infer one from title, order or dependency links. When orchestration is unnecessary, record the user's explicit flat choice and reason. Parent membership and dependency order are separate: `parentId` establishes tracker-native hierarchy while `dependsOn` and `blocks` govern readiness.

```json
{
  "version": 2,
  "mode": "multiple",
  "orchestration": { "mode": "parent", "orchestratorId": "delivery" },
  "issues": [
    {
      "id": "delivery",
      "issueNumber": 123,
      "draftFile": ".prs/runs/<run>/delivery.md",
      "specFile": ".prs/runs/<run>/delivery-spec.md",
      "planFile": ".prs/runs/<run>/delivery-plan.md",
      "dependsOn": [], "blocks": [], "related": []
    },
    {
      "id": "contract",
      "parentId": "delivery",
      "draftFile": ".prs/runs/<run>/contract.md",
      "specFile": ".prs/runs/<run>/contract-spec.md",
      "planFile": ".prs/runs/<run>/contract-plan.md",
      "dependsOn": [], "blocks": [], "related": []
    }
  ]
}
```

Flat sets use `"orchestration": { "mode": "flat", "reason": "..." }` and omit every `parentId`. Version-1 linked manifests receive upgrade guidance; do not work around it with one shared artifact pair.

Show the exact issue draft or linked set and every reviewed artifact together: each issue's own specification and plan, dependency links, explicit parent/flat choice, and intended native hierarchy. Obtain one explicit user approval that accepts every specification and plan and authorizes the workflow to create or reuse the issues, publish both managed comments per issue, and apply the hierarchy mutations. Design approval alone does not authorize publication. No remote write may happen before this approval.

An acknowledgment accompanied by a question, qualification, scope change, content change or target change is not approval. Update every affected artifact and relationship, recheck the packet for consistency, and show one complete revised packet for one fresh approval. Unchanged material may be reused while revising, but any later content or target change invalidates the previous authorization.

Before any remote write, for each issue check both files exist, contain non-empty Markdown and match the displayed, approved versions; also check the draft and every artifact stay inside the selected run directory after symlink resolution. Single-issue creation keeps the global artifact flags; linked creation reads `specFile` and `planFile` from each manifest entry:

```bash
prs tool issue create --draft-file .prs/runs/<run>/issue.md --spec-file .prs/runs/<run>/spec.md --plan-file .prs/runs/<run>/plan.md --json
prs tool issue create --issue-set .prs/runs/<run>/issue-set.json --run-dir .prs/runs/<run> --json
```

## Completion verification

For every created or reused issue, require `managedComments` records with `status: published` for both `<!-- prs:issue-spec -->` and `<!-- prs:issue-plan -->`. Read `prs tool issue context <number> --json` and confirm both managed artifacts are present; check the published content matches the approved files. For parent mode, also require every requested `hierarchy.relationships` entry to have `status: verified`, then confirm both hierarchy directions. Flat mode must report its reason and perform no parent mutation. Missing or incomplete comments or relationships mean incomplete work even when some issues were created.

If linked publication is partial, preserve the known issue numbers and approved files, plus `issue-set-receipt.json` and relationship results. Retry the same approved linked creation command; it reconciles recorded identities, updates managed comments in place and verifies native links without force-reparenting. For a single issue, recover with `prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json`. Changed content or targets require renewed approval. If recovery is blocked, report the issue or relationship, tool message and next action; do not declare completion or substitute Markdown links for native hierarchy.

Report every created or reused issue by number, title and URL, plus both verified managed-comment URLs. Issue creation alone is not completion. Keep raw prompts and working notes local. Before destructive cleanup, obtain separate explicit user approval.

## Usage evidence

As soon as this task has a run directory, start a local checkpoint with `prs tool token-usage capture --host <codex|claude-code|copilot> --output .prs/runs/<run>/usage-evidence.json --json`. It reads only the selected session's usage metadata and makes no model calls. The first call starts at now; use `--since <ISO>` only with a known task-start timestamp for retrospective capture.

Codex uses `CODEX_THREAD_ID` and an exact matching session file. For Claude Code, supply `--session <id>` and `--source <transcript-path>` from native session metadata (or `PRS_USAGE_SESSION_ID` / `PRS_USAGE_SOURCE`). For local Copilot app/CLI sessions, opted-in PRS telemetry setup supplies a fresh managed session binding for the same repository and a verified managed exporter to the bare capture command. Explicit `--session` and `--source` values remain authoritative. Missing, stale, invalid, or ambiguous managed bindings stay unavailable rather than selecting a recent session; hosted Copilot coding-agent evidence remains unsupported. Do not guess the latest session, search transcript contents, add or alter hooks during capture, change global telemetry, discover credentials, or launch models to obtain evidence. Missing setup produces an unavailable record with guidance; report it instead of zero.

Refresh capture using the same output before completion, then run `prs tool token-usage render --file .prs/runs/<run>/usage-evidence.json --output .prs/runs/<run>/token-usage.md --json`. Preserve that artifact's original host, session, source and start boundary across readiness, finish and PR handoffs, even when readiness returns a new run directory. Do not copy it into a new run, reset its start, overwrite supplied manual evidence, or sum repeated reports. For a different host/session, use a separate artifact and keep totals separate unless non-overlapping coverage is established.

Review capture warnings, partial/unpriced results and the checkpoint range. Full-task/subagent coverage is unproven; the final response and later work require a later checkpoint. Model tokens, host counters, credits, host cost estimates and actual charges remain distinct. Adapter fixtures are not native validation. The PRS source's `docs/usage-evidence.md` documents supported formats and optional setup; if the capture command is unavailable, preserve existing evidence and report the limitation.

Obtain explicit user approval before publishing the reviewed Markdown with `prs audit publish --issue <number> --file .prs/runs/<run>/token-usage.md --section token-usage` (or `--pr <number>`). Raw JSON, transcripts and private source paths stay local. Reuse the same report when publishing to an issue and PR.

## Provider defaults and conversion evidence

Preflight the configured tracker and show resolved project/target-board defaults with the approval packet when they affect creation. Scope is independent of defaults and workflow-group placement. On Monday, use native item IDs and real column JSON values; an Epic default links to an Epic item and is distinct from a parent/subitem relationship.

Parent-mode creation may return a replacement native subitem for an existing top-level Monday item. Use the returned active ID/URL for artifacts, dependencies, audits and later commands, preserving `replacementOf` in receipts. Require verified copies, artifact publication and both hierarchy directions before original retirement; partial results remain incomplete and retries reconcile the same replacement. Flat mode performs no conversion. Existing unrelated parents and linked open PRs require resolution, not forced reparenting. Do not change the original issue target merely during ordinary refinement.

## Cross-provider pull request references

Issue arguments and audits use the configured tracker. GitHub-tracked issues may use verified same-repository closing references. For a Monday issue, include its API-returned canonical item URL and the exact marker `<!-- prs:issue-ref monday ITEM_ID -->` in the GitHub PR body. Never emit `Closes #ITEM_ID` for a Monday item; GitHub cannot close it. Keep PR audits/reviews/checks on the forge.

For converted Monday items, use the verified active replacement ID/URL and preserve original lineage in the completion record. The PR link adapter discovers historical original references. Do not reset usage checkpoints during conversion or readiness handoffs. Completion audits and review/check verification remain required for either tracker; no provider selection waives them.

## Tracker-aware orchestration

Project configuration selects GitHub or Monday for every issue child and managed artifact; the GitHub forge remains responsible for PRs. Numeric issue arguments are provider-native IDs. Parent membership, dependency order and Epic scope are separate. Use each returned active ID/URL, preserving original/replacement receipt lineage after a verified Monday conversion. Never launch work from a retired original, treat unavailable PR evidence as an empty set, or retire an original before all required copies/artifacts/hierarchy checks succeed.

## Issue tracker independence

PR numbers, reviews, checks and PR audits always use the configured forge. Linked issue context/artifacts/audits use the configured tracker, which may be Monday with a GitHub forge. Preserve native issue IDs and any verified original/replacement lineage; do not infer a GitHub issue from a Monday numeric ID or generate GitHub closing syntax for it.

## Monday tracker parity

All three hosts use the same issue command surface with GitHub or Monday selected by project config. Native Monday item IDs are issue arguments, readiness reports `trackerUpdate`, and PR work stays on the GitHub forge. Creation defaults are independent from scope; configured Epic links belong to the appropriate board schema. Conversion receipts supply the new active subitem identity and retain the original as provenance.

The shared adapter workflow tests verify deterministic results with provider API fixtures. They are not native-host or real Monday validation. A version-2 smoke matrix may declare `issueTracker: { "type": "monday", "accountHost": "your-account.monday.com", "boardIds": ["YOUR_BOARD_ID"] }`; its issue URLs must belong to that exact account/board, while repository and PR URLs remain strict GitHub identities. Omitting issueTracker retains the existing GitHub matrix behavior. Live pilot records must separately demonstrate API content round-trip, creation metadata, hierarchy, retirement/recovery and PR evidence before claiming native parity.
