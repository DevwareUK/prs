import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  captureStdout,
  loadCli,
} from "./index-test-support";

describe("Issue finalize workflow", () => {
  it("reviews a deterministic commit message without requiring an OpenAI API key", async () => {
    const { run, spawnSync, generateCommitMessage } = await loadCli({
      readlineAnswers: ["y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,2 @@",
            '-const state = "before";',
            '+const state = "after";',
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "finalize", "29"];

    await run();

    const commitCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "commit"
    );
    expect(commitCall).toBeDefined();
    const commitArgs = commitCall?.[1] as string[];
    expect(readFileSync(commitArgs[2], "utf8")).toContain("feat: finalize issue #29");
    expect(generateCommitMessage).not.toHaveBeenCalled();
  });

  it("lets issue finalize review and modify the proposed commit message before committing", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const { run, spawnSync, generateCommitMessage } = await loadCli({
      commitMessageResult: {
        title: "feat: propose issue finalize commit message",
        body: "Generated from the current diff.",
      },
      readlineAnswers: ["m", "y"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,2 @@",
            '-const state = "before";',
            '+const state = "after";',
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command.startsWith("vim ")) {
          const [, quotedPath = ""] = command.match(/"([^"]+)"/) ?? [];
          writeFileSync(
            quotedPath,
            "feat: refine issue finalize commit message\n\nReviewed before commit.\n",
            "utf8"
          );
          return { status: 0 };
        }

        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "finalize", "29"];
    const stdout = captureStdout();

    await run();

    const commitCall = spawnSync.mock.calls.find(
      ([command, args]) =>
        command === "git" &&
        Array.isArray(args) &&
        args[0] === "commit"
    );
    expect(commitCall).toBeDefined();
    const commitArgs = commitCall?.[1] as string[];
    expect(commitArgs).toEqual(["commit", "-F", expect.stringContaining("commit-message.txt")]);
    expect(readFileSync(commitArgs[2], "utf8")).toContain(
      "feat: refine issue finalize commit message"
    );
    expect(stdout.output()).toContain("Proposed commit message");
    expect(generateCommitMessage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts')
    );
  });

  it("leaves issue finalize changes uncommitted when the reviewed message is declined", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const { run, spawnSync } = await loadCli({
      readlineAnswers: ["n"],
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "status") {
          return " M packages/cli/src/index.ts\n";
        }

        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "packages/cli/src/index.ts\n";
        }

        if (
          command === "git" &&
          args[0] === "diff" &&
          args[1] === "HEAD" &&
          args[2] === "--" &&
          args[3] === "packages/cli/src/index.ts"
        ) {
          return [
            "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
            "--- a/packages/cli/src/index.ts",
            "+++ b/packages/cli/src/index.ts",
            "@@ -1,1 +1,2 @@",
            '-const state = "before";',
            '+const state = "after";',
          ].join("\n");
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
      spawnSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "add") {
          return { status: 0 };
        }

        if (command === "git" && args[0] === "commit") {
          return { status: 0 };
        }

        throw new Error(`Unexpected spawnSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "finalize", "29"];

    const messages: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      messages.push(String(message ?? ""));
    });
    await run();

    expect(messages.join("\n")).toContain("Leaving the generated changes uncommitted.");
    expect(
      spawnSync.mock.calls.some(
        ([command, args]) =>
          command === "git" &&
          Array.isArray(args) &&
          args[0] === "commit"
      )
    ).toBe(false);
  });

  it("fails issue finalize clearly when no generated changes exist", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const { run } = await loadCli({
      execFileSyncImpl: (command, args) => {
        if (command === "git" && args[0] === "diff" && args[1] === "--name-only") {
          return "";
        }

        throw new Error(`Unexpected execFileSync call: ${command} ${args.join(" ")}`);
      },
    });

    process.argv = ["node", "prs", "issue", "finalize", "29"];

    await expect(run()).rejects.toThrow(
      "The interactive runtime completed without producing any file changes to commit."
    );
  });
});
