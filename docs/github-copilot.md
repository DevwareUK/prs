# GitHub Copilot

Install the canonical Agent Skills pack:

```bash
prs skills install copilot
```

GitHub Copilot supports personal Agent Skills under `~/.agents/skills`. This is the same location used by the Codex adapter, so installing for both hosts shares one managed copy of each canonical file.

Copilot can select a skill automatically when the request matches its description. A portable explicit prompt is:

```text
Use the prs-issue agent skill to work on GitHub issue 329.
Use the prs-pr agent skill to prepare PR 88 for local testing.
Use the prs-pr agent skill to address comments on PR 88.
```

Copilot CLI also supports prompts such as `Use the /prs-issue skill to work on GitHub issue 329.` Other Copilot surfaces may expose skills differently, so PRS does not describe `/prs-issue` as a universal Copilot slash command.

The same six names are available: `prs`, `prs-create`, `prs-issue`, `prs-finish`, `prs-pr`, and `prs-orchestrate`. Copilot-specific discovery and invocation guidance stays in this adapter documentation; the shared skill bodies remain unchanged.

`prs-pr` uses the main checkout for readiness and the requested `review`, `resolve-conflicts`, `address-comments`, or `fix-tests` action. It supports PRs without linked issues and retains approval and guarded-push steps. See [the PR workflow](agent-workflows.md#existing-pull-requests).

The installer stores shared ownership and content hashes in `~/.agents/skills/.prs-managed-skills.json`. Re-running either the Codex or Copilot installer updates unchanged managed copies and preserves custom or modified files.
