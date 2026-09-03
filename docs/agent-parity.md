# Agent parity validation

Parity has two distinct evidence layers. Keep them separate so a passing install check is never presented as a completed host lifecycle.

## Automated static parity

Run:

```bash
prs skills validate --json
```

The command creates a different temporary home for Codex, Claude Code, and GitHub Copilot. For each host it installs the canonical pack, checks the exact inventory and content hashes, confirms that the combined instructions reference every retained deterministic lifecycle operation, and reports the named `artifact-locality` and `staged-only-finalization` safeguards. The JSON result contains canonical `requiredSafeguards`, a separate host row with its own passing `safeguards` and errors, and an overall status. It does not launch an agent runtime or claim end-to-end workflow success.

## Manual lifecycle smoke matrix

Local usage adapter fixtures and `prs tool token-usage render` tests validate deterministic mappings and accounting without launching models. Static parity also checks the installed usage-render command reference. Neither layer demonstrates native telemetry availability or completes a host lifecycle. Run native validation only when requested and authorized; record unattempted rows as `not-run`. Missing usage evidence is a valid unavailable record, not a reason to make billable calls.

Use a disposable GitHub repository owned for testing. Never point the smoke procedure at a production repository. Native evidence is manual, separate from static validation, and must be run sequentially in a fresh clone and a fresh native session for each host.

1. Create a task-specific directory beneath `.prs/runs` and copy `docs/examples/agent-lifecycle-smoke-matrix.template.json` into it. Keep every issue draft, specification, plan, working note, and completion artifact in that directory or a run directory returned by `prs`.
2. For each of `codex`, `claude-code`, and `copilot`, create a fresh clone, run `prs setup --skills <host>` to install the current host pack, then start a fresh native session so it loads those instructions. Do not reuse a session, clone, issue, branch, or pull request from another host.
3. In the host's own row, record the eight native lifecycle phases: `create`, `refine`, `plan`, `implement`, `verify`, `finalize`, `open-pr`, and `validate`. Mark a phase `passed` only from evidence produced by that row's host; use `failed` for an attempted failure and `not-run` when it was not attempted.
4. During `create`, `refine`, and `plan`, create a disposable issue and approve its specification and plan. Keep the raw artifacts below `.prs/runs/issue-<number>-safety-smoke/`; do not use an alternative scratch root such as `.prs-work`.
5. During `implement`, add `agentStatusLabel(host)` to `src/status.js` so it returns `` `${host}: ready` ``, and add a `node:test` assertion in `test/status.test.js`. During `verify`, run `pnpm test`, `pnpm lint`, and `pnpm build` and record their results.
6. During `finalize`, create the host-specific root sentinel (`sentinel-codex.txt`, `sentinel-claude-code.txt`, or `sentinel-copilot.txt`). Stage only `src/status.js` and `test/status.test.js`, inspect the index with `git diff --cached --name-status`, and run `prs issue finalize <number>`. The sentinel must remain present and untracked; raw `.prs/runs` artifacts must remain ignored and uncommitted.
7. During `open-pr` and `validate`, open a separate, unmerged disposable pull request, query its state and hosted checks through normal GitHub tooling, and publish the final audit evidence. Inspect the local commit and pull-request file list; both must contain only `src/status.js` and `test/status.test.js`.
8. Complete only that host's row with its native session identifier, issue and pull-request URLs, commit SHA, artifact paths, inspected committed paths, sentinel state, local and hosted checks, capability fallbacks, and deviations. Fallback and deviation arrays are required even when empty. Never copy another host's URLs, session identifier, paths, or results.

The version-2 matrix requires exactly one separately attributed row for each of `codex`, `claude-code`, and `copilot`, with all eight phases present. Store completed matrices under `.prs/runs/<task-specific-run>/`; publish them only after reviewing the repository and URLs to ensure they are disposable test resources.

## Pull-request instruction checks

The six-skill pack includes `prs-pr`. Static validation independently requires its installation, the existing-PR router entry, and non-empty `review`, `resolve-conflicts`, `address-comments`, and `fix-tests` sections. Removing a workflow from the canonical manifest cannot produce a passing report merely because all three hosts share the omission. Repository tests also check the completion handoff, readiness boundaries, publication/push guidance, and upgrades from the five-skill inventory. These checks do not establish native-host PR behaviour; any such smoke evidence must be separately attributed to the host that ran it.

## GitHub account context

All three hosts use the same GitHub CLI integration when calling `prs`. GitHub-backed commands require installed and authenticated `gh`. Interactive `prs setup` can write a personal account choice to ignored `.prs/config.local.json` (`forge.githubAccount`); preserve that choice and resolve login errors instead of switching the global account. Direct host `gh` commands and Git transport do not read this `prs` setting. When no account is selected, `gh` handles normal authentication, including environment tokens for automation.
