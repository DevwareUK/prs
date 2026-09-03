# Codex

Install the canonical Agent Skills pack:

```bash
prs skills install codex
```

Codex discovers personal skills under `~/.agents/skills`. Restart Codex after installation if the new skills do not appear in the current session.

Codex can select a skill from the request context. To invoke one explicitly, prefix its installed name with `$`, for example:

```text
$prs-issue 327
$prs-orchestrate 323
$prs-pr 88
$prs-pr 88 address-comments
```

The six available names are `$prs`, `$prs-create`, `$prs-issue`, `$prs-finish`, `$prs-pr`, and `$prs-orchestrate`. This is Codex syntax only; other hosts document their own invocation behavior.

`$prs-pr 88` prepares PR 88 in the main checkout with configured readiness steps. Request `review`, `resolve-conflicts`, `address-comments`, or `fix-tests` for follow-up work. These are skill actions; review publication and destructive cleanup retain their approval gates. PRs without linked issues are supported. See [the PR workflow](agent-workflows.md#existing-pull-requests).

Codex worktrees and subagents can accelerate isolated or independent tasks when they are available and authorized. The shared workflow never requires them: it falls back to the active workspace and sequential execution while retaining the same lifecycle, approvals, verification, pull-request separation, and audit evidence.

## Safe updates and migration

The installer keeps a hash ledger at `~/.agents/skills/.prs-managed-skills.json`. It updates a managed file only when the current file still matches the last installed hash. A different file is treated as user-owned and skipped.

Legacy files under `~/.codex/skills` are retired only when they contain the PRS managed-file marker. Retirement renames `SKILL.md` to `SKILL.md.prs-retired`; unmarked custom skills remain untouched.

Legacy markers using colon names such as `prs:pr` are recognised, so the old PR alias is retired when the canonical `prs-pr` is installed. Retirement preserves the original contents in the recoverable file.
