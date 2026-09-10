# Agent parity validation

Parity has two distinct evidence layers. Keep them separate so a passing install check is never presented as a completed host lifecycle.

## Automated static parity

Run:

```bash
prs skills validate --json
```

The command creates a different temporary home for Codex, Claude Code, and GitHub Copilot. For each host it installs the canonical pack, checks the exact inventory and content hashes, confirms that the combined instructions reference every retained deterministic lifecycle operation, and reports the named `artifact-locality` and `staged-only-finalization` safeguards. The JSON result contains canonical `requiredSafeguards`, a separate host row with its own passing `safeguards` and errors, and an overall status. It also requires create and refine artifact preparation, unified approval and completion instructions independently of the manifest and combined references. It does not launch an agent runtime or claim end-to-end workflow success.

## Manual lifecycle smoke matrix

Local usage adapter fixtures and `prs tool token-usage capture` / `render` tests validate deterministic mappings, replay safety and accounting without launching models. Static parity checks both installed command references. Neither layer demonstrates native telemetry availability or completes a host lifecycle. The recorded Codex probe is separate evidence; Claude/Copilot capture still awaits real-issue validation. Run native validation only when requested and authorized; record unattempted rows as `not-run`. Missing usage evidence is a valid unavailable record, not a reason to make billable calls.

Use a disposable GitHub repository owned for testing. Never point the smoke procedure at a production repository. Native evidence is manual, separate from static validation, and must be run sequentially in a fresh clone and a fresh native session for each host.

1. Create a task-specific directory beneath `.prs/runs` and copy `docs/examples/agent-lifecycle-smoke-matrix.template.json` into it. Keep every issue draft, specification, plan, working note, and completion artifact in that directory or a run directory returned by `prs`.
2. For each of `codex`, `claude-code`, and `copilot`, create a fresh clone, run `prs setup --skills <host>` to install the current host pack, then start a fresh native session so it loads those instructions. Do not reuse a session, clone, issue, branch, or pull request from another host.
3. In the host's own row, record the eight native lifecycle phases: `create`, `refine`, `plan`, `implement`, `verify`, `finalize`, `open-pr`, and `validate`. Mark a phase `passed` only from evidence produced by that row's host; use `failed` for an attempted failure and `not-run` when it was not attempted.
4. During `create`, settle requirements, write and self-review the specification and implementation plan without intermediate approval, and prepare the exact disposable issue draft. Present all three together and record one explicit approval that accepts both artifacts and authorizes creating the issue and publishing both exact managed comments, plus the returned issue and comment URLs. During `refine` and `plan`, start from that existing issue and apply the same single-packet approval process, preserving its body and identity; verify both updated comments. Keep raw artifacts below the task-specific `.prs/runs` directory established before issue creation. Record checkpoint evidence in a local Markdown companion to the matrix without changing its schema.
5. During `implement`, add `agentStatusLabel(host)` to `src/status.js` so it returns `` `${host}: ready` ``, and add a `node:test` assertion in `test/status.test.js`. During `verify`, run `pnpm test`, `pnpm lint`, and `pnpm build` and record their results.
6. During `finalize`, create the host-specific root sentinel (`sentinel-codex.txt`, `sentinel-claude-code.txt`, or `sentinel-copilot.txt`). Stage only `src/status.js` and `test/status.test.js`, inspect the index with `git diff --cached --name-status`, and run `prs issue finalize <number>`. The sentinel must remain present and untracked; raw `.prs/runs` artifacts must remain ignored and uncommitted.
7. During `open-pr` and `validate`, open a separate, unmerged disposable pull request, query its state and hosted checks through normal GitHub tooling, and publish the final audit evidence. Inspect the local commit and pull-request file list; both must contain only `src/status.js` and `test/status.test.js`.
8. Complete only that host's row with its native session identifier, issue and pull-request URLs, commit SHA, artifact paths, inspected committed paths, sentinel state, local and hosted checks, capability fallbacks, and deviations. Fallback and deviation arrays are required even when empty. Never copy another host's URLs, session identifier, paths, or results.

The version-2 matrix requires exactly one separately attributed row for each of `codex`, `claude-code`, and `copilot`, with all eight phases present. Store completed matrices under `.prs/runs/<task-specific-run>/`; publish them only after reviewing the repository and URLs to ensure they are disposable test resources.

