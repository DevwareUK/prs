# Agent parity validation

Parity has two distinct evidence layers. Keep them separate so a passing install check is never presented as a completed host lifecycle.

## Automated static parity

Run:

```bash
prs skills validate --json
```

The command creates a different temporary home for Codex, Claude Code, and GitHub Copilot. For each host it installs the canonical pack, checks the exact inventory and content hashes, and confirms that the combined instructions reference every retained deterministic lifecycle operation. The JSON result contains a separate host row and an overall status. It does not launch an agent runtime or claim end-to-end workflow success.

## Manual lifecycle smoke matrix

Use a disposable GitHub repository owned for testing. Never point the smoke procedure at a production repository.

1. Copy `docs/examples/agent-lifecycle-smoke-matrix.template.json` into the run directory.
2. For each host, start a fresh native session and fresh repository clone. Run `prs setup --skills <host>`.
3. Use the host's native invocation behavior to create a small issue, refine and approve its specification, approve its plan, implement one trivial tested change, verify it locally, open a dedicated pull request, wait for hosted checks, and publish final audit evidence.
4. Record the issue and pull-request URLs, the native session identifier, and evidence for every phase in that host's own row.
5. Mark a phase `passed` only from evidence produced by that row's host. Use `failed` for an attempted failure and `not-run` when it was not attempted. Never copy another host's URL or result to satisfy the row.
6. Run the full repository verification suite after all child changes are integrated.

The matrix schema requires exactly one row for each of `codex`, `claude-code`, and `copilot`, with all seven lifecycle phases present. Store completed matrices under `.prs/runs`; publish them only after reviewing the repository and URLs to ensure they are disposable test resources.
