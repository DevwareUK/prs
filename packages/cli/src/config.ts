import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEGACY_REPOSITORY_CONFIG_RELATIVE_PATH,
  REPOSITORY_CONFIG_RELATIVE_PATH,
  RepositoryConfig,
  type RepositoryConfigType,
  type ResolvedRepositoryConfigType,
} from "@prs/contracts";
import { resolveRepositoryConfig } from "@prs/core";

export { LEGACY_REPOSITORY_CONFIG_RELATIVE_PATH, REPOSITORY_CONFIG_RELATIVE_PATH };

export function getRepositoryConfigPath(repoRoot: string): string {
  return resolve(repoRoot, REPOSITORY_CONFIG_RELATIVE_PATH);
}

export function getLegacyRepositoryConfigPath(repoRoot: string): string {
  return resolve(repoRoot, LEGACY_REPOSITORY_CONFIG_RELATIVE_PATH);
}

function resolveRepositoryConfigCandidate(repoRoot: string): {
  absolutePath: string;
  relativePath: string;
} {
  const canonicalPath = getRepositoryConfigPath(repoRoot);
  if (existsSync(canonicalPath)) {
    return {
      absolutePath: canonicalPath,
      relativePath: REPOSITORY_CONFIG_RELATIVE_PATH,
    };
  }

  return {
    absolutePath: getLegacyRepositoryConfigPath(repoRoot),
    relativePath: LEGACY_REPOSITORY_CONFIG_RELATIVE_PATH,
  };
}

export function loadRepositoryConfig(repoRoot: string): RepositoryConfigType | undefined {
  const { absolutePath, relativePath } = resolveRepositoryConfigCandidate(repoRoot);
  const configPath = absolutePath;
  if (!existsSync(configPath)) {
    return undefined;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${relativePath}: ${message}`);
  }

  try {
    return RepositoryConfig.parse(parsedJson);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${relativePath}: ${message}`);
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
