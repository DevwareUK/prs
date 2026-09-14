import { IssueDraftSet } from "@prs/contracts";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { toRepoRelativePath } from "../../run-artifacts";
import { parseIssueDraftDocument } from "./draft-parser";

export type ParsedIssueDraftSetIssue = {
  id: string;
  issueNumber?: number;
  draftFilePath: string;
  specFilePath: string;
  planFilePath: string;
  title: string;
  body: string;
  specMarkdown: string;
  planMarkdown: string;
  parentId?: string;
  dependsOn: string[];
  blocks: string[];
  related: string[];
};

export type ParsedIssueDraftSet = {
  mode: "multiple";
  sourceIssueNumber?: number;
  linkingStrategy?: string;
  orchestration:
    | { mode: "parent"; orchestratorId: string }
    | { mode: "flat"; reason: string };
  issues: ParsedIssueDraftSetIssue[];
};

export function isPathWithinDirectory(parentDir: string, candidatePath: string): boolean {
  const relativePath = relative(parentDir, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

export function loadIssueDraftSet(input: {
  repoRoot: string;
  runDir: string;
  issueSetFilePath: string;
  fallbackSourceIssueNumber?: number;
}): ParsedIssueDraftSet {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(input.issueSetFilePath, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Issue set manifest at ${toRepoRelativePath(
        input.repoRoot,
        input.issueSetFilePath
      )} is invalid JSON. ${message}`
    );
  }

  const parsedManifest = IssueDraftSet.parse(manifest);
  if (parsedManifest.mode !== "multiple") {
    throw new Error("Issue set manifest must use mode \"multiple\".");
  }
  if (parsedManifest.version !== 2) {
    throw new Error(
      "Linked issue set manifests must use version 2 with a specFile and planFile on every issue. Upgrade the manifest before retrying; no issues were changed."
    );
  }

  const resolvedRunDir = resolve(input.runDir);
  const realRunDir = realpathSync(resolvedRunDir);
  const readRunArtifact = (
    issueId: string,
    kind: "draft" | "specification" | "plan",
    configuredPath: string
  ): { filePath: string; markdown: string } => {
    const filePath = resolve(input.repoRoot, configuredPath);
    if (!isPathWithinDirectory(resolvedRunDir, filePath)) {
      throw new Error(
        `Issue set ${kind} file for "${issueId}" must stay inside ${toRepoRelativePath(
          input.repoRoot,
          resolvedRunDir
        )}.`
      );
    }
    if (!existsSync(filePath)) {
      throw new Error(
        `Issue set ${kind} file for "${issueId}" does not exist: ${toRepoRelativePath(
          input.repoRoot,
          filePath
        )}.`
      );
    }
    const realFilePath = realpathSync(filePath);
    if (!isPathWithinDirectory(realRunDir, realFilePath)) {
      throw new Error(
        `Issue set ${kind} file for "${issueId}" must stay inside ${toRepoRelativePath(
          input.repoRoot,
          resolvedRunDir
        )}; symlink escapes are not allowed.`
      );
    }
    const markdown = readFileSync(realFilePath, "utf8").trim();
    if (!markdown) {
      throw new Error(`Issue set ${kind} file for "${issueId}" must contain non-empty Markdown.`);
    }
    return { filePath, markdown };
  };

  return {
    mode: "multiple",
    sourceIssueNumber:
      parsedManifest.sourceIssueNumber ?? input.fallbackSourceIssueNumber,
    linkingStrategy: parsedManifest.linkingStrategy,
    orchestration: parsedManifest.orchestration,
    issues: parsedManifest.issues.map((issue) => {
      const draft = readRunArtifact(issue.id, "draft", issue.draftFile);
      const spec = readRunArtifact(issue.id, "specification", issue.specFile);
      const plan = readRunArtifact(issue.id, "plan", issue.planFile);
      const parsedDraft = parseIssueDraftDocument(draft.markdown);

      return {
        id: issue.id,
        issueNumber: issue.issueNumber,
        draftFilePath: draft.filePath,
        specFilePath: spec.filePath,
        planFilePath: plan.filePath,
        title: parsedDraft.title,
        body: parsedDraft.body,
        specMarkdown: spec.markdown,
        planMarkdown: plan.markdown,
        parentId: issue.parentId,
        dependsOn: issue.dependsOn,
        blocks: issue.blocks,
        related: issue.related,
      };
    }),
  };
}

export function formatIssueDraftSetPreview(
  repoRoot: string,
  issueSet: ParsedIssueDraftSet
): string {
  const orchestration = issueSet.orchestration.mode === "parent"
    ? `Hierarchy: parent orchestrator ${issueSet.orchestration.orchestratorId}`
    : `Hierarchy: intentionally flat (${issueSet.orchestration.reason})`;
  return [
    orchestration,
    ...issueSet.issues.map((issue, index) => [
      `${index + 1}. ${issue.title}${issue.issueNumber ? ` (reuse #${issue.issueNumber})` : ""}`,
      `   Draft: ${toRepoRelativePath(repoRoot, issue.draftFilePath)}`,
      `   Spec: ${toRepoRelativePath(repoRoot, issue.specFilePath)}`,
      `   Plan: ${toRepoRelativePath(repoRoot, issue.planFilePath)}`,
      `   Parent: ${issue.parentId ?? "none"}`,
      `   Depends on: ${issue.dependsOn.join(", ") || "none"}`,
    ].join("\n")),
  ].join("\n");
}
