# Claude Code

Install the canonical Agent Skills pack:

```bash
prs skills install claude-code
```

Claude Code discovers personal skills under `~/.claude/skills`. It can select a skill from the request context or invoke one directly with its native slash form:

```text
/prs-issue 328
/prs-orchestrate 323
/prs-pr 88
/prs-pr 88 address-comments
```

The six available names are `/prs`, `/prs-create`, `/prs-issue`, `/prs-finish`, `/prs-pr`, and `/prs-orchestrate`. This is Claude Code syntax only; no slash-command behavior is added to the canonical bodies.

`/prs-pr 88` prepares the PR in the main checkout with configured readiness steps, then offers `review`, `resolve-conflicts`, `address-comments`, and `fix-tests`. These are agent actions rather than new CLI commands. PRs do not need a linked issue. See [the PR workflow](agent-workflows.md#existing-pull-requests) for publication and push safeguards.

Claude Code-specific frontmatter, dynamic context injection, and subagent execution are optional host features. The installed PRS pack does not depend on them, so the same workflow instructions and fallbacks remain valid on every supported host.

The installer keeps its hash ledger at `~/.claude/skills/.prs-managed-skills.json`. Re-running the command updates unchanged managed copies and leaves custom or modified files untouched.
