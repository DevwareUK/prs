# Agent parity validation

Parity has two distinct evidence layers. Keep them separate so a passing install check is never presented as a completed host lifecycle.

## Automated static parity

Run:

```bash
prs skills validate --json
```

The command creates a different temporary home for Codex, Claude Code, and GitHub Copilot. For each host it installs the canonical pack, checks the exact inventory and content hashes, confirms that the combined instructions reference every retained deterministic lifecycle operation, and reports the named `artifact-locality` and `staged-only-finalization` safeguards. The JSON result contains canonical `requiredSafeguards`, a separate host row with its own passing `safeguards` and errors, and an overall status. It also requires create and refine approval sections and their publication/completion instructions independently of the manifest and combined references. It does not launch an agent runtime or claim end-to-end workflow success.

## Manual lifecycle smoke matrix

Local usage adapter fixtures and `prs tool token-usage capture` / `render` tests validate deterministic mappings, replay safety and accounting without launching models. Static parity checks both installed command references. Neither layer demonstrates native telemetry availability or completes a host lifecycle. The recorded Codex probe is separate evidence; Claude/Copilot capture still awaits real-issue validation. Run native validation only when requested and authorized; record unattempted rows as `not-run`. Missing usage evidence is a valid unavailable record, not a reason to make billable calls.

Use a disposable GitHub repository owned for testing. Never point the smoke procedure at a production repository. Native evidence is manual, separate from static validation, and must be run sequentially in a fresh clone and a fresh native session for each host.

1. Create a task-specific directory beneath `.prs/runs` and copy `docs/examples/agent-lifecycle-smoke-matrix.template.json` into it. Keep every issue draft, specification, plan, working note, and completion artifact in that directory or a run directory returned by `prs`.
2. For each of `codex`, `claude-code`, and `copilot`, create a fresh clone, run `prs setup --skills <host>` to install the current host pack, then start a fresh native session so it loads those instructions. Do not reuse a session, clone, issue, branch, or pull request from another host.
3. In the host's own row, record the eight native lifecycle phases: `create`, `refine`, `plan`, `implement`, `verify`, `finalize`, `open-pr`, and `validate`. Mark a phase `passed` only from evidence produced by that row's host; use `failed` for an attempted failure and `not-run` when it was not attempted.
4. During `create`, write the specification, obtain its approval, write the implementation plan and obtain its approval before creating a disposable issue. Record explicit authorization for creating the issue and publishing both exact artifacts, plus the returned issue and both managed-comment URLs. During `refine` and `plan`, start from that existing issue and apply the same approval process, preserving its body and identity; verify both updated comments. Keep raw artifacts below the task-specific `.prs/runs` directory established before issue creation. Record checkpoint evidence in a local Markdown companion to the matrix without changing its schema.
5. During `implement`, add `agentStatusLabel(host)` to `src/status.js` so it returns `` `${host}: ready` ``, and add a `node:test` assertion in `test/status.test.js`. During `verify`, run `pnpm test`, `pnpm lint`, and `pnpm build` and record their results.
6. During `finalize`, create the host-specific root sentinel (`sentinel-codex.txt`, `sentinel-claude-code.txt`, or `sentinel-copilot.txt`). Stage only `src/status.js` and `test/status.test.js`, inspect the index with `git diff --cached --name-status`, and run `prs issue finalize <number>`. The sentinel must remain present and untracked; raw `.prs/runs` artifacts must remain ignored and uncommitted.
7. During `open-pr` and `validate`, open a separate, unmerged disposable pull request, query its state and hosted checks through normal GitHub tooling, and publish the final audit evidence. Inspect the local commit and pull-request file list; both must contain only `src/status.js` and `test/status.test.js`.
8. Complete only that host's row with its native session identifier, issue and pull-request URLs, commit SHA, artifact paths, inspected committed paths, sentinel state, local and hosted checks, capability fallbacks, and deviations. Fallback and deviation arrays are required even when empty. Never copy another host's URLs, session identifier, paths, or results.

The version-2 matrix requires exactly one separately attributed row for each of `codex`, `claude-code`, and `copilot`, with all eight phases present. Store completed matrices under `.prs/runs/<task-specific-run>/`; publish them only after reviewing the repository and URLs to ensure they are disposable test resources.

## Create and refine instruction checks

Static validation requires `prs-create` and `prs-issue` independently of their presence in the manifest. It checks substantive specification, plan, publication and completion sections in the relevant skill, both Superpowers references, explicit approval requirements, required artifact files and flags, both managed markers and live publication verification. Refinement must retain the original issue and stop after publication when implementation was not requested. Optional artifact prose and known contradictory refinement directives are rejected. These are conservative section-scoped text checks, not a natural-language proof or native-host evidence.

The regression fixtures mutate the canonical pack before installing it for all three hosts. A pack with a missing gate must fail even when all installed copies have identical hashes. Tests also retain empty headings, move approval prose to unrelated sections, omit required skills from the manifest, weaken file/flag checks and introduce conflicting refinement instructions.

For separately authorized native smoke runs, include these scenarios in the local companion evidence:

- Request a specification revision, withhold plan approval, and approve design without approving publication. Verify no issue or artifact write occurs before the relevant approval. Include an acknowledgment with a question or scope addition; the agent must present revisions and wait.
- Create a linked set with shared approved spec/plan documents that map every stable ID; verify both comments on every created or reused issue.
- Refine an existing issue without requesting implementation. Verify its number, URL and body are retained, both updated managed comments match approved content, and no replacement issue, readiness or implementation occurs.
- Supply a missing or empty artifact and interrupt after one comment publishes. Verify preflight prevents an invalid write, and recovery retains the known issue number and uses approved files. Missing artifacts must leave the workflow visibly incomplete.

Keep native results separately attributed by host, including approval checkpoints, issue/comment URLs, failures and not-run scenarios. Ordinary static checks do not launch these sessions or publish test issues.

## Pull-request instruction checks

The six-skill pack includes `prs-pr`. Static validation independently requires its installation, the existing-PR router entry, and non-empty `review`, `resolve-conflicts`, `address-comments`, and `fix-tests` sections. Removing a workflow from the canonical manifest cannot produce a passing report merely because all three hosts share the omission. Repository tests also check the completion handoff, readiness boundaries, publication/push guidance, and upgrades from the five-skill inventory. These checks do not establish native-host PR behaviour; any such smoke evidence must be separately attributed to the host that ran it.

## GitHub account context

All three hosts use the same GitHub CLI integration when calling `prs`. GitHub-backed commands require installed and authenticated `gh`. Interactive `prs setup` can write a personal account choice to ignored `.prs/config.local.json` (`forge.githubAccount`); preserve that choice and resolve login errors instead of switching the global account. Direct host `gh` commands and Git transport do not read this `prs` setting. When no account is selected, `gh` handles normal authentication, including environment tokens for automation.
