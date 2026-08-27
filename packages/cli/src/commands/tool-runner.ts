import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  getCliArgs,
  getDefaultRepoRoot,
  getRepositoryConfig,
  getRepositoryForge,
  loadRepoEnv,
} from "../cli-context";
import { ensureCleanWorkingTree, loadMediaEvidenceForPublication } from "../cli-git";
import { contextIssueTool } from "../issue-context-tool";
import { listIssuesTool } from "../issue-list-tool";
import { publishIssueArtifactsTool } from "../issue-publish-artifacts-tool";
import { readyIssueTool } from "../issue-ready-tool";
import { appendMediaEvidenceSection } from "../media-evidence";
import { listPullRequestsTool } from "../pr-list-tool";
import { readyPullRequestTool } from "../pr-ready-tool";
import { parsePrsToolCommandArgs } from "../prs-tool-command";
import { ensureVerificationCommandAvailable } from "../workflow-preflights";
import { publishManagedCommentsFromArtifacts, ensurePrsManagedIssueBody } from "../workflows/issue/artifacts";
import { createIssueDraftSetWithRecords } from "../workflows/issue/create-set";
import { parseIssueDraftDocument } from "../workflows/issue/draft-parser";
import { loadIssueDraftSet } from "../workflows/issue/draft-set";

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export async function runToolCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  loadRepoEnv(repoRoot);
  const command = parsePrsToolCommandArgs(getCliArgs().slice(1));
  const repositoryConfig = getRepositoryConfig(repoRoot);

  if (command.kind === "issue-list") {
    writeJson(await listIssuesTool({ actionable: command.actionable, repoRoot }));
    return;
  }

  if (command.kind === "issue-context") {
    writeJson(
      await contextIssueTool({
        issueNumber: command.issueNumber,
        forge: getRepositoryForge(repoRoot),
      })
    );
    return;
  }

  if (command.kind === "issue-ready") {
    writeJson(
      await readyIssueTool({
        unattended: command.unattended,
        issueNumber: command.issueNumber,
        repoRoot,
        forge: getRepositoryForge(repoRoot),
      })
    );
    return;
  }

  if (command.kind === "issue-publish-artifacts") {
    writeJson(
      await publishIssueArtifactsTool({
        issueNumber: command.issueNumber,
        repoRoot,
        specFilePath: command.specFilePath,
        planFilePath: command.planFilePath,
        forge: getRepositoryForge(repoRoot),
      })
    );
    return;
  }

  if (command.kind === "issue-create") {
    const forge = getRepositoryForge(repoRoot);
    if (forge.type === "none") {
      writeJson({
        status: "blocked",
        message: "Repository forge support is disabled by .prs/config.json.",
        nextAction: "configure-forge",
      });
      return;
    }
    if (!forge.isAuthenticated()) {
      writeJson({
        status: "blocked",
        message:
          "GitHub issue creation requires GH_TOKEN or GITHUB_TOKEN, or an authenticated gh session.",
        nextAction: "configure-github-auth",
      });
      return;
    }

    if (command.draftFilePath) {
      const draftFilePath = resolve(repoRoot, command.draftFilePath);
      const parsed = parseIssueDraftDocument(
        appendMediaEvidenceSection(
          readFileSync(draftFilePath, "utf8"),
          loadMediaEvidenceForPublication(repoRoot, command.mediaManifestFilePath)
        )
      );
      const issue = await forge.createOrReuseIssue(
        parsed.title,
        command.forcePrsManaged
          ? ensurePrsManagedIssueBody(parsed.body)
          : parsed.body,
        command.labels
      );
      const managed = await publishManagedCommentsFromArtifacts({
        repoRoot,
        forge,
        issues: [issue],
        specFilePath: command.specFilePath,
        planFilePath: command.planFilePath,
      });
      writeJson({
        status: "ok",
        mode: "single",
        issues: [issue],
        createdIssues: [issue],
        ...managed,
      });
      return;
    }

    if (!command.issueSetFilePath) {
      throw new Error("Provide exactly one of --draft-file or --issue-set.");
    }
    if (command.mediaManifestFilePath) {
      throw new Error(
        "Media manifests are currently supported for single issue creation only."
      );
    }
    const issueSetFilePath = resolve(repoRoot, command.issueSetFilePath);
    const runDir = command.runDir
      ? resolve(repoRoot, command.runDir)
      : dirname(issueSetFilePath);
    const issues = await createIssueDraftSetWithRecords({
      issueSet: loadIssueDraftSet({ repoRoot, runDir, issueSetFilePath }),
      forge,
      labels: command.labels,
      forcePrsManaged: command.forcePrsManaged,
    });
    const managed = await publishManagedCommentsFromArtifacts({
      repoRoot,
      forge,
      issues,
      specFilePath: command.specFilePath,
      planFilePath: command.planFilePath,
    });
    writeJson({
      status: "ok",
      mode: "multiple",
      issues,
      createdIssues: issues,
      ...managed,
    });
    return;
  }

  if (command.kind === "pr-list") {
    writeJson(await listPullRequestsTool({ actionable: command.actionable, repoRoot }));
    return;
  }

  if (command.kind === "pr-ready") {
    const originalLog = console.log;
    console.log = (...values: unknown[]) => {
      process.stderr.write(`${values.map(String).join(" ")}\n`);
    };
    try {
      writeJson(
        await readyPullRequestTool({
          unattended: command.unattended,
          prNumber: command.prNumber,
          repoRoot,
          buildCommand: repositoryConfig.buildCommand,
          localRuntime: repositoryConfig.localRuntime,
          prReadiness: repositoryConfig.prReadiness,
          ensureVerificationCommandAvailable,
          forge: getRepositoryForge(repoRoot),
          ensureCleanWorkingTree,
        })
      );
    } finally {
      console.log = originalLog;
    }
    return;
  }

  throw new Error(
    "This command was removed with PRS-owned AI execution. Use the active coding agent and the retained deterministic issue/PR tools."
  );
}
