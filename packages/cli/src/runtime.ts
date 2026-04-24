import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import { toRepoRelativePath } from "./run-artifacts";

export type InteractiveRuntimeType =
  ResolvedRepositoryConfigType["ai"]["runtime"]["type"];

export type InteractiveRuntimeLaunchResult = {
  invocation: "new" | "resume";
  sessionId?: string;
};

type RuntimeAvailability = {
  available: true;
} | {
  available: false;
  reason: string;
};

export type RuntimeWorkspace = {
  promptFilePath: string;
  outputLogPath: string;
};

type RuntimeLaunchOptions = {
  resumeSessionId?: string;
};

type UnattendedRuntimeLaunchOptions = RuntimeLaunchOptions & {
  outputLastMessageFilePath?: string;
};

type InteractiveRuntime = {
  type: InteractiveRuntimeType;
  displayName: string;
  metadata: {
    command: string;
    supportsSessionTracking: boolean;
    sandboxMode?: string;
    approvalPolicy?: string;
  };
  checkAvailability(): RuntimeAvailability;
  launch(
    repoRoot: string,
    workspace: RuntimeWorkspace,
    options?: RuntimeLaunchOptions
  ): InteractiveRuntimeLaunchResult;
  launchUnattended?(
    repoRoot: string,
    workspace: RuntimeWorkspace,
    options?: UnattendedRuntimeLaunchOptions
  ): InteractiveRuntimeLaunchResult;
};

type SelectRuntimeOptions = {
  onFallback?(message: string): void;
};

type CodexSessionRecord = {
  id: string;
  timestamp: string;
  cwd: string;
  filePath: string;
};

const DEFAULT_RUNTIME_TYPE: InteractiveRuntimeType = "codex";
const CODEX_SANDBOX_MODE = "workspace-write";
const CODEX_APPROVAL_POLICY = "on-request";

function appendRunLog(
  outputLogPath: string,
  command: string,
  args: string[],
  stdout: string,
  stderr: string
): void {
  const renderedCommand = [command, ...args]
    .map((value) => (value.includes(" ") ? JSON.stringify(value) : value))
    .join(" ");

  appendFileSync(
    outputLogPath,
    [`$ ${renderedCommand}`, stdout, stderr, ""].join("\n"),
    "utf8"
  );
}

function runInteractiveCommand(
  command: string,
  args: string[],
  errorMessage: string,
  cwd?: string
): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`${errorMessage} ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
}

function runTrackedCommand(
  command: string,
  args: string[],
  errorMessage: string,
  outputLogPath: string,
  cwd?: string
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  appendRunLog(outputLogPath, command, args, stdout, stderr);

  if (stdout) {
    process.stdout.write(stdout);
  }

  if (stderr) {
    process.stderr.write(stderr);
  }

  if (result.error) {
    throw new Error(`${errorMessage} ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
  }

  return stdout;
}

function canRunCommand(command: string, args: string[] = ["--version"]): boolean {
  const result = spawnSync(command, args, {
    stdio: "ignore",
  });

  return !result.error && result.status === 0;
}

function getCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || resolve(homedir(), ".codex");
}

export function isCodexSuperpowersAvailable(codexHome = getCodexHome()): boolean {
  const pluginCacheRoot = resolve(
    codexHome,
    "plugins",
    "cache",
    "openai-curated",
    "superpowers"
  );

  if (!existsSync(pluginCacheRoot)) {
    return false;
  }

  try {
    return readdirSync(pluginCacheRoot, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() &&
        existsSync(resolve(pluginCacheRoot, entry.name, "skills", "brainstorming", "SKILL.md")) &&
        existsSync(resolve(pluginCacheRoot, entry.name, "skills", "writing-plans", "SKILL.md"))
    );
  } catch {
    return false;
  }
}

function listFilesRecursively(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  const visitDirectory = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(entryPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  };

  visitDirectory(rootDir);
  return files.sort();
}

function readCodexSessionRecord(filePath: string): CodexSessionRecord | undefined {
  try {
    const content = readFileSync(filePath, "utf8");
    const firstLine = content.split(/\r?\n/, 1)[0];
    if (!firstLine) {
      return undefined;
    }

    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: {
        id?: string;
        timestamp?: string;
        cwd?: string;
      };
    };

    if (
      parsed.type !== "session_meta" ||
      !parsed.payload?.id ||
      !parsed.payload.timestamp ||
      !parsed.payload.cwd
    ) {
      return undefined;
    }

    return {
      id: parsed.payload.id,
      timestamp: parsed.payload.timestamp,
      cwd: parsed.payload.cwd,
      filePath,
    };
  } catch {
    return undefined;
  }
}

