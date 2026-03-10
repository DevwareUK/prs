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
