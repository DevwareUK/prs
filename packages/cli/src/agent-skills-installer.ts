import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AgentSkillManifest } from "@prs/contracts";

type InstalledSkillRecord = {
  sourceHash: string;
  installedHash: string;
};

type ManagedSkillsState = {
  version: 1;
  hosts: InstallableAgentHost[];
  skills: Record<string, InstalledSkillRecord>;
};

export type InstallableAgentHost = "codex" | "claude-code" | "copilot";

export type InstallAgentSkillsOptions = {
  host: InstallableAgentHost;
  home?: string;
  sourceRoot?: string;
  env?: { CODEX_HOME?: string };
};

export type InstallAgentSkillsResult = {
  host: InstallableAgentHost;
  targetRoot: string;
  installed: string[];
  updated: string[];
  unchanged: string[];
  skipped: { name: string; filePath: string; reason: "custom-file" }[];
  retiredLegacy: string[];
  legacySkipped: string[];
};

const STATE_FILE = ".prs-managed-skills.json";
const LEGACY_MARKER = /<!-- prs:managed-skill name="prs(?:-[a-z0-9-]+)?" version="[^"]+" hash="[a-f0-9]+" -->/;

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readState(filePath: string): ManagedSkillsState | undefined {
  if (!existsSync(filePath)) return undefined;
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<ManagedSkillsState> & {
    host?: InstallableAgentHost;
  };
  const hosts = parsed.hosts ?? (parsed.host ? [parsed.host] : undefined);
  if (parsed.version !== 1 || !hosts || !parsed.skills) {
    throw new Error(`Refusing to replace invalid managed skills state at ${filePath}.`);
  }
  return { version: 1, hosts, skills: parsed.skills };
}

function writeState(filePath: string, state: ManagedSkillsState): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, filePath);
}

function retireLegacySkills(
  legacyRoot: string,
  canonicalNames: Set<string>
): Pick<InstallAgentSkillsResult, "retiredLegacy" | "legacySkipped"> {
  const retiredLegacy: string[] = [];
  const legacySkipped: string[] = [];
  if (!existsSync(legacyRoot)) return { retiredLegacy, legacySkipped };

  for (const entry of readdirSync(legacyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("prs")) continue;
    const skillFile = join(legacyRoot, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const content = readFileSync(skillFile, "utf8");
    if (!LEGACY_MARKER.test(content)) {
      if (canonicalNames.has(entry.name)) legacySkipped.push(skillFile);
      continue;
    }

    const retiredPath = `${skillFile}.prs-retired`;
    if (existsSync(retiredPath)) {
      legacySkipped.push(skillFile);
      continue;
    }
    renameSync(skillFile, retiredPath);
    retiredLegacy.push(retiredPath);
  }

  return { retiredLegacy, legacySkipped };
}

export function installAgentSkills(options: InstallAgentSkillsOptions): InstallAgentSkillsResult {
  const home = options.home ?? homedir();
  const sourceRoot = options.sourceRoot ?? resolve(__dirname, "../../..");
  const manifest = AgentSkillManifest.parse(
    JSON.parse(readFileSync(join(sourceRoot, "skills", "manifest.json"), "utf8"))
  );
  const targetRoot =
    options.host === "claude-code"
      ? join(home, ".claude", "skills")
      : join(home, ".agents", "skills");
  const stateFile = join(targetRoot, STATE_FILE);
  const previousState = readState(stateFile);
  const nextState: ManagedSkillsState = {
    version: 1,
    hosts: Array.from(new Set([...(previousState?.hosts ?? []), options.host])),
    skills: {},
  };
  const result: InstallAgentSkillsResult = {
    host: options.host,
    targetRoot,
    installed: [],
    updated: [],
    unchanged: [],
    skipped: [],
    retiredLegacy: [],
    legacySkipped: [],
  };

  for (const skill of manifest.skills) {
    const sourceFile = join(sourceRoot, skill.source);
    const sourceContent = readFileSync(sourceFile, "utf8");
    const sourceHash = hash(sourceContent);
    const targetFile = join(targetRoot, skill.name, "SKILL.md");
    const previousRecord = previousState?.skills[skill.name];

    if (existsSync(targetFile)) {
      const installedContent = readFileSync(targetFile, "utf8");
      const installedHash = hash(installedContent);
      const owned = installedHash === sourceHash || installedHash === previousRecord?.installedHash;
      if (!owned) {
        result.skipped.push({ name: skill.name, filePath: targetFile, reason: "custom-file" });
        continue;
      }
      if (installedHash === sourceHash) {
        result.unchanged.push(targetFile);
      } else {
        writeFileSync(targetFile, sourceContent, "utf8");
        result.updated.push(targetFile);
      }
    } else {
      mkdirSync(dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, sourceContent, "utf8");
      result.installed.push(targetFile);
    }

    nextState.skills[skill.name] = { sourceHash, installedHash: sourceHash };
  }

  writeState(stateFile, nextState);

  if (options.host === "codex") {
    const codexHome = options.env?.CODEX_HOME?.trim() || join(home, ".codex");
    const legacy = retireLegacySkills(
      join(codexHome, "skills"),
      new Set(manifest.skills.map((skill) => skill.name))
    );
    result.retiredLegacy = legacy.retiredLegacy;
    result.legacySkipped = legacy.legacySkipped;
  }
  return result;
}
