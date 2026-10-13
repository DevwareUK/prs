import { existsSync,readFileSync } from "node:fs";
import { isAbsolute,resolve } from "node:path";
import { publishAuditArtifact } from "../audit-artifacts";
import { getCliArgs,getDefaultRepoRoot,getRepositoryForge,getIssueTracker } from "../cli-context";
import { loadMediaEvidenceForPublication } from "../cli-git";
import { appendMediaEvidenceSection } from "../media-evidence";
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

  const store = command.target.type === "issue" ? issueAuditStore(repoRoot) : forgeAuditStore(repoRoot);
  const content = readFileSync(artifactPath, "utf8").trim();
  if (!content) {
    throw new Error(`Audit artifact file is empty: ${command.filePath}`);
  }

  const mediaEvidence = loadMediaEvidenceForPublication(repoRoot, command.mediaManifestFilePath);
  const contentWithMedia = appendMediaEvidenceSection(content, mediaEvidence, {
    heading: "Visual Evidence",
  });

  const result = await publishAuditArtifact(store, {
    target: command.target,
    sectionName: command.sectionName,
    content: contentWithMedia,
    localRun: command.localRun,
  });

  console.log(`Audit artifact ${result.status}: ${result.comment.url}`);
}

function issueAuditStore(repoRoot: string) {
  const tracker = getIssueTracker(repoRoot);
  if (tracker.type === "none") throw new Error("Configure issueTracker.type before publishing issue audits.");
  return {
    isAuthenticated: () => tracker.isAuthenticated(),
    fetchAuditComment: tracker.fetchAuditComment.bind(tracker),
    createAuditComment: tracker.createAuditComment.bind(tracker),
    updateComment: tracker.updateIssueComment.bind(tracker),
  };
}
function forgeAuditStore(repoRoot: string) {
  const forge = getRepositoryForge(repoRoot);
  if (forge.type === "none") throw new Error("Configure forge.type before publishing PR audits.");
  return forge;
}