function listCodexSessionRecords(repoRoot: string): CodexSessionRecord[] {
  const sessionsRoot = resolve(getCodexHome(), "sessions");
  return listFilesRecursively(sessionsRoot)
    .filter((filePath) => filePath.endsWith(".jsonl"))
    .map((filePath) => readCodexSessionRecord(filePath))
    .filter(
      (record): record is CodexSessionRecord =>
        record !== undefined && record.cwd === repoRoot
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function findCodexSessionById(
  repoRoot: string,
  sessionId: string
): CodexSessionRecord | undefined {
  return listCodexSessionRecords(repoRoot).find((record) => record.id === sessionId);
}

function findNewCodexSessionId(
  repoRoot: string,
  previousSessionFilePaths: Set<string>,
  startedAt: number
): string | undefined {
  const sessionRecords = listCodexSessionRecords(repoRoot);
  const newlyCreatedSessions = sessionRecords.filter(
    (record) => !previousSessionFilePaths.has(record.filePath)
  );

  if (newlyCreatedSessions.length > 0) {
    return newlyCreatedSessions.at(-1)?.id;
  }

  return sessionRecords
    .filter((record) => Date.parse(record.timestamp) >= startedAt - 1000)
    .at(-1)?.id;
}

function createCodexRuntime(): InteractiveRuntime {
  return {
    type: "codex",
    displayName: "Codex",
    metadata: {
      command: "codex",
      supportsSessionTracking: true,
      sandboxMode: CODEX_SANDBOX_MODE,
      approvalPolicy: CODEX_APPROVAL_POLICY,
    },
    checkAvailability() {
      return canRunCommand("codex")
        ? { available: true }
        : {
            available: false,
            reason: "the `codex` CLI is not available on PATH",
          };
    },
    launch(repoRoot, workspace, options = {}) {
      const args = options.resumeSessionId
        ? [
            "resume",
            options.resumeSessionId,
            "--sandbox",
            CODEX_SANDBOX_MODE,
            "--ask-for-approval",
            CODEX_APPROVAL_POLICY,
            "--cd",
            repoRoot,
          ]
        : [
            "--sandbox",
            CODEX_SANDBOX_MODE,
            "--ask-for-approval",
            CODEX_APPROVAL_POLICY,
            "--cd",
            repoRoot,
            `Read and follow the instructions in ${toRepoRelativePath(
              repoRoot,
              workspace.promptFilePath
            )}.`,
          ];
      const startedAt = Date.now();
      const previousSessionFilePaths = new Set(
        options.resumeSessionId
          ? []
          : listCodexSessionRecords(repoRoot).map((record) => record.filePath)
      );

      appendRunLog(
        workspace.outputLogPath,
        "codex",
        args,
        "[interactive Codex session opened in current terminal]",
        ""
      );

      runInteractiveCommand(
        "codex",
        args,
        "The interactive Codex session did not complete successfully.",
        repoRoot
      );

      if (options.resumeSessionId) {
        return {
          invocation: "resume",
          sessionId: options.resumeSessionId,
        };
      }

      const sessionId = findNewCodexSessionId(
        repoRoot,
        previousSessionFilePaths,
        startedAt
      );
      if (!sessionId) {
        appendFileSync(
          workspace.outputLogPath,
          [
            "Warning: prs could not determine the new Codex session id for future resume support.",
            "",
          ].join("\n"),
          "utf8"
        );
      }

      return {
        invocation: "new",
        sessionId,
      };
    },
    launchUnattended(repoRoot, workspace, options = {}) {
      const prompt = `Read and follow the instructions in ${toRepoRelativePath(
        repoRoot,
        workspace.promptFilePath
      )}.`;
      const startedAt = Date.now();
      const previousSessionFilePaths = new Set(
        options.resumeSessionId
          ? []
          : listCodexSessionRecords(repoRoot).map((record) => record.filePath)
      );
      const args = options.resumeSessionId
        ? [
            "exec",
            "resume",
            "--full-auto",
            ...(options.outputLastMessageFilePath
              ? ["--output-last-message", options.outputLastMessageFilePath]
              : []),
            options.resumeSessionId,
            prompt,
          ]
        : [
            "exec",
            "--full-auto",
            "--cd",
            repoRoot,
            ...(options.outputLastMessageFilePath
              ? ["--output-last-message", options.outputLastMessageFilePath]
              : []),
            prompt,
          ];

      runTrackedCommand(
        "codex",
        args,
        "The unattended Codex session did not complete successfully.",
        workspace.outputLogPath,
        repoRoot
      );

      if (options.resumeSessionId) {
        return {
          invocation: "resume",
          sessionId: options.resumeSessionId,
        };
      }

      const sessionId = findNewCodexSessionId(
        repoRoot,
        previousSessionFilePaths,
        startedAt
      );
      if (!sessionId) {
        appendFileSync(
          workspace.outputLogPath,
          [
            "Warning: prs could not determine the new Codex session id for future resume support.",
            "",
          ].join("\n"),
          "utf8"
        );
      }

      return {
        invocation: "new",
        sessionId,
      };
    },
  };
}

function createClaudeCodeRuntime(): InteractiveRuntime {
  return {
    type: "claude-code",
    displayName: "Claude Code",
    metadata: {
      command: "claude",
      supportsSessionTracking: false,
    },
    checkAvailability() {
      return canRunCommand("claude")
        ? { available: true }
        : {
            available: false,
            reason: "the `claude` CLI is not available on PATH",
          };
    },
    launch(repoRoot, workspace) {
      const prompt = `Read and follow the instructions in ${toRepoRelativePath(
        repoRoot,
        workspace.promptFilePath
      )}.`;
      const args = [prompt];

      appendRunLog(
        workspace.outputLogPath,
        "claude",
        args,
        "[interactive Claude Code session opened in current terminal]",
        ""
      );

      runInteractiveCommand(
        "claude",
        args,
        "The interactive Claude Code session did not complete successfully.",
        repoRoot
      );

      return {
        invocation: "new",
      };
    },
  };
}

function createRuntimeRegistry(): Record<InteractiveRuntimeType, InteractiveRuntime> {
  return {
    codex: createCodexRuntime(),
    "claude-code": createClaudeCodeRuntime(),
  };
}

function formatRuntimeUnavailableMessage(
  runtime: InteractiveRuntime,
  reason: string
): string {
  return `Configured runtime "${runtime.displayName}" is unavailable because ${reason}.`;
}

export function selectInteractiveRuntime(
  runtimeConfig: ResolvedRepositoryConfigType["ai"]["runtime"],
  options: SelectRuntimeOptions = {}
): InteractiveRuntime {
  const runtimes = createRuntimeRegistry();
  const configuredRuntime = runtimes[runtimeConfig.type];
  const configuredAvailability = configuredRuntime.checkAvailability();
  if (configuredAvailability.available) {
    return configuredRuntime;
  }

  if (runtimeConfig.type === DEFAULT_RUNTIME_TYPE) {
    throw new Error(
      `${formatRuntimeUnavailableMessage(
        configuredRuntime,
        configuredAvailability.reason
      )} Install the missing dependency before running interactive prs workflows.`
    );
  }

  const defaultRuntime = runtimes[DEFAULT_RUNTIME_TYPE];
  const defaultAvailability = defaultRuntime.checkAvailability();
  if (defaultAvailability.available) {
    options.onFallback?.(
      `${formatRuntimeUnavailableMessage(
        configuredRuntime,
        configuredAvailability.reason
      )} Falling back to the default runtime "${defaultRuntime.displayName}".`
    );
    return defaultRuntime;
  }

  throw new Error(
    `${formatRuntimeUnavailableMessage(
      configuredRuntime,
      configuredAvailability.reason
    )} The default runtime "${defaultRuntime.displayName}" is also unavailable because ${defaultAvailability.reason}.`
  );
}

export function getInteractiveRuntimeByType(
  runtimeType: InteractiveRuntimeType
): InteractiveRuntime {
  return createRuntimeRegistry()[runtimeType];
}

export function launchUnattendedRuntime(
  runtimeType: InteractiveRuntimeType,
  repoRoot: string,
  workspace: RuntimeWorkspace,
  options: UnattendedRuntimeLaunchOptions = {}
): InteractiveRuntimeLaunchResult {
  const runtime = getInteractiveRuntimeByType(runtimeType);
  if (!runtime.launchUnattended) {
    throw new Error(
      `Runtime "${runtime.displayName}" does not support unattended issue runs.`
    );
  }

  return runtime.launchUnattended(repoRoot, workspace, options);
}

export function findTrackedRuntimeSessionById(
  runtimeType: InteractiveRuntimeType,
  repoRoot: string,
  sessionId: string
): { id: string } | undefined {
  if (runtimeType !== "codex") {
    return undefined;
  }

  return findCodexSessionById(repoRoot, sessionId);
}
