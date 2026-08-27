import { resolve } from "node:path";
import dotenv from "dotenv";
import { loadResolvedRepositoryConfig } from "./config";
import { createRepositoryForge, type RepositoryForge } from "./forge";
import { resolveRuntimeRepoRoot } from "./repo-root";

export function getCliArgs(): string[] {
  return process.argv.slice(2).filter((arg) => arg !== "--");
}

export function getDefaultRepoRoot(): string {
  return resolveRuntimeRepoRoot();
}

export function loadRepoEnv(repoRoot: string): void {
  dotenv.config({ path: resolve(repoRoot, ".env"), quiet: true });
}

export function getRepositoryConfig(repoRoot = getDefaultRepoRoot()) {
  return loadResolvedRepositoryConfig(repoRoot);
}

export function getRepositoryForge(repoRoot = getDefaultRepoRoot()): RepositoryForge {
  return createRepositoryForge(repoRoot, getRepositoryConfig(repoRoot));
}
