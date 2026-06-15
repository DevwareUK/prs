import { existsSync,readFileSync } from "node:fs";
import { isAbsolute,resolve } from "node:path";
import { publishAuditArtifact } from "../audit-artifacts";
import { getCliArgs,getDefaultRepoRoot,getRepositoryForge } from "../cli-context";
import { loadMediaEvidenceForPublication } from "../cli-git";
import { appendMediaEvidenceSection } from "../media-evidence";
import { parseTokenUsageLedgerRowFromContent } from "../token-audit";
import { publishTokenUsageLedger } from "../token-usage-comments";
import { parseAuditCommandArgs } from "./audit";

export async function runAuditCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const command = parseAuditCommandArgs(getCliArgs());
  const artifactPath = isAbsolute(command.filePath)
    ? command.filePath
    : resolve(repoRoot, command.filePath);

  if (!existsSync(artifactPath)) {
    throw new Error(`Audit artifact file does not exist: ${command.filePath}`);
  }

  const forge = getRepositoryForge(repoRoot);
  const content = readFileSync(artifactPath, "utf8").trim();
  if (!content) {
    throw new Error(`Audit artifact file is empty: ${command.filePath}`);
  }

  if (
    (command.target.type === "issue" || command.target.type === "pull-request") &&
    command.sectionName.trim().toLowerCase() === "token-usage"
  ) {
    const row = parseTokenUsageLedgerRowFromContent(content);
    if (!row) {
      throw new Error(
        "Token usage artifacts must be structured JSON supported by prs token audit publisher."
      );
    }

    const result = await publishTokenUsageLedger(forge, {
      target: command.target,
      rows: [row],
    });
    console.log(`Token usage artifact ${result.status}: ${result.comment.url}`);
    return;
  }

  const mediaEvidence = loadMediaEvidenceForPublication(repoRoot, command.mediaManifestFilePath);
  const contentWithMedia = appendMediaEvidenceSection(content, mediaEvidence, {
    heading: "Visual Evidence",
  });

  const result = await publishAuditArtifact(forge, {
    target: command.target,
    sectionName: command.sectionName,
    content: contentWithMedia,
    localRun: command.localRun,
  });

  console.log(`Audit artifact ${result.status}: ${result.comment.url}`);
}