## Create and refine instruction checks

Static validation requires `prs-create` and `prs-issue` independently of their presence in the manifest. It checks substantive artifact-preparation, unified-approval and completion sections in the relevant skill, both Superpowers references, preparation without intermediate approval, one approval accepting both artifacts and authorizing the exact remote work, required artifact files and flags, complete-packet revision handling, both managed markers and live publication verification. Refinement must retain the original issue and stop after publication when implementation was not requested. Optional artifact prose, staged approval headings or directives, pre-approval remote-write directives, and known contradictory refinement directives are rejected. These are conservative section-scoped text checks, not a natural-language proof or native-host evidence.

The regression fixtures mutate the canonical pack before installing it for all three hosts. A pack with a missing phase must fail even when all installed copies have identical hashes. Tests also retain empty headings, move approval prose to unrelated sections, omit required skills from the manifest, weaken preparation, approval or file/flag checks, restore staged specification/plan approval gates, and introduce conflicting refinement instructions.

For separately authorized native smoke runs, include these scenarios in the local companion evidence:

- Ask questions during discovery, then request a specification or plan revision after the complete packet is shown. Verify the agent updates every affected item, shows the complete revised packet and requests one fresh approval rather than separate artifact approvals. Approve design without authorizing publication, and include an acknowledgment with a question or scope addition; no issue or artifact write may occur.
- Create a linked set with shared approved spec/plan documents that map every stable ID; verify both comments on every created or reused issue.
- Refine an existing issue without requesting implementation. Verify its number, URL and body are retained, both updated managed comments match approved content, and no replacement issue, readiness or implementation occurs.
- Supply a missing or empty artifact and interrupt after one comment publishes. Verify preflight prevents an invalid write, and recovery retains the known issue number and uses approved files. Missing artifacts must leave the workflow visibly incomplete.

Keep native results separately attributed by host, including approval checkpoints, issue/comment URLs, failures and not-run scenarios. Ordinary static checks do not launch these sessions or publish test issues.

## Pull-request instruction checks

The six-skill pack includes `prs-pr`. Static validation independently requires its installation, the existing-PR router entry, and non-empty `review`, `resolve-conflicts`, `address-comments`, and `fix-tests` sections. Removing a workflow from the canonical manifest cannot produce a passing report merely because all three hosts share the omission. Repository tests also check the completion handoff, readiness boundaries, publication/push guidance, and upgrades from the five-skill inventory. These checks do not establish native-host PR behaviour; any such smoke evidence must be separately attributed to the host that ran it.

## JDI audit authorization checks

Static validation requires the finish policy that carries an explicit JDI issue-implementation request through completion and token-usage publication on the issue and its resulting PR. It checks the interactive approval fallback, readiness-only boundary, preserved unified artifact approval and handoffs from the router, issue and PR skills. Regression fixtures remove those rules or restore contradictory unconditional audit approval instructions. All three host rows must reject the broken pack. These checks do not establish native-agent approval behavior.

## GitHub account context

All three hosts use the same GitHub CLI integration when calling `prs`. GitHub-backed commands require installed and authenticated `gh`. Interactive `prs setup` can write a personal account choice to ignored `.prs/config.local.json` (`forge.githubAccount`); it selects PRS's identity without changing the active GitHub CLI account. Direct host `gh` commands and Git transport do not read this setting. When no account is selected, `gh` handles normal authentication, including environment tokens for automation.

## Credential-store recovery parity

When `forge.githubAccount` is configured, each host must honor that account without switching the global GitHub account, falling back to another account, or using an inherited token. Never run `gh auth switch`. GitHub CLI owns credential storage and the login/refresh process.

When a JSON result contains `reason: "github-credential-store-inaccessible"` and `nextAction: "retry-with-credential-store-access"`, retry the exact PRS command through the active host's normal permission mechanism. PRS must not elevate itself or invoke a host-specific permission mechanism. Preserve unchanged approval, artifact paths, targets, and known issue numbers across this permission-only retry. Ask the user to log in or refresh credentials only after an unrestricted retry still reports missing or rejected credentials; that authentication state uses `github-auth-required` and `configure-github-auth`.

The recovery result does not authorize a different target, account change, or another creation attempt after a partial remote write. Host diagnostics must never print or capture token values, authentication headers, subprocess stderr, credential paths, or inherited token variables.
