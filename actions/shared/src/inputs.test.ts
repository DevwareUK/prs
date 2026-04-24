import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getOptionalInlineOrFileInput,
  getRequiredInlineOrFileInput,
} from "./inputs";

let tempDirPath: string | undefined;
let originalDiff: string | undefined;
let originalDiffFile: string | undefined;
let originalCommitMessages: string | undefined;
let originalCommitMessagesFile: string | undefined;

function writeTempFile(name: string, contents: string): string {
  if (!tempDirPath) {
    tempDirPath = mkdtempSync(join(tmpdir(), "prs-action-inputs-"));
  }

  const filePath = join(tempDirPath, name);
  writeFileSync(filePath, contents);
  return filePath;
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

beforeEach(() => {
  originalDiff = process.env.INPUT_DIFF;
  originalDiffFile = process.env.INPUT_DIFF_FILE;
  originalCommitMessages = process.env.INPUT_COMMIT_MESSAGES;
  originalCommitMessagesFile = process.env.INPUT_COMMIT_MESSAGES_FILE;
});

afterEach(() => {
  restoreEnvValue("INPUT_DIFF", originalDiff);
  restoreEnvValue("INPUT_DIFF_FILE", originalDiffFile);
  restoreEnvValue("INPUT_COMMIT_MESSAGES", originalCommitMessages);
  restoreEnvValue("INPUT_COMMIT_MESSAGES_FILE", originalCommitMessagesFile);

  if (tempDirPath) {
    rmSync(tempDirPath, { recursive: true, force: true });
    tempDirPath = undefined;
  }
});

describe("action input helpers", () => {
  it("returns the inline input when no file input is provided", () => {
    process.env.INPUT_DIFF = "diff --git a/file.ts b/file.ts";
    delete process.env.INPUT_DIFF_FILE;

    expect(getRequiredInlineOrFileInput("diff", "diff_file")).toBe(
      "diff --git a/file.ts b/file.ts"
    );
  });

  it("prefers the file input when both variants are provided", () => {
    process.env.INPUT_DIFF = "inline diff";
    process.env.INPUT_DIFF_FILE = writeTempFile(
      "review.diff",
      "diff --git a/from.ts b/from.ts\n+new line\n"
    );

    expect(getRequiredInlineOrFileInput("diff", "diff_file")).toBe(
      "diff --git a/from.ts b/from.ts\n+new line\n"
    );
  });

  it("returns optional content from a file input", () => {
    process.env.INPUT_COMMIT_MESSAGES_FILE = writeTempFile(
      "commits.txt",
      "feat: add runtime selection\n\nfix: tighten provider fallback\n"
    );
    delete process.env.INPUT_COMMIT_MESSAGES;

    expect(getOptionalInlineOrFileInput("commit_messages", "commit_messages_file")).toBe(
      "feat: add runtime selection\n\nfix: tighten provider fallback\n"
    );
  });

  it("throws when the required inline and file inputs are both missing", () => {
    delete process.env.INPUT_DIFF;
    delete process.env.INPUT_DIFF_FILE;

    expect(() => getRequiredInlineOrFileInput("diff", "diff_file")).toThrow(
      "Missing required input: diff or diff_file"
    );
  });

  it("throws a readable error when the input file cannot be read", () => {
    process.env.INPUT_DIFF_FILE = join(
      tmpdir(),
      `missing-prs-action-${Date.now()}-${Math.random().toString(16).slice(2)}.diff`
    );
    delete process.env.INPUT_DIFF;

    expect(() => getRequiredInlineOrFileInput("diff", "diff_file")).toThrow(
      /Failed to read diff_file/
    );
  });
});
