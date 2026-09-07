import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_WORKFLOW_CONTRACT, AgentSkillManifest, type AgentHostType } from "@prs/contracts";
import { installAgentSkills } from "./agent-skills-installer";
import { validateIssueApprovalInstructions } from "./agent-skill-approval-contract";

const HOSTS: AgentHostType[] = ["codex", "claude-code", "copilot"];
const REQUIRED_OPERATIONS = [
  "prs tool issue create",
  "prs tool issue context",
  "prs tool issue publish-artifacts",
  "prs tool issue ready",
  "prs issue finalize",
  "prs tool pr list",
  "prs tool pr ready",
  "prs audit publish",
  "prs tool token-usage render",
  "prs tool token-usage capture",
];
const RAW_WORKFLOW_ARTIFACTS = /\braw workflow artifacts\b/i;
const ARTIFACT_PROHIBITION = /\b(?:must not|never)\s+(?:stage|commit)(?:\s+(?:or|and)\s+(?:stage|commit))?\s+(?:raw workflow artifacts|them)\b/i;
const UNSAFE_ARTIFACT_DIRECTIVE = /\b(?:always|must|should)\s+(?:stage|commit)(?:\s+(?:or|and)\s+(?:stage|commit))?\s+raw workflow artifacts\b/i;
const FINALIZATION_PRESERVATION =
  /(?:\bpreserve(?:s|d)?\s+(?:both\s+)?unstaged(?:\s+changes?)?\s+and\s+untracked(?:\s+files?)?\b|\bunstaged(?:\s+changes?)?\s+and\s+untracked(?:\s+files?)?\s+(?:untouched|unchanged|preserved)\b)/i;
const DESTRUCTIVE_FINALIZATION_DIRECTIVE =
  /\b(?:delete|deletes|deleted|deleting|remove|removes|removed|removing|clean|cleans|cleaned|cleaning)\s+(?:both\s+)?unstaged(?:\s+changes?)?\s+and\s+untracked(?:\s+files?)?\b/i;

function semanticStatements(text: string): string[] {
  return text
    .split(/\r?\n|[.?!;](?=\s|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const ARTIFACT_LOCALITY_SAFEGUARD = {
  id: "artifact-locality",
  matches: (text: string): boolean => {
    const statements = semanticStatements(text);
    return (
      text.includes(AGENT_WORKFLOW_CONTRACT.safety.artifactLocality.root) &&
      !statements.some((statement) => UNSAFE_ARTIFACT_DIRECTIVE.test(statement)) &&
      statements.some(
        (statement, index) =>
          ARTIFACT_PROHIBITION.test(statement) &&
          (RAW_WORKFLOW_ARTIFACTS.test(statement) ||
            (/\bthem\b/i.test(statement) && RAW_WORKFLOW_ARTIFACTS.test(statements[index - 1] ?? "")))
      )
    );
  },
} as const;
const STAGED_ONLY_FINALIZATION_SAFEGUARD = {
  id: "staged-only-finalization",
  matches: (text: string): boolean => {
    const existingIndex = AGENT_WORKFLOW_CONTRACT.safety.finalization.commitSource.replace(
      "-",
      "[\\s-]+"
    );
    const finalizationSource = new RegExp(
      `\\b(?:staged(?:[\\s-]+changes?)?|${existingIndex})\\b`,
      "i"
    );
    const statements = semanticStatements(text);
    return (
      !statements.some((statement) => DESTRUCTIVE_FINALIZATION_DIRECTIVE.test(statement)) &&
      statements.some(
        (statement) =>
          finalizationSource.test(statement) && FINALIZATION_PRESERVATION.test(statement)
      )
    );
  },
} as const;
const REQUIRED_SAFEGUARDS = [
  ARTIFACT_LOCALITY_SAFEGUARD,
  STAGED_ONLY_FINALIZATION_SAFEGUARD,
] as const;

type HostParityResult = {
  host: AgentHostType;
  home: string;
  targetRoot: string;
  status: "passed" | "failed";
  inventory: string[];
  contentHashes: Record<string, string>;
  requiredOperations: string[];
  safeguards: string[];
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
    requiredSafeguards: string[];
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
    const installedContent = new Map<string, string>();

    for (const name of canonicalInventory) {
      const filePath = join(install.targetRoot, name, "SKILL.md");
      if (!existsSync(filePath)) {
        errors.push(`${name}: missing installed SKILL.md`);
        continue;
      }
      const content = readFileSync(filePath, "utf8");
      combined.push(content);
      installedContent.set(name, content);
      contentHashes[name] = hash(content);
      if (contentHashes[name] !== canonicalHashes[name]) {
        errors.push(`${name}: installed content differs from canonical source`);
      }
    }

    if (JSON.stringify(inventory) !== JSON.stringify(canonicalInventory)) {
      errors.push("installed inventory differs from the canonical manifest");
    }
    // Identical installations can all omit the same workflow. Check its entrypoint
    // and action sections independently of the manifest and combined tool references.
    for (const name of ["prs-create", "prs-issue"] as const) {
      errors.push(...validateIssueApprovalInstructions(name, installedContent.get(name)));
    }
    const prWorkflow = installedContent.get("prs-pr");
    if (!prWorkflow) {
      errors.push("missing workflow skill: prs-pr");
    } else {
      for (const action of ["review", "resolve-conflicts", "address-comments", "fix-tests"]) {
        const section = prWorkflow.split(`### ${action}\n`)[1]?.split(/^#{1,3} /m)[0]?.trim();
        if (!section) errors.push(`prs-pr: missing action instructions: ${action}`);
      }
    }
    if (!/Existing pull request:[^\n]*`prs-pr`/.test(installedContent.get("prs") ?? "")) {
      errors.push("prs: missing prs-pr route");
    }
    const combinedText = combined.join("\n");
    const requiredOperations = REQUIRED_OPERATIONS.filter((operation) =>
      combinedText.includes(operation)
    );
    for (const operation of REQUIRED_OPERATIONS) {
      if (!requiredOperations.includes(operation)) errors.push(`missing operation reference: ${operation}`);
    }
    const safeguards = REQUIRED_SAFEGUARDS.filter((safeguard) =>
      safeguard.matches(combinedText)
    ).map((safeguard) => safeguard.id);
    for (const safeguard of REQUIRED_SAFEGUARDS) {
      if (!safeguards.includes(safeguard.id)) errors.push(`missing safeguard: ${safeguard.id}`);
    }

    return {
      host,
      home,
      targetRoot: install.targetRoot,
      status: errors.length === 0 ? "passed" : "failed",
      inventory,
      contentHashes,
      requiredOperations,
      safeguards,
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
      requiredSafeguards: REQUIRED_SAFEGUARDS.map((safeguard) => safeguard.id),
    },
    hosts,
  };
}
