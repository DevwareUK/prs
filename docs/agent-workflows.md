# Active-agent workflows

The portable flow is deliberately split:

- the active coding agent owns questions, specifications, plans, implementation, review, and user approval;
- `prs` owns deterministic local GitHub, Git, artifact, and validation operations.

## Local artifact contract

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`. Issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence all stay below this root.

These raw files remain ignored and local; never stage or commit them, and never create an alternative repository-local scratch root such as `.prs-work`. Explicitly approved publication commands may publish reviewed specification, plan, or completion content to managed GitHub comments; publication does not make the raw local files repository content.

Codex, Claude Code, and GitHub Copilot use the same creation and refinement gates:

1. Use `superpowers:brainstorming` to settle and write the specification, then show it and wait for explicit approval.
2. Use `superpowers:writing-plans` to write the implementation plan from the approved specification, then show it and wait for explicit approval.
3. Show the exact issue draft or existing issue target and both reviewed artifacts. Obtain explicit authorization for creation (when applicable) and publication of both managed comments. Plan approval can share that response only when both actions and exact content are presented. A question or scope addition is not publication approval; show revisions and wait.
4. Check both approved files exist and contain non-empty Markdown. Use `prs tool issue create` with both `--spec-file` and `--plan-file` for new issues, or `prs tool issue publish-artifacts <number>` with both files for existing-issue refinement.
5. Inspect both published managed-comment records and read live context with `prs tool issue context <number> --json`. Confirm the specification and plan content match the approved files and report their URLs. Missing artifacts mean incomplete work, even after successful issue creation.

These written artifacts are mandatory even for bounded tasks. PRS locality overrides Superpowers document-path and commit defaults. Missing required Superpowers skills are blockers; do not silently skip phases. For linked-set creation, the approved shared spec and plan cover every stable issue ID and are published to every created or reused issue. See [the command examples](../README.md#workflow).

Refinement is an action of `prs-issue`, starting from the original issue body, discussion and managed artifacts. Preserve the original issue number, URL and request body. Update both managed comments on that same issue; do not create replacement or linked issues from refinement. A refine-only request stops after verified publication. Existing comments provide context, not automatic approval of new content.

If publication fails part-way, retain the issue identities and approved artifacts. Retry `prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json` within authorization for the same files and targets; check live context again. Do not blindly repeat creation after an uncertain response. Changed content or targets need renewed approval. Report unrecovered failures and missing artifacts explicitly.

Only when implementation was requested, continue with approved, unchanged artifacts into `prs tool issue ready`, isolated implementation and verification, `prs issue finalize`, PR creation through the host's GitHub capability, and `prs tool pr ready`. A `prs-issue` implementation request with `--jdi`, `--auto` or `--unattended` follows that lifecycle but retains artifact approval gates. Completion audits use `prs audit publish` after explicit approval of their reviewed content.

If a host cannot create worktrees, it continues in the active workspace. If it cannot delegate, it executes independent tasks sequentially. These fallbacks are part of the contract and must not silently drop lifecycle phases.

Remote mutations require explicit user approval. Read-only context gathering does not.

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

Readiness success is not review completion; its unattended flags only govern preparation and runtime startup. For authorized changes, the agent stages intended paths, inspects the index, and uses normal Git finalization when no issue is linked. Before pushing, it confirms the actual PR head destination (including forks), fetches its current tip, inspects outgoing commits, and pushes only when ahead and not behind, without force. Completion evidence records the current head, local verification, hosted checks and remaining blockers. Pending or unavailable checks must remain visible. Review/comment/audit publication and destructive cleanup retain explicit approval gates; readiness alone never authorizes a merge.
