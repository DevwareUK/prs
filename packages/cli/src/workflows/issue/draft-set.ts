import { IssueDraftSet } from "@prs/contracts";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { toRepoRelativePath } from "../../run-artifacts";
import { parseIssueDraftDocument } from "./draft-parser";

export type ParsedIssueDraftSetIssue = {
  id: string;
  draftFilePath: string;
  title: string;
  body: string;
  dependsOn: string[];
  blocks: string[];
  related: string[];
};

export type ParsedIssueDraftSet = {
  mode: "multiple";
  sourceIssueNumber?: number;
  linkingStrategy?: string;
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

  return {
    mode: "multiple",
    sourceIssueNumber:
      parsedManifest.sourceIssueNumber ?? input.fallbackSourceIssueNumber,
    linkingStrategy: parsedManifest.linkingStrategy,
    issues: parsedManifest.issues.map((issue) => {
      const draftFilePath = resolve(input.repoRoot, issue.draftFile);
      if (!isPathWithinDirectory(input.runDir, draftFilePath)) {
        throw new Error(
          `Issue set draft file for "${issue.id}" must stay inside ${toRepoRelativePath(
            input.repoRoot,
            input.runDir
          )}.`
        );
      }

      if (!existsSync(draftFilePath)) {
        throw new Error(
          `Issue set draft file for "${issue.id}" does not exist: ${toRepoRelativePath(
            input.repoRoot,
            draftFilePath
          )}.`
        );
      }

      const parsedDraft = parseIssueDraftDocument(
        readFileSync(draftFilePath, "utf8")
      );

      return {
        id: issue.id,
        draftFilePath,
        title: parsedDraft.title,
        body: parsedDraft.body,
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
  return issueSet.issues
    .map(
      (issue, index) =>
        `${index + 1}. ${issue.title}\n   Draft: ${toRepoRelativePath(
          repoRoot,
          issue.draftFilePath
        )}`
    )
    .join("\n");
}
