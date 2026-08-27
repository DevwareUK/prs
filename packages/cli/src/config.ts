import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REPOSITORY_CONFIG_RELATIVE_PATH,
  migrateRepositoryConfigToAgentWorkflow,
  type RepositoryConfigType,
  type ResolvedRepositoryConfigType,
} from "@prs/contracts";
import { resolveRepositoryConfig } from "@prs/core";

export { REPOSITORY_CONFIG_RELATIVE_PATH };

export function getRepositoryConfigPath(repoRoot: string): string {
  return resolve(repoRoot, REPOSITORY_CONFIG_RELATIVE_PATH);
}

export function loadRepositoryConfig(repoRoot: string): RepositoryConfigType | undefined {
  const configPath = getRepositoryConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return undefined;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${REPOSITORY_CONFIG_RELATIVE_PATH}: ${message}`);
  }

  try {
    const migration = migrateRepositoryConfigToAgentWorkflow(parsedJson);
    for (const notice of migration.notices) {
      console.error(`prs configuration migration: ${notice}`);
    }
    return migration.config;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${REPOSITORY_CONFIG_RELATIVE_PATH}: ${message}`);
  }
}

export function loadResolvedRepositoryConfig(repoRoot: string): ResolvedRepositoryConfigType {
  return resolveRepositoryConfig(loadRepositoryConfig(repoRoot));
}

export function formatCommandForDisplay(command: string[]): string {
  return command
    .map((segment) => (/\s/.test(segment) ? JSON.stringify(segment) : segment))
    .join(" ");
}
