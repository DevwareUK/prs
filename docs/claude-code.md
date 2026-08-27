# Claude Code

Install the canonical Agent Skills pack:

```bash
prs skills install claude-code
```

Claude Code discovers personal skills under `~/.claude/skills`. It can select a skill from the request context or invoke one directly with its native slash form:

```text
/prs-issue 328
/prs-orchestrate 323
```

The five available names are `/prs`, `/prs-create`, `/prs-issue`, `/prs-finish`, and `/prs-orchestrate`. This is Claude Code syntax only; no slash-command behavior is added to the canonical bodies.

Claude Code-specific frontmatter, dynamic context injection, and subagent execution are optional host features. The installed PRS pack does not depend on them, so the same workflow instructions and fallbacks remain valid on every supported host.

The installer keeps its hash ledger at `~/.claude/skills/.prs-managed-skills.json`. Re-running the command updates unchanged managed copies and leaves custom or modified files untouched.
