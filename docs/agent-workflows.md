# Active-agent workflows

The portable flow is deliberately split:

- the active coding agent owns questions, specifications, plans, implementation, review, and user approval;
- `prs` owns deterministic local GitHub, Git, artifact, and validation operations.

## Local artifact contract

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`. Issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence all stay below this root.

These raw files remain ignored and local; never stage or commit them, and never create an alternative repository-local scratch root such as `.prs-work`. Explicitly approved publication commands may publish reviewed specification, plan, or completion content to managed GitHub comments; publication does not make the raw local files repository content.

Codex, Claude Code, and GitHub Copilot use the same creation and refinement flow:

1. Use `superpowers:brainstorming` to settle requirements and write and self-review the specification or each issue-specific specification.
2. Use `superpowers:writing-plans` to write and self-review the implementation plan or each issue-specific plan from the candidate specification, without requesting intermediate approval.
3. Show one complete packet containing the exact issue draft, linked set or original refinement target, every reviewed specification and plan, dependency links, and any intended native hierarchy. Obtain one explicit approval that accepts the artifacts and authorizes the exact creation, managed-comment publication and hierarchy mutations. A question, qualification or content/target change is not approval; update every affected item, show the complete revised packet and request one fresh approval.
4. Before any remote write, check the displayed, approved files exist and contain non-empty Markdown. Single issues pass `--spec-file` and `--plan-file` directly. Linked sets use a version-2 manifest with one pair per issue and an explicit parent-orchestrator or flat choice. Existing-issue refinement uses `prs tool issue publish-artifacts <number>` with both files.
5. Inspect both published managed-comment records and read live context with `prs tool issue context <number> --json`. Confirm the specification and plan content match the approved files and report their URLs. Missing artifacts mean incomplete work, even after successful issue creation.

These written artifacts are mandatory even for bounded tasks. PRS locality overrides Superpowers document-path and commit defaults. Missing required Superpowers skills are blockers; do not silently skip phases. For linked-set creation, every issue receives its own approved pair. A designated parent owns coordination, integration and final acceptance; dependencies remain separate from native hierarchy. An explicitly flat set has no parent mutation. See [the command examples](../README.md#workflow).

Refinement is an action of `prs-issue`, starting from the original issue body, discussion and managed artifacts. Preserve the original issue number, URL and request body. Update both managed comments on that same issue; do not create replacement or linked issues from refinement. A refine-only request stops after verified publication. Existing comments provide context, not automatic approval of new content.

If linked publication fails part-way, retain the receipt, issue identities, approved artifacts and relationship results; retry the same approved set command so PRS reconciles them. For one known issue, retry `prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json`. Check live context again. Changed content or targets need renewed approval. Report unrecovered failures explicitly.

Only when implementation was requested, continue with approved, unchanged artifacts into `prs tool issue ready`, isolated implementation and verification, `prs issue finalize`, PR creation through the host's GitHub capability, and `prs tool pr ready`. A `prs-issue` implementation request with `--jdi`, `--auto` or `--unattended` follows that lifecycle but retains the unified artifact approval gate. An explicit `--jdi`, `--auto` or `--unattended` issue-implementation request supplies upfront authorization for routine completion and token-usage audits to that issue and its resulting PR. Retain the originating request, mode and targets through `prs-finish` and `prs-pr`; after writing and self-reviewing the reports, publish them without asking again. Without that authorization, show the reports and obtain explicit approval. Readiness flags alone do not grant it, and a later instruction to withhold publication overrides it. All other approval gates remain in force.

If a host cannot create worktrees, it continues in the active workspace. If it cannot delegate, it executes independent tasks sequentially. These fallbacks are part of the contract and must not silently drop lifecycle phases.

Remote mutations require explicit user approval; the JDI implementation request supplies it for the routine audits described above. Read-only context gathering does not.

## Canonical skill pack

`skills/manifest.json` is the portable inventory. It maps the six shared skill names to their source files and lifecycle phases:

- `prs`: workflow router;
- `prs-create`: issue and issue-set creation;
- `prs-issue`: one complete issue flow;
- `prs-finish`: verification, pull-request preparation, and validation;
- `prs-pr`: main-checkout PR readiness and requested review, conflict, comment and failing-test work;
- `prs-orchestrate`: dependency-aware execution of an issue set as separate pull requests.

The source bodies use only portable Markdown instructions and the public `prs` command contract. They do not assume a host-specific command syntax, filesystem location, delegation feature, model, or telemetry system. Host adapters install these files without changing their shared bodies.

## Existing pull requests

Use `prs-pr` directly, through the `prs` router, or after `prs-finish` creates a PR. A linked issue is optional. The default flow lists actionable PRs when needed, locates the main checkout used by the local application, and invokes `prs tool pr ready <number> --json` there. The agent checks checkout/worktree blockers before readiness; it asks before any destructive worktree removal and preserves unrelated work. Preparation syncs the base and runs `prReadiness.commands`, then reports readiness results and runtime instructions.

Request one of these actions after preparation or directly for a selected PR:

| Skill action | Outcome |
| --- | --- |
| `review` | Inspect the current PR diff and requirements; draft the report, line-linked findings and review outcome; publish only after approval. |
| `resolve-conflicts` | Resolve the existing base-sync conflict, verify the affected code, and deliberately commit the intended changes. |
| `address-comments` | Read full actionable threads, evaluate and fix selected findings, verify changes, and draft approved replies/resolutions. Requests to resolve comments and `fix-comments` wording select this action. |
| `fix-tests` | Inspect actual local or hosted-check failures, repair the cause, and rerun relevant verification. |

These are active-agent workflows, not additional CLI commands.

Readiness success is not review completion; its unattended flags only govern preparation and runtime startup. For authorized changes, the agent stages intended paths, inspects the index, and uses normal Git finalization when no issue is linked. Before pushing, it confirms the actual PR head destination (including forks), fetches its current tip, inspects outgoing commits, and pushes only when ahead and not behind, without force. Completion evidence records the current head, local verification, hosted checks and remaining blockers. Pending or unavailable checks must remain visible. Review/comment publication and destructive cleanup retain explicit approval gates; completion and token-usage audits can use the authorization carried from a JDI issue-implementation request; readiness alone never authorizes a merge.
