# AI Actions Architecture

This repository is a pnpm monorepo for reusable AI-powered GitHub Actions.

## Package responsibilities

- `packages/contracts`
  Shared Zod schemas and TypeScript types for inputs/outputs.

- `packages/providers`
  AI provider adapters. Providers should expose a common interface and should not contain use-case-specific logic.

- `packages/core`
  Provider-agnostic use cases such as PR description generation, CI failure explanation, and release note generation.

- `actions/*`
  Thin GitHub Action wrappers that read inputs, call core functions, and write outputs.

## Design rules

- Keep actions thin.
- Keep business logic in `packages/core`.
- Keep provider-specific code in `packages/providers`.
- Validate public contracts with Zod.
- Prefer small vertical slices over broad incomplete abstractions.
- Build one provider first: OpenAI.
- Build one action first: `pr-description`.

## Local hooks

Husky is configured through the root `prepare` script. Run `pnpm install` once in the repo to enable local Git hooks.

For local development and Git hooks, create a `.env` file in the repository root. Set `OPENAI_API_KEY` there. `OPENAI_MODEL` and `OPENAI_BASE_URL` are optional overrides. The CLI loads this file before reading environment variables so Husky hooks and GUI Git clients can use the same configuration reliably.

`.env` files must not be committed. This repository ignores `.env` and `.env.*`, while allowing committed examples such as `.env.example`.

Example:

```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=
```

The local `prepare-commit-msg` hook pre-populates the commit message before the editor opens by calling the existing CLI commit generator. It uses the same `OPENAI_API_KEY`, optional `OPENAI_MODEL`, and optional `OPENAI_BASE_URL` values loaded by the CLI.

The hook is non-blocking. If AI generation fails, the commit still proceeds. It skips flows where Git or the user already supplied the message, including merge, squash, amend/reuse, and manual `-m` or `-F` commit messages.
