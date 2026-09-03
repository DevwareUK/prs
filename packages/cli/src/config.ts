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

export const LOCAL_REPOSITORY_CONFIG_RELATIVE_PATH = ".prs/config.local.json";
export type LocalRepositoryConfig = { forge?: { githubAccount?: string } };

export function loadLocalRepositoryConfig(repoRoot: string): LocalRepositoryConfig {
  const path = resolve(repoRoot, LOCAL_REPOSITORY_CONFIG_RELATIVE_PATH);
  if (!existsSync(path)) return {};
  // Keep personal configuration separate from the committed workflow schema.
  const invalid = () => new Error(`Invalid ${LOCAL_REPOSITORY_CONFIG_RELATIVE_PATH}: expected an optional forge.githubAccount username.`);
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { throw invalid(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some(key => key !== "forge")) throw invalid();
  if (config.forge === undefined) return {};
  if (!config.forge || typeof config.forge !== "object" || Array.isArray(config.forge)) throw invalid();
  const forge = config.forge as Record<string, unknown>;
  if (Object.keys(forge).some(key => key !== "githubAccount")) throw invalid();
  if (forge.githubAccount === undefined) return { forge: {} };
  if (typeof forge.githubAccount !== "string" || !forge.githubAccount.trim()) throw invalid();
  return { forge: { githubAccount: forge.githubAccount.trim() } };
}
