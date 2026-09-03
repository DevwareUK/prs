# Active-agent workflows

The portable flow is deliberately split:

- the active coding agent owns questions, specifications, plans, implementation, review, and user approval;
- `prs` owns deterministic local GitHub, Git, artifact, and validation operations.

## Local artifact contract

`.prs/runs/<task-specific-run>/` is the only repository-local root for generated workflow artifacts. Use a run directory returned by `prs` when available; otherwise create a task-specific directory beneath `.prs/runs`. Issue drafts, linked-set manifests, specifications, plans, working notes, and completion evidence all stay below this root.

These raw files remain ignored and local; never stage or commit them, and never create an alternative repository-local scratch root such as `.prs-work`. Explicitly approved publication commands may publish reviewed specification, plan, or completion content to managed GitHub comments; publication does not make the raw local files repository content.

Codex, Claude Code, and GitHub Copilot should use the same lifecycle and command contract:

1. create approved issue drafts with `prs tool issue create`;
2. read live state with `prs tool issue context`;
3. publish approved specification and plan files with `prs tool issue publish-artifacts`;
4. prepare implementation metadata with `prs tool issue ready`;
5. work and verify in an isolated branch or worktree when the host supports it;
6. create a deterministic local commit with `prs issue finalize`;
7. open or update the pull request through the host's normal GitHub capability;
8. validate it with `prs tool pr ready` and publish evidence with `prs audit publish`.

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

These are active-agent workflows, not additional CLI commands. `add-tests` is excluded because it consumed suggestions from a retired Action. Adding necessary regression tests remains part of fixes.

Readiness success is not review completion; its unattended flags only govern preparation and runtime startup. For authorized changes, the agent stages intended paths, inspects the index, and uses normal Git finalization when no issue is linked. Before pushing, it confirms the actual PR head destination (including forks), fetches its current tip, inspects outgoing commits, and pushes only when ahead and not behind, without force. Completion evidence records the current head, local verification, hosted checks and remaining blockers. Pending or unavailable checks must remain visible. Review/comment/audit publication and destructive cleanup retain explicit approval gates; readiness alone never authorizes a merge.
