import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export type TrackedCommandOptions = {
  echoOutput?: boolean;
};

export type TrackedCommandResult = {
  status: number | null;
  error?: Error;
  stdout: string;
  stderr: string;
};

export function appendRunLog(
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

export function runTrackedCommandAndCapture(
  repoRoot: string,
  outputLogPath: string,
  command: string,
  args: string[],
  options: TrackedCommandOptions = {}
): TrackedCommandResult {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  appendRunLog(outputLogPath, command, args, stdout, stderr);

  if (options.echoOutput !== false && stdout) {
    process.stdout.write(stdout);
  }

  if (options.echoOutput !== false && stderr) {
    process.stderr.write(stderr);
  }

  return {
    status: result.status,
    error: result.error ?? undefined,
    stdout,
    stderr,
  };
}

export function runTrackedCommand(
  repoRoot: string,
  outputLogPath: string,
  command: string,
  args: string[],
  errorMessage: string,
  options: TrackedCommandOptions = {}
): string {
  const result = runTrackedCommandAndCapture(
    repoRoot,
    outputLogPath,
    command,
    args,
    options
  );

  if (result.error) {
    throw new Error(`${errorMessage} ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
  }

  return result.stdout;
}
