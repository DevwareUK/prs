import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type CodexSessionModelMetadata = {
  threadId: string;
  model: string;
  reasoningEffort?: string;
};

type ExecFileSync = typeof execFileSync;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function getCodexHome(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME?.trim() || resolve(homedir(), ".codex");
}

export function loadCodexSessionModelMetadata(options?: {
  env?: NodeJS.ProcessEnv;
  execFileSyncImpl?: ExecFileSync;
  codexHome?: string;
}): CodexSessionModelMetadata | undefined {
  const env = options?.env ?? process.env;
  if (!options?.env && env.VITEST === "true") {
    return undefined;
  }

  const threadId = env.CODEX_THREAD_ID?.trim();
  if (!threadId) {
    return undefined;
  }

  const codexHome = options?.codexHome ?? getCodexHome(env);
  const stateDbPath = resolve(codexHome, "state_5.sqlite");
  if (!existsSync(stateDbPath)) {
    return undefined;
  }

  const query = [
    "select coalesce(model, ''), coalesce(reasoning_effort, '')",
    "from threads",
    `where id = ${sqlString(threadId)}`,
    "limit 1;",
  ].join(" ");

  try {
    const output = (options?.execFileSyncImpl ?? execFileSync)(
      "sqlite3",
      ["-separator", "\t", stateDbPath, query],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    const [model, reasoningEffort] = output.split("\t");
    if (!model) {
      return undefined;
    }

    return {
      threadId,
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
  } catch {
    return undefined;
  }
}
