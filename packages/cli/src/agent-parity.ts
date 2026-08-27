import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentSkillManifest, type AgentHostType } from "@prs/contracts";
import { installAgentSkills } from "./agent-skills-installer";

const HOSTS: AgentHostType[] = ["codex", "claude-code", "copilot"];
const REQUIRED_OPERATIONS = [
  "prs tool issue create",
  "prs tool issue context",
  "prs tool issue publish-artifacts",
  "prs tool issue ready",
  "prs issue finalize",
  "prs tool pr ready",
  "prs audit publish",
];

type HostParityResult = {
  host: AgentHostType;
  home: string;
  targetRoot: string;
  status: "passed" | "failed";
  inventory: string[];
  contentHashes: Record<string, string>;
  requiredOperations: string[];
  errors: string[];
};

export type AgentSkillParityReport = {
  version: 1;
  status: "passed" | "failed";
  temporaryRoot: string;
  canonical: {
    inventory: string[];
    contentHashes: Record<string, string>;
    requiredOperations: string[];
  };
  hosts: HostParityResult[];
};

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function inventoryAt(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

export function validateAgentSkillParity(options: {
  sourceRoot?: string;
  temporaryRoot?: string;
} = {}): AgentSkillParityReport {
  const sourceRoot = options.sourceRoot ?? resolve(__dirname, "../../..");
  const temporaryRoot =
    options.temporaryRoot ?? mkdtempSync(join(tmpdir(), "prs-agent-parity-"));
  const manifest = AgentSkillManifest.parse(
    JSON.parse(readFileSync(join(sourceRoot, "skills", "manifest.json"), "utf8"))
  );
  const canonicalInventory = manifest.skills.map((skill) => skill.name).sort();
  const canonicalContent = new Map(
    manifest.skills.map((skill) => [skill.name, readFileSync(join(sourceRoot, skill.source), "utf8")])
  );
  const canonicalHashes = Object.fromEntries(
    canonicalInventory.map((name) => [name, hash(canonicalContent.get(name) ?? "")])
  );

  const hosts = HOSTS.map((host): HostParityResult => {
    const home = join(temporaryRoot, host);
    const install = installAgentSkills({ host, home, sourceRoot });
    const inventory = inventoryAt(install.targetRoot);
    const contentHashes: Record<string, string> = {};
    const errors: string[] = install.skipped.map(
      (skip) => `${skip.name}: ${skip.reason} at ${skip.filePath}`
    );
    const combined: string[] = [];

    for (const name of canonicalInventory) {
      const filePath = join(install.targetRoot, name, "SKILL.md");
      if (!existsSync(filePath)) {
        errors.push(`${name}: missing installed SKILL.md`);
        continue;
      }
      const content = readFileSync(filePath, "utf8");
      combined.push(content);
      contentHashes[name] = hash(content);
      if (contentHashes[name] !== canonicalHashes[name]) {
        errors.push(`${name}: installed content differs from canonical source`);
      }
    }

    if (JSON.stringify(inventory) !== JSON.stringify(canonicalInventory)) {
      errors.push("installed inventory differs from the canonical manifest");
    }
    const combinedText = combined.join("\n");
    const requiredOperations = REQUIRED_OPERATIONS.filter((operation) =>
      combinedText.includes(operation)
    );
    for (const operation of REQUIRED_OPERATIONS) {
      if (!requiredOperations.includes(operation)) errors.push(`missing operation reference: ${operation}`);
    }

    return {
      host,
      home,
      targetRoot: install.targetRoot,
      status: errors.length === 0 ? "passed" : "failed",
      inventory,
      contentHashes,
      requiredOperations,
      errors,
    };
  });

  return {
    version: 1,
    status: hosts.every((host) => host.status === "passed") ? "passed" : "failed",
    temporaryRoot,
    canonical: {
      inventory: canonicalInventory,
      contentHashes: canonicalHashes,
      requiredOperations: [...REQUIRED_OPERATIONS],
    },
    hosts,
  };
}
