import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ReviewedGeneratedText = {
  content: string;
  filePath: string;
};

type ReviewGeneratedTextOptions = {
  filePath: string;
  initialContent: string;
  previewHeading: string;
  prompt: string;
  emptyContentMessage: string;
  editorDescription: string;
  promptForLine(prompt: string): Promise<string>;
  validate?(content: string): void;
};

type ReviewAction = "accept" | "cancel" | "modify";

function parseReviewAction(response: string): ReviewAction | null {
  const normalized = response.trim().toLowerCase();

  if (!normalized || normalized === "y" || normalized === "yes") {
    return "accept";
  }

  if (normalized === "n" || normalized === "no") {
    return "cancel";
  }

  if (
    normalized === "m" ||
    normalized === "modify" ||
    normalized === "e" ||
    normalized === "edit"
  ) {
    return "modify";
  }

  return null;
}

function ensureNonEmptyContent(content: string, message: string): void {
  if (!content.trim()) {
    throw new Error(message);
  }
}

export function printGeneratedTextPreview(heading: string, content: string): void {
  const previewBody = content.trimEnd() || "(empty)";
  const divider = "=".repeat(heading.length);

  process.stdout.write(`\n${heading}\n${divider}\n${previewBody}\n\n`);
}

export function openFileInEditor(filePath: string, description = "file"): void {
  const editor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || "vim";

  console.log(`Opening ${description} in ${editor}...`);
  const result = spawnSync(`${editor} ${JSON.stringify(filePath)}`, {
    stdio: "inherit",
    shell: true,
  });

  if (result.error) {
    throw new Error(`Failed to open the ${description} in ${editor}. ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Editor command "${editor}" exited with status ${result.status}.`);
  }
}

export function validateCommitMessage(content: string): void {
  ensureNonEmptyContent(content, "Commit message cannot be empty.");

  const [title = ""] = content.split(/\r?\n/, 1);
  if (!title.trim()) {
    throw new Error("Commit message title cannot be empty.");
  }
}

export async function reviewGeneratedText(
  options: ReviewGeneratedTextOptions
): Promise<ReviewedGeneratedText | null> {
  mkdirSync(dirname(options.filePath), { recursive: true });
  writeFileSync(options.filePath, options.initialContent, "utf8");

  while (true) {
    const currentContent = readFileSync(options.filePath, "utf8");
    printGeneratedTextPreview(options.previewHeading, currentContent);

    const action = parseReviewAction(await options.promptForLine(options.prompt));
    if (!action) {
      console.log("Choose yes, no, or modify.");
      continue;
    }

    if (action === "cancel") {
      return null;
    }

    if (action === "modify") {
      openFileInEditor(options.filePath, options.editorDescription);
    }

    const contentToValidate =
      action === "modify" ? readFileSync(options.filePath, "utf8") : currentContent;

    try {
      ensureNonEmptyContent(contentToValidate, options.emptyContentMessage);
      options.validate?.(contentToValidate);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(message);
      continue;
    }

    if (action === "accept") {
      return {
        content: currentContent,
        filePath: options.filePath,
      };
    }
  }
}
