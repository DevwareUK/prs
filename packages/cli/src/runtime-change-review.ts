import { resolve } from "node:path";
import { generateCommitMessage } from "@git-ai/core";
import type { AIProvider } from "@git-ai/providers";
import {
  reviewGeneratedText,
  type ReviewedGeneratedText,
  validateCommitMessage,
} from "./generated-text-review";

function formatCommitMessage(title: string, body?: string): string {
  return body ? `${title}\n\n${body}\n` : `${title}\n`;
}

export async function generateDiffBasedCommitProposal(
  repoRoot: string,
  provider: AIProvider,
  readDiff: (repoRoot: string) => string
): Promise<{ diff: string; initialMessage: string }> {
  const diff = readDiff(repoRoot);
  const result = await generateCommitMessage(provider, diff);

  return {
    diff,
    initialMessage: formatCommitMessage(result.title, result.body),
  };
}

type ReviewCommitMessageOptions = {
  runDir: string;
  initialMessage: string;
  prompt: string;
  promptForLine(prompt: string): Promise<string>;
};

export async function reviewCommitMessage(
  options: ReviewCommitMessageOptions
): Promise<ReviewedGeneratedText | null> {
  return reviewGeneratedText({
    filePath: resolve(options.runDir, "commit-message.txt"),
    initialContent: options.initialMessage,
    previewHeading: "Proposed commit message",
    prompt: options.prompt,
    emptyContentMessage: "Commit message cannot be empty.",
    editorDescription: "commit message",
    promptForLine: options.promptForLine,
    validate: validateCommitMessage,
  });
}

type FinalizeRuntimeChangesOptions = {
  repoRoot: string;
  runDir: string;
  commitPrompt: string;
  promptForLine(prompt: string): Promise<string>;
  hasChanges(repoRoot: string): boolean;
  commitGeneratedChanges(repoRoot: string, commitMessage: ReviewedGeneratedText): void;
  resolveInitialCommitMessage(): Promise<string>;
  noChangesMessage: string;
  noChangesAction?: "return" | "throw";
  verifyBuild?: {
    buildCommand: string[];
    outputLogPath: string;
    run(repoRoot: string, buildCommand: string[], outputLogPath: string): void;
  };
  checkForChangesBeforeBuild?: boolean;
};

function handleNoChanges(
  action: "return" | "throw",
  message: string
): Extract<
  Awaited<ReturnType<typeof finalizeRuntimeChanges>>,
  { committed: false; reason: "no-changes" }
> {
  if (action === "throw") {
    throw new Error(message);
  }

  console.log(message);
  return {
    committed: false,
    reason: "no-changes",
  };
}

export async function finalizeRuntimeChanges(
  options: FinalizeRuntimeChangesOptions
): Promise<
  | {
      committed: false;
      reason: "declined" | "no-changes";
    }
  | {
      committed: true;
      commitMessage: ReviewedGeneratedText;
    }
> {
  const noChangesAction = options.noChangesAction ?? "throw";
  const checkForChangesBeforeBuild = options.checkForChangesBeforeBuild ?? false;

  if (checkForChangesBeforeBuild && !options.hasChanges(options.repoRoot)) {
    return handleNoChanges(noChangesAction, options.noChangesMessage);
  }

  if (options.verifyBuild) {
    console.log("Verifying build...");
    options.verifyBuild.run(
      options.repoRoot,
      options.verifyBuild.buildCommand,
      options.verifyBuild.outputLogPath
    );
  }

  if (!checkForChangesBeforeBuild && !options.hasChanges(options.repoRoot)) {
    return handleNoChanges(noChangesAction, options.noChangesMessage);
  }

  const initialCommitMessage = await options.resolveInitialCommitMessage();
  const reviewedCommitMessage = await reviewCommitMessage({
    runDir: options.runDir,
    initialMessage: initialCommitMessage,
    prompt: options.commitPrompt,
    promptForLine: options.promptForLine,
  });
  if (!reviewedCommitMessage) {
    console.log("Leaving the generated changes uncommitted.");
    return {
      committed: false,
      reason: "declined",
    };
  }

  console.log("Committing generated changes...");
  options.commitGeneratedChanges(options.repoRoot, reviewedCommitMessage);

  return {
    committed: true,
    commitMessage: reviewedCommitMessage,
  };
}
