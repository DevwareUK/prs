import { spawnSync } from "node:child_process";
import { loadRepositoryConfig } from "./config";

export const COMMON_GH_EXECUTABLE_PATHS = [
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
] as const;

type SpawnResult = {
  error?: Error;
  status?: number | null;
};

type SpawnCommand = (command: string, args: string[]) => SpawnResult;

export type GitHubCliResolutionSource =
  | "env"
  | "config"
  | "path"
  | "common-path";

export type GitHubCliAttempt = {
  path: string;
  source: GitHubCliResolutionSource;
  available: boolean;
  error?: string;
};

export type GitHubCliDiagnostics = {
  ghCandidates: GitHubCliAttempt[];
  selectedGhPath?: string;
  selectedGhSource?: GitHubCliResolutionSource;
};

export type GitHubCliResolution = {
  path?: string;
  source?: GitHubCliResolutionSource;
  diagnostics: GitHubCliDiagnostics;
};

function defaultSpawnCommand(command: string, args: string[], env: Record<string, string | undefined>): SpawnResult {
  return spawnSync(command, args, { env, stdio: "ignore", timeout: 10_000 });
}

function loadConfiguredGitHubCliPath(repoRoot: string | undefined): string | undefined {
  if (!repoRoot) {
    return undefined;
  }

  return loadRepositoryConfig(repoRoot)?.forge?.githubCliPath?.trim() || undefined;
}

function uniqueCandidates(
  candidates: Array<{ path: string | undefined; source: GitHubCliResolutionSource }>
): Array<{ path: string; source: GitHubCliResolutionSource }> {
  const seen = new Set<string>();
  const unique: Array<{ path: string; source: GitHubCliResolutionSource }> = [];
  for (const candidate of candidates) {
    const path = candidate.path?.trim();
    if (!path || seen.has(path)) {
      continue;
    }

    seen.add(path);
    unique.push({ path, source: candidate.source });
  }

  return unique;
}

function renderSpawnError(result: SpawnResult): string | undefined {
  if (result.error?.message) {
    return result.error.message;
  }

  if (typeof result.status === "number") {
    return `exit ${result.status}`;
  }

  return undefined;
}

export function resolveGitHubCli(options: {
  configuredPath?: string;
  env?: Record<string, string | undefined>;
  repoRoot?: string;
  spawnSync?: SpawnCommand;
} = {}): GitHubCliResolution {
  const env = options.env ?? process.env;
  const spawn = options.spawnSync ?? ((command: string, args: string[]) => defaultSpawnCommand(command, args, env));
  const configuredPath =
    options.configuredPath ?? loadConfiguredGitHubCliPath(options.repoRoot);
  const diagnostics: GitHubCliDiagnostics = {
    ghCandidates: [],
  };

  const candidates = uniqueCandidates([
    { path: env.PRS_GH_PATH ?? env.PRS_GITHUB_CLI_PATH, source: "env" },
    { path: configuredPath, source: "config" },
    { path: "gh", source: "path" },
    ...COMMON_GH_EXECUTABLE_PATHS.map((path) => ({
      path,
      source: "common-path" as const,
    })),
  ]);

  for (const candidate of candidates) {
    let result: SpawnResult;
    try {
      result = spawn(candidate.path, ["--version"]);
    } catch (error: unknown) {
      result = {
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
    const available = !result.error && result.status === 0;
    diagnostics.ghCandidates.push({
      ...candidate,
      available,
      error: available ? undefined : renderSpawnError(result),
    });

    if (available) {
      diagnostics.selectedGhPath = candidate.path;
      diagnostics.selectedGhSource = candidate.source;
      return {
        path: candidate.path,
        source: candidate.source,
        diagnostics,
      };
    }
  }

  return { diagnostics };
}
