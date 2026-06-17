import { existsSync,readFileSync } from "node:fs";
import { dirname,isAbsolute,resolve } from "node:path";
import { publishAuditArtifact } from "../audit-artifacts";
import { getCliArgs,getDefaultRepoRoot,getRepositoryConfig,getRepositoryForge } from "../cli-context";
import { loadMediaEvidenceForPublication } from "../cli-git";
import { loadCodexSessionModelMetadata } from "../codex-session-metadata";
import { appendMediaEvidenceSection } from "../media-evidence";
import {
enrichTokenUsageLedgerRowsWithCodexSessionModel,
enrichTokenUsageLedgerRowsWithConfiguredModelFallbacks,
getTokenUsageArtifactFilePath,
parseTokenUsageLedgerRowsFromContent
} from "../token-audit";
import { publishTokenUsageLedger } from "../token-usage-comments";
import { parseAuditCommandArgs } from "./audit";

function parseTokenUsageRowsForPublication(input: {
  content: string;
  repoRoot: string;
}) {
  return enrichTokenUsageLedgerRowsWithConfiguredModelFallbacks(
    enrichTokenUsageLedgerRowsWithCodexSessionModel(
      parseTokenUsageLedgerRowsFromContent(input.content),
      loadCodexSessionModelMetadata()
    ),
    getRepositoryConfig(input.repoRoot)
  );
}

async function publishRunTokenUsageArtifact(input: {
  artifactPath: string;
  forge: ReturnType<typeof getRepositoryForge>;
  repoRoot: string;
  target: ReturnType<typeof parseAuditCommandArgs>["target"];
}): Promise<void> {
  if (input.target.type !== "issue" && input.target.type !== "pull-request") {
    return;
  }

  const tokenUsageArtifactPath = getTokenUsageArtifactFilePath(dirname(input.artifactPath));
  if (!existsSync(tokenUsageArtifactPath)) {
    return;
  }

  const rows = parseTokenUsageRowsForPublication({
    content: readFileSync(tokenUsageArtifactPath, "utf8").trim(),
    repoRoot: input.repoRoot,
  });
  if (rows.length === 0) {
    throw new Error(
      "Token usage artifacts must be structured JSON supported by prs token audit publisher."
    );
  }

  const result = await publishTokenUsageLedger(input.forge, {
    target: input.target,
    rows,
  });
  console.log(`Token usage artifact ${result.status}: ${result.comment.url}`);
}

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
    const rows = parseTokenUsageRowsForPublication({ content, repoRoot });
    if (rows.length === 0) {
      throw new Error(
        "Token usage artifacts must be structured JSON supported by prs token audit publisher."
      );
    }

    const result = await publishTokenUsageLedger(forge, {
      target: command.target,
      rows,
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
  await publishRunTokenUsageArtifact({
    artifactPath,
    forge,
    repoRoot,
    target: command.target,
  });
}
