#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { generateCommitMessage } from "@ai-actions/core";
import { OpenAIProvider } from "@ai-actions/providers";
import dotenv from "dotenv";

dotenv.config({ path: resolve(__dirname, "../../..", ".env"), quiet: true });

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    if (name === "OPENAI_API_KEY") {
      throw new Error(
        "OPENAI_API_KEY is required. Set it in your environment or in a .env file."
      );
    }

    throw new Error(`${name} is required.`);
  }

  return value;
}

function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readStagedDiff(): string {
  try {
    const diff = execFileSync("git", ["diff", "--cached"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!diff.trim()) {
      throw new Error(
        "No staged changes found. Stage changes before generating a commit message."
      );
    }

    return diff;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message ===
        "No staged changes found. Stage changes before generating a commit message."
    ) {
      throw error;
    }

    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim()
        : undefined;

    const detail = stderr ? ` ${stderr}` : "";
    throw new Error(
      `Failed to read staged git diff. Make sure git is installed and you are inside a git repository.${detail}`
    );
  }
}

function formatCommitMessage(title: string, body?: string): string {
  return body ? `${title}\n\n${body}\n` : `${title}\n`;
}

async function run(): Promise<void> {
  const command = process.argv[2];
  if (command && command !== "commit") {
    throw new Error(`Unknown command: ${command}. Only "commit" is supported.`);
  }

  const diff = readStagedDiff();
  const provider = new OpenAIProvider({
    apiKey: getRequiredEnv("OPENAI_API_KEY"),
    model: getOptionalEnv("OPENAI_MODEL"),
    baseUrl: getOptionalEnv("OPENAI_BASE_URL"),
  });

  const result = await generateCommitMessage(provider, diff);
  process.stdout.write(formatCommitMessage(result.title, result.body));
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
