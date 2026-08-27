# Development

Install and verify the workspace with:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test
```

The pnpm workspace contains three packages:

- `@prs/contracts`: schemas and the portable agent-workflow contract
- `@prs/core`: configuration resolution and repository path filtering
- `@prs/cli`: deterministic GitHub and local Git tools

The repository root also contains the canonical `skills/` pack. Host installers must copy its `SKILL.md` files unchanged; host-specific discovery and invocation guidance belongs in adapter code and documentation.

There are no distributable action packages and no model-provider package. `.github/workflows/test.yml` is the only workflow and exists solely to verify this repository's pull requests.

When changing a command, update `README.md` and `docs/cli-reference.md` in the same change. Verify examples against `packages/cli/src/index.ts`, `packages/cli/src/prs-tool-command.ts`, package scripts, and the retained workflow. When changing the skill inventory or installers, also run the agent-skill pack and installer tests.
