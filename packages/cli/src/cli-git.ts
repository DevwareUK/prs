import { execFileSync, spawnSync } from "node:child_process";
import {
  loadMediaEvidenceManifest,
  resolveRepositoryMediaEvidence,
} from "./media-evidence";

function git(repoRoot: string, args: string[], errorMessage: string): string {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(stderr ? `${errorMessage} ${stderr}` : errorMessage);
  }
}

export function ensureCleanWorkingTree(repoRoot: string): void {
  if (git(repoRoot, ["status", "--porcelain"], "Failed to inspect the working tree.")) {
    throw new Error("This workflow requires a clean working tree. Commit or stash local changes first.");
  }
}

export function resolveGitHubOrigin(repoRoot: string): { owner: string; repo: string } {
  const remoteUrl = git(
    repoRoot,
    ["remote", "get-url", "origin"],
    "Media rendering for tracked repository files requires a GitHub origin remote."
  );
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error("Media rendering requires a GitHub origin remote.");
  return { owner: match[1], repo: match[2] };
}

export function resolveCurrentBranchName(repoRoot: string): string {
  const branchName = git(repoRoot, ["branch", "--show-current"], "Failed to resolve the current branch.");
  if (!branchName) throw new Error("Media rendering requires a checked out branch.");
  return branchName;
}

export function isGitTrackedPath(repoRoot: string, path: string): boolean {
  const result = spawnSync("git", ["-C", repoRoot, "ls-files", "--error-unmatch", "--", path], {
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

export function loadMediaEvidenceForPublication(
  repoRoot: string,
  manifestPath: string | undefined
): ReturnType<typeof loadMediaEvidenceManifest> {
  const evidence = manifestPath ? loadMediaEvidenceManifest(repoRoot, manifestPath) : [];
  const trackedPaths = evidence
    .filter((item) => item.source.type === "local")
    .map((item) => item.source.value)
    .filter((path) => isGitTrackedPath(repoRoot, path));
  if (trackedPaths.length === 0) {
    return evidence.filter((item) => item.source.type !== "local");
  }
  return resolveRepositoryMediaEvidence(evidence, {
    ...resolveGitHubOrigin(repoRoot),
    refName: resolveCurrentBranchName(repoRoot),
    trackedPaths,
  });
}
