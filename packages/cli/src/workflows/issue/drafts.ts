import {
IssueDraftSet
} from "@prs/contracts";
import {
existsSync,
mkdirSync,
readFileSync,
writeFileSync
} from "node:fs";
import { dirname,isAbsolute,resolve } from "node:path";
import {
loadMediaEvidenceForPublication,
} from "../../cli-git";
import {
getDefaultRepoRoot,
getRepositoryConfig,
getRepositoryForge,
} from "../../cli-context";
import {
type IssueDraftCommandOptions
} from "../../commands/issue";
import {
type CreatedIssueRecord,
type RepositoryForge
} from "../../forge";
import {
openFileInEditor,
printGeneratedTextPreview,
reviewGeneratedText
} from "../../generated-text-review";
import {
appendMediaEvidenceSection,
loadMediaEvidenceManifest,
writeMediaEvidenceFile
} from "../../media-evidence";
import {
formatRunTimestamp,
toRepoRelativePath
} from "../../run-artifacts";
import {
getInteractiveRuntimeByType,
isCodexSuperpowersAvailable,
selectInteractiveRuntime,
type InteractiveRuntimeType
} from "../../runtime";
import {
parseSetupCommandArgs
} from "../../setup";

export { parseAuditCommandArgs } from "../../commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "../../commands/backlog";
export { parseIssueCommandArgs } from "../../commands/issue";
export { parseReviewCommandArgs } from "../../commands/review";
export { parseSetupCommandArgs };

import { promptForLine,promptForRequiredLine } from "../../cli-prompts";



import {
  buildIssueSummaryBodyFromDraftBody,
  parseIssueDraftDocument,
} from "./draft-parser";
import {
  formatIssueDraftSetPreview,
  loadIssueDraftSet,
  type ParsedIssueDraftSet,
  type ParsedIssueDraftSetIssue,
} from "./draft-set";
import {
  publishSuperpowersPlanArtifact,
  publishSuperpowersSpecArtifact,
} from "./publication";
import { ensurePrsManagedIssueBody } from "./refinement";
import { parseCreatedIssueUrl } from "./session";

export {
  buildIssueSummaryBodyFromDraftBody,
  extractMarkdownSection,
  extractOpeningParagraphs,
  parseIssueDraftDocument,
} from "./draft-parser";
export {
  formatIssueDraftSetPreview,
  isPathWithinDirectory,
  loadIssueDraftSet,
  type ParsedIssueDraftSet,
  type ParsedIssueDraftSetIssue,
} from "./draft-set";
export { createIssueBranchName, slugifyIssueTitle } from "./naming";

export function createIssueDraftWorkspace(repoRoot: string): IssueDraftWorkspace {
  const timestamp = formatRunTimestamp();
  const issueDir = resolve(repoRoot, ".prs", "issues");
  const runDir = resolve(repoRoot, ".prs", "runs", `${timestamp}-issue-draft`);

  mkdirSync(issueDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  return {
    runDir,
    draftFilePath: resolve(issueDir, `issue-draft-${timestamp}.md`),
    issueSetFilePath: resolve(runDir, "issue-set.json"),
    mediaEvidenceFilePath: resolve(runDir, "media-evidence.json"),
    promptFilePath: resolve(runDir, "prompt.md"),
    metadataFilePath: resolve(runDir, "metadata.json"),
    outputLogPath: resolve(runDir, "output.log"),
    superpowersSpecFilePath: resolve(runDir, "superpowers-spec.md"),
    superpowersPlanFilePath: resolve(runDir, "superpowers-plan.md"),
  };
}

export function buildIssueDraftRuntimePrompt(
  repoRoot: string,
  workspace: IssueDraftWorkspace,
  featureIdea: string,
  options: {
    useCodexSuperpowers: boolean;
  }
): string {
  const draftFile = toRepoRelativePath(repoRoot, workspace.draftFilePath);
  const issueSetFile = toRepoRelativePath(repoRoot, workspace.issueSetFilePath);
  const runDir = toRepoRelativePath(repoRoot, workspace.runDir);
  const superpowersSpecFile = toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath);
  const superpowersPlanFile = toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath);

  if (options.useCodexSuperpowers) {
    return [
      "You are working in the current repository.",
      "",
      "The user wants to turn a rough idea into an implementation-ready GitHub issue draft.",
      "",
      "Rough idea:",
      featureIdea,
      "",
      `Write the final Markdown issue draft to \`${draftFile}\`.`,
      `If the work is better split into multiple independent implementation issues, write each issue draft as Markdown under \`${runDir}\` and write an issue-set manifest to \`${issueSetFile}\`.`,
      "The manifest lets prs create linked issues after review. Use local IDs in manifest relationships; prs will replace them with GitHub issue numbers after creation.",
      "If one issue is enough, write only the existing final Markdown draft path.",
      `Write the Superpowers spec artifact to \`${superpowersSpecFile}\`.`,
      `Write the Superpowers plan artifact to \`${superpowersPlanFile}\`.`,
      `Use \`${runDir}\` for run artifacts created by this workflow.`,
      "",
      "Instructions to the coding agent:",
      "- inspect the repository only as needed to understand the idea and scope the work",
      "- avoid asking questions that are already answerable from the codebase",
      "- ask the user targeted clarifying questions only when repository inspection does not answer an important implementation detail",
      "- ask every currently blocking high-value question needed to reach a settled specification; do not limit yourself to three questions",
      "- capture the user's why and intended outcome, then inspect nearby code for knock-on effects such as emails, reports, exports, admin screens, APIs, permissions, audit logs, migrations, and integrations",
      "- use `superpowers:brainstorming` first for clarification and scope shaping",
      "- use `superpowers:writing-plans` discipline to make the final issue draft implementation-ready",
      "- override the normal Superpowers spec/plan continuation for this workflow",
      "- keep any intermediate Superpowers docs inside the provided `.prs/runs/...` directory",
      "- write any Superpowers brainstorming/spec artifact only to the provided spec path",
      "- write any Superpowers writing-plans artifact only to the provided plan path",
      "- do not create `docs/superpowers/specs/...` documents",
      "- do not create `docs/superpowers/plans/...` documents",
      "- write the completed draft to the provided draft path before exiting",
      "- write a concise Markdown issue draft with a top-level title heading and summary/context body; the full settled specification and plan belong in the provided Superpowers artifact files",
      "- keep the draft grounded in actual repository structure, existing patterns, and likely touchpoints",
      "- do not create the GitHub issue directly",
      "- do not modify unrelated repository files",
      "- do not modify `.prs/` except for the provided draft file and local workflow artifacts",
      "",
      "When the draft is complete and saved, stop.",
    ].join("\n");
  }

  return [
    "You are working in the current repository.",
    "",
    "The user wants to turn a rough idea into an implementation-ready GitHub issue draft.",
    "",
    "Rough idea:",
    featureIdea,
    "",
    `Write the final Markdown issue draft to \`${draftFile}\`.`,
    `If the work is better split into multiple independent implementation issues, write each issue draft as Markdown under \`${runDir}\` and write an issue-set manifest to \`${issueSetFile}\`.`,
    "The manifest lets prs create linked issues after review. Use local IDs in manifest relationships; prs will replace them with GitHub issue numbers after creation.",
    "If one issue is enough, write only the existing final Markdown draft path.",
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to the coding agent:",
    "- inspect the repository only as needed to understand the idea and scope the work",
    "- ask the user targeted clarifying questions when repository inspection does not answer an important implementation detail",
    "- ask every currently blocking high-value question needed to reach a settled specification; do not limit yourself to three questions",
    "- capture the user's why and intended outcome, then inspect nearby code for knock-on effects such as emails, reports, exports, admin screens, APIs, permissions, audit logs, migrations, and integrations",
    "- avoid asking questions that are already answerable from the codebase",
    "- own the discovery, questioning, and drafting flow end to end",
    "- keep the draft grounded in actual repository structure, existing patterns, and likely touchpoints",
    "- write an implementation-ready Markdown issue draft with a top-level title heading and concrete sections such as summary, motivation, scope, requirements, and acceptance criteria when they add value",
    "- write the completed draft to the provided draft path before exiting",
    "- do not create the GitHub issue directly",
    "- do not modify unrelated repository files",
    "- do not modify `.prs/` except for the provided draft file and local workflow artifacts",
    "",
    "When the draft is complete and saved, stop.",
  ].join("\n");
}

export function writeIssueDraftWorkspaceFiles(
  repoRoot: string,
  featureIdea: string,
  workspace: IssueDraftWorkspace,
  runtimeType: InteractiveRuntimeType,
  options: {
    useCodexSuperpowers: boolean;
  }
): void {
  const createdAt = new Date().toISOString();
  const runtime = getInteractiveRuntimeByType(runtimeType);
  const prompt = buildIssueDraftRuntimePrompt(repoRoot, workspace, featureIdea, options);
  const superpowersMetadata = options.useCodexSuperpowers
    ? {
        enabled: true,
        specFile: toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath),
        planFile: toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath),
      }
    : {
        enabled: false,
      };

  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        flow: "issue-draft",
        featureIdea,
        draftFile: toRepoRelativePath(repoRoot, workspace.draftFilePath),
        issueSetFile: toRepoRelativePath(repoRoot, workspace.issueSetFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        runtime: {
          type: runtime.type,
          displayName: runtime.displayName,
          command: runtime.metadata.command,
        },
        superpowers: superpowersMetadata,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.outputLogPath,
    [
      "# prs issue draft run log",
      "",
      `Created: ${createdAt}`,
      `Runtime: ${runtime.displayName}`,
      `Draft file: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
      `Issue set file: ${toRepoRelativePath(repoRoot, workspace.issueSetFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      ...(options.useCodexSuperpowers
        ? [
            `Superpowers spec file: ${toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath)}`,
            `Superpowers plan file: ${toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath)}`,
          ]
        : []),
      "",
    ].join("\n"),
    "utf8"
  );
}

export function resolveCallerInputPath(repoRoot: string, inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(repoRoot, inputPath);
}

export function readCallerInputFile(repoRoot: string, inputPath: string, label: string): string {
  const resolvedPath = resolveCallerInputPath(repoRoot, inputPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`${label} does not exist: ${inputPath}`);
  }

  return readFileSync(resolvedPath, "utf8");
}

export function buildCallerIssueDraftPrompt(input: {
  roughIdea: string;
  contextEntries: { source: string; content: string }[];
  mediaEvidenceMarkdown?: string;
  draftContents?: string;
  issueSetFilePath?: string;
  superpowersArtifacts: { label: string; source: string; content: string }[];
}): string {
  return [
    "The active prs:create skill produced this issue draft in the current Codex context.",
    "",
    "Rough idea:",
    input.roughIdea || "(not provided)",
    "",
    "Caller-provided context:",
    ...(input.contextEntries.length > 0
      ? input.contextEntries.flatMap((entry, index) => [
          "",
          `Context ${index + 1} (${entry.source}):`,
          entry.content.trimEnd(),
        ])
      : ["(not provided)"]),
    "",
    ...(input.mediaEvidenceMarkdown
      ? ["Caller-provided visual evidence:", input.mediaEvidenceMarkdown.trimEnd(), ""]
      : []),
    ...(input.draftContents !== undefined
      ? ["Caller-produced issue draft:", input.draftContents.trimEnd()]
      : [
          "Caller-produced issue set:",
          input.issueSetFilePath ?? "(not provided)",
        ]),
    ...(input.superpowersArtifacts.length > 0
      ? input.superpowersArtifacts.flatMap((artifact) => [
          "",
          `${artifact.label} (${artifact.source}):`,
          artifact.content.trimEnd(),
        ])
      : []),
  ].join("\n");
}

export function safeIssueSetDraftFileName(issueId: string, index: number): string {
  const slug =
    issueId
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `issue-${index + 1}`;

  return `${String(index + 1).padStart(2, "0")}-${slug}.md`;
}

export function ingestCallerIssueSet(
  repoRoot: string,
  sourceIssueSetFilePath: string,
  workspace: IssueDraftWorkspace
): void {
  const sourcePath = resolveCallerInputPath(repoRoot, sourceIssueSetFilePath);
  const rawManifest = readCallerInputFile(repoRoot, sourceIssueSetFilePath, "Issue set file");
  const parsedManifest = IssueDraftSet.parse(JSON.parse(rawManifest));
  if (parsedManifest.mode !== "multiple") {
    throw new Error("Caller issue set must use mode \"multiple\".");
  }

  const sourceDir = dirname(sourcePath);
  const ingestedIssues = parsedManifest.issues.map((issue, index) => {
    const sourceDraftPath = isAbsolute(issue.draftFile)
      ? issue.draftFile
      : resolve(sourceDir, issue.draftFile);
    if (!existsSync(sourceDraftPath)) {
      throw new Error(`Issue set draft file for "${issue.id}" does not exist: ${sourceDraftPath}.`);
    }

    const draftContents = readFileSync(sourceDraftPath, "utf8");
    parseIssueDraftDocument(draftContents);
    const targetPath = resolve(workspace.runDir, safeIssueSetDraftFileName(issue.id, index));
    writeFileSync(targetPath, `${draftContents.trim()}\n`, "utf8");

    return {
      ...issue,
      draftFile: toRepoRelativePath(repoRoot, targetPath),
    };
  });

  writeFileSync(
    workspace.issueSetFilePath,
    `${JSON.stringify(
      {
        version: 1,
        mode: "multiple",
        sourceIssueNumber: parsedManifest.sourceIssueNumber,
        linkingStrategy: parsedManifest.linkingStrategy,
        issues: ingestedIssues,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export function writeCallerIssueDraftWorkspaceFiles(
  repoRoot: string,
  options: Extract<IssueDraftCommandOptions, { mode: "caller" }>,
  workspace: IssueDraftWorkspace
): void {
  const createdAt = new Date().toISOString();
  const draftContents = options.draftFilePath
    ? readCallerInputFile(repoRoot, options.draftFilePath, "Draft file").trim()
    : undefined;
  const mediaEvidence = loadMediaEvidenceForPublication(repoRoot, options.mediaManifestFilePath);
  const mediaEvidenceMarkdown = renderOptionalMediaEvidenceMarkdown(mediaEvidence);

  if (draftContents !== undefined) {
    const draftWithMedia = appendMediaEvidenceSection(draftContents, mediaEvidence);
    if (!draftWithMedia.trim()) {
      throw new Error(`Draft file is empty: ${options.draftFilePath}`);
    }
    parseIssueDraftDocument(draftWithMedia);
    writeFileSync(workspace.draftFilePath, `${draftWithMedia.trim()}\n`, "utf8");
  } else if (options.issueSetFilePath) {
    if (mediaEvidence.length > 0) {
      throw new Error("Media manifests are currently supported for single issue drafts only.");
    }
    ingestCallerIssueSet(repoRoot, options.issueSetFilePath, workspace);
  }

  const roughIdea =
    options.roughIdeaFilePath !== undefined
      ? readCallerInputFile(repoRoot, options.roughIdeaFilePath, "Rough idea file").trim()
      : options.roughIdea?.trim() ?? "";
  const contextEntries = [
    ...options.contextValues.map((content, index) => ({
      source: `--context ${index + 1}`,
      content,
    })),
    ...options.contextFilePaths.map((filePath) => ({
      source: filePath,
      content: readCallerInputFile(repoRoot, filePath, "Context file"),
    })),
  ];
  const superpowersSpec = options.superpowersSpecFilePath
    ? readCallerInputFile(repoRoot, options.superpowersSpecFilePath, "Superpowers spec file")
    : undefined;
  const superpowersPlan = options.superpowersPlanFilePath
    ? readCallerInputFile(repoRoot, options.superpowersPlanFilePath, "Superpowers plan file")
    : undefined;
  const superpowersArtifacts = [
    ...(superpowersSpec
      ? [
          {
            label: "Superpowers spec artifact",
            source: options.superpowersSpecFilePath as string,
            content: superpowersSpec,
          },
        ]
      : []),
    ...(superpowersPlan
      ? [
          {
            label: "Superpowers plan artifact",
            source: options.superpowersPlanFilePath as string,
            content: superpowersPlan,
          },
        ]
      : []),
  ];
  const prompt = buildCallerIssueDraftPrompt({
    roughIdea,
    contextEntries,
    mediaEvidenceMarkdown,
    draftContents: draftContents === undefined
      ? undefined
      : appendMediaEvidenceSection(draftContents, mediaEvidence),
    issueSetFilePath: options.issueSetFilePath,
    superpowersArtifacts,
  });

  if (mediaEvidence.length > 0) {
    writeMediaEvidenceFile(workspace.mediaEvidenceFilePath, mediaEvidence);
  }
  if (superpowersSpec !== undefined) {
    writeFileSync(workspace.superpowersSpecFilePath, `${superpowersSpec.trim()}\n`, "utf8");
  }
  if (superpowersPlan !== undefined) {
    writeFileSync(workspace.superpowersPlanFilePath, `${superpowersPlan.trim()}\n`, "utf8");
  }
  writeFileSync(workspace.promptFilePath, `${prompt}\n`, "utf8");
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(
      {
        createdAt,
        flow: "issue-draft",
        draftProducer: "caller",
        featureIdea: roughIdea,
        draftFile: toRepoRelativePath(repoRoot, workspace.draftFilePath),
        issueSetFile: toRepoRelativePath(repoRoot, workspace.issueSetFilePath),
        mediaEvidenceFile:
          mediaEvidence.length === 0
            ? undefined
            : toRepoRelativePath(repoRoot, workspace.mediaEvidenceFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        caller: {
          draftFile: options.draftFilePath,
          issueSetFile: options.issueSetFilePath,
          roughIdea,
          roughIdeaFile: options.roughIdeaFilePath,
          context: contextEntries,
          superpowersSpecFile: options.superpowersSpecFilePath,
          superpowersPlanFile: options.superpowersPlanFilePath,
          mediaManifestFile: options.mediaManifestFilePath,
        },
        superpowers: {
          enabled: superpowersArtifacts.length > 0,
          specFile:
            superpowersSpec === undefined
              ? undefined
              : toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath),
          planFile:
            superpowersPlan === undefined
              ? undefined
              : toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath),
        },
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(
    workspace.outputLogPath,
    [
      "# prs issue draft run log",
      "",
      "Draft producer: caller",
      `Created: ${createdAt}`,
      "Runtime: not launched",
      ...(options.draftFilePath ? [`Draft source: ${options.draftFilePath}`] : []),
      ...(options.issueSetFilePath ? [`Issue set source: ${options.issueSetFilePath}`] : []),
      `Draft file: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
      `Issue set file: ${toRepoRelativePath(repoRoot, workspace.issueSetFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      ...(superpowersSpec !== undefined
        ? [
            `Superpowers spec source: ${options.superpowersSpecFilePath}`,
            `Superpowers spec file: ${toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath)}`,
          ]
        : []),
      ...(superpowersPlan !== undefined
        ? [
            `Superpowers plan source: ${options.superpowersPlanFilePath}`,
            `Superpowers plan file: ${toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath)}`,
          ]
        : []),
      "",
      "The draft was produced by the active prs:create skill; no separate interactive AI runtime was opened.",
      "",
    ].join("\n"),
    "utf8"
  );
}

export function renderOptionalMediaEvidenceMarkdown(
  evidence: ReturnType<typeof loadMediaEvidenceManifest>
): string | undefined {
  const rendered = appendMediaEvidenceSection("", evidence).trim();
  return rendered || undefined;
}

export type IssueSetCreatedIssue = {
  id: string;
  number: number;
  url: string;
};

export type ToolCreatedIssueRecord = CreatedIssueRecord & {
  id?: string;
};

export function formatIssueNumberList(
  issueSet: ParsedIssueDraftSet,
  createdIssuesById: Map<string, IssueSetCreatedIssue>,
  ids: string[]
): string | undefined {
  const refs = issueSet.issues
    .filter((issue) => ids.includes(issue.id))
    .map((issue) => createdIssuesById.get(issue.id))
    .filter((issue): issue is IssueSetCreatedIssue => issue !== undefined)
    .map((issue) => `#${issue.number}`);

  return refs.length > 0 ? refs.join(", ") : undefined;
}

export function replaceLinkedIssuesSection(body: string, section: string): string {
  const trimmedBody = body.trim();
  const linkedIssuesHeading = /^## Linked Issues\s*$/m;
  const match = linkedIssuesHeading.exec(trimmedBody);
  if (!match || match.index === undefined) {
    return `${trimmedBody}\n\n${section}`;
  }

  const before = trimmedBody.slice(0, match.index).trimEnd();
  const afterStart = match.index + match[0].length;
  const nextHeadingMatch = /\n##\s+/.exec(trimmedBody.slice(afterStart));
  const after =
    nextHeadingMatch && nextHeadingMatch.index !== undefined
      ? trimmedBody.slice(afterStart + nextHeadingMatch.index).trimStart()
      : "";

  return [before, section, after].filter((part) => part.length > 0).join("\n\n");
}

export function buildLinkedIssueBody(
  issueSet: ParsedIssueDraftSet,
  issue: ParsedIssueDraftSetIssue,
  createdIssuesById: Map<string, IssueSetCreatedIssue>,
  options: {
    forcePrsManaged: boolean;
  }
): string {
  const lines = ["## Linked Issues", ""];

  if (issueSet.linkingStrategy) {
    lines.push(`- Part of: ${issueSet.linkingStrategy}`);
  }

  const dependsOn = formatIssueNumberList(issueSet, createdIssuesById, issue.dependsOn);
  if (dependsOn) {
    lines.push(`- Depends on: ${dependsOn}`);
  }

  const blocks = formatIssueNumberList(issueSet, createdIssuesById, issue.blocks);
  if (blocks) {
    lines.push(`- Blocks: ${blocks}`);
  }

  const related = formatIssueNumberList(issueSet, createdIssuesById, issue.related);
  if (related) {
    lines.push(`- Related: ${related}`);
  }

  if (issueSet.sourceIssueNumber !== undefined) {
    lines.push(`- Source issue: #${issueSet.sourceIssueNumber}`);
  }

  const linkedBody = replaceLinkedIssuesSection(issue.body, lines.join("\n"));
  return options.forcePrsManaged ? ensurePrsManagedIssueBody(linkedBody) : linkedBody;
}

export async function reviewIssueDraftSet(input: {
  repoRoot: string;
  issueSet: ParsedIssueDraftSet;
  prompt: string;
  promptForLine(prompt: string): Promise<string>;
  reload(): ParsedIssueDraftSet;
}): Promise<ParsedIssueDraftSet | null> {
  let currentSet = input.issueSet;

  while (true) {
    printGeneratedTextPreview(
      "Generated issue draft set",
      formatIssueDraftSetPreview(input.repoRoot, currentSet)
    );

    const action = (await input.promptForLine(input.prompt)).trim().toLowerCase();
    if (!action || action === "y" || action === "yes") {
      return currentSet;
    }

    if (action === "n" || action === "no") {
      return null;
    }

    if (
      action === "m" ||
      action === "modify" ||
      action === "e" ||
      action === "edit"
    ) {
      for (const issue of currentSet.issues) {
        openFileInEditor(issue.draftFilePath, `issue draft ${issue.id}`);
      }
      currentSet = input.reload();
      continue;
    }

    console.log("Choose yes, no, or modify.");
  }
}

export async function createLinkedIssueDraftSet(input: {
  issueSet: ParsedIssueDraftSet;
  forge: RepositoryForge;
  forcePrsManaged: boolean;
}): Promise<IssueSetCreatedIssue[]> {
  const createdIssues: IssueSetCreatedIssue[] = [];
  for (const issue of input.issueSet.issues) {
    const initialBody = input.forcePrsManaged
      ? ensurePrsManagedIssueBody(issue.body)
      : issue.body;
    const createdIssue = parseCreatedIssueUrl(
      await input.forge.createDraftIssue(issue.title, initialBody)
    );
    createdIssues.push({
      id: issue.id,
      number: createdIssue.issueNumber,
      url: createdIssue.issueUrl,
    });
  }

  const createdIssuesById = new Map(
    createdIssues.map((issue) => [issue.id, issue] as const)
  );
  for (const issue of input.issueSet.issues) {
    const createdIssue = createdIssuesById.get(issue.id);
    if (!createdIssue) {
      continue;
    }

    const linkedBody = buildLinkedIssueBody(
      input.issueSet,
      issue,
      createdIssuesById,
      {
        forcePrsManaged: input.forcePrsManaged,
      }
    );
    const updatedIssue = await input.forge.updateIssue(
      createdIssue.number,
      issue.title,
      linkedBody
    );
    createdIssue.url = updatedIssue.url;
  }

  return createdIssues;
}

export async function createIssueDraftSetWithRecords(input: {
  issueSet: ParsedIssueDraftSet;
  forge: RepositoryForge;
  labels: string[];
  forcePrsManaged: boolean;
}): Promise<ToolCreatedIssueRecord[]> {
  const createdIssues: ToolCreatedIssueRecord[] = [];

  for (const issue of input.issueSet.issues) {
    const initialBody = input.forcePrsManaged
      ? ensurePrsManagedIssueBody(issue.body)
      : issue.body;
    const createdIssue = await input.forge.createOrReuseIssue(
      issue.title,
      initialBody,
      input.labels
    );
    createdIssues.push({
      ...createdIssue,
      id: issue.id,
    });
  }

  const createdIssuesById = new Map<string, IssueSetCreatedIssue>();
  for (const issue of createdIssues) {
    if (!issue.id) {
      continue;
    }

    createdIssuesById.set(issue.id, {
      id: issue.id,
      number: issue.number,
      url: issue.url,
    });
  }

  for (const issue of input.issueSet.issues) {
    const createdIssue = createdIssues.find((entry) => entry.id === issue.id);
    if (!createdIssue || createdIssue.status !== "created") {
      continue;
    }

    const linkedBody = buildLinkedIssueBody(
      input.issueSet,
      issue,
      createdIssuesById,
      {
        forcePrsManaged: input.forcePrsManaged,
      }
    );
    const updatedIssue = await input.forge.updateIssue(
      createdIssue.number,
      issue.title,
      linkedBody
    );
    createdIssue.url = updatedIssue.url;
  }

  return createdIssues;
}

export async function runIssueDraftCommand(
  options: IssueDraftCommandOptions
): Promise<void> {
  if (options.mode === "runtime") {
    await runIssueDraftRuntimeCommand();
    return;
  }

  const repoRoot = getDefaultRepoRoot();
  const workspace = createIssueDraftWorkspace(repoRoot);
  const shouldPublishSuperpowersSpec = Boolean(options.superpowersSpecFilePath);
  const shouldPublishSuperpowersPlan = Boolean(options.superpowersPlanFilePath);

  writeCallerIssueDraftWorkspaceFiles(repoRoot, options, workspace);

  const issueSet = existsSync(workspace.issueSetFilePath)
    ? loadIssueDraftSet({
        repoRoot,
        runDir: workspace.runDir,
        issueSetFilePath: workspace.issueSetFilePath,
      })
    : undefined;

  const forge = getRepositoryForge(repoRoot);
  if (issueSet) {
    if (!forge.isAuthenticated()) {
      printGeneratedTextPreview(
        "Generated issue draft set",
        formatIssueDraftSetPreview(repoRoot, issueSet)
      );
      if (forge.type === "github") {
        console.log("Issue creation skipped because GitHub access is unavailable.");
      } else {
        console.log(
          "Issue creation skipped because repository forge support is disabled by .prs/config.json."
        );
      }
      return;
    }

    const reviewedIssueSet = await reviewIssueDraftSet({
      repoRoot,
      issueSet,
      prompt: "Create these linked issues in GitHub? [Y/n/m]: ",
      promptForLine,
      reload: () =>
        loadIssueDraftSet({
          repoRoot,
          runDir: workspace.runDir,
          issueSetFilePath: workspace.issueSetFilePath,
        }),
    });

    if (!reviewedIssueSet) {
      console.log(
        `Issue draft set kept at ${toRepoRelativePath(
          repoRoot,
          workspace.issueSetFilePath
        )}.`
      );
      return;
    }

    const createdIssues = await createLinkedIssueDraftSet({
      issueSet: reviewedIssueSet,
      forge,
      forcePrsManaged: false,
    });
    for (const issue of createdIssues) {
      console.log(`Created issue: ${issue.url}`);
    }
    if (shouldPublishSuperpowersSpec && createdIssues[0]) {
      await publishSuperpowersSpecArtifact({
        repoRoot,
        forge,
        issueNumber: createdIssues[0].number,
        specFilePath: workspace.superpowersSpecFilePath,
        outputLogPath: workspace.outputLogPath,
      });
    }
    if (shouldPublishSuperpowersPlan && createdIssues[0]) {
      await publishSuperpowersPlanArtifact({
        repoRoot,
        forge,
        issueNumber: createdIssues[0].number,
        planFilePath: workspace.superpowersPlanFilePath,
        outputLogPath: workspace.outputLogPath,
      });
    }
    return;
  }

  if (!existsSync(workspace.draftFilePath)) {
    throw new Error(
      `The prs:create skill did not write the issue draft to ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }

  const draftContents = readFileSync(workspace.draftFilePath, "utf8").trim();
  if (!draftContents) {
    throw new Error(
      `The prs:create skill wrote an empty issue draft at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }
  if (!forge.isAuthenticated()) {
    printGeneratedTextPreview("Generated issue draft", draftContents);
    if (forge.type === "github") {
      console.log("Issue creation skipped because GitHub access is unavailable.");
    } else {
      console.log(
        "Issue creation skipped because repository forge support is disabled by .prs/config.json."
      );
    }
    return;
  }

  const reviewedDraft = await reviewGeneratedText({
    filePath: workspace.draftFilePath,
    initialContent: draftContents,
    previewHeading: "Generated issue draft",
    prompt: "Create this issue in GitHub? [Y/n/m]: ",
    emptyContentMessage: "Issue draft cannot be empty.",
    editorDescription: "issue draft",
    promptForLine,
    validate: (content) => {
      parseIssueDraftDocument(content);
    },
  });

  if (!reviewedDraft) {
    console.log(
      `Draft kept at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
    return;
  }

  const parsedDraft = parseIssueDraftDocument(reviewedDraft.content);
  const issueBody = shouldPublishSuperpowersSpec
    ? buildIssueSummaryBodyFromDraftBody(parsedDraft.body)
    : parsedDraft.body;
  const issueUrl = await forge.createDraftIssue(parsedDraft.title, issueBody);
  console.log(`Created issue: ${issueUrl}`);
  if (shouldPublishSuperpowersSpec) {
    const createdIssue = parseCreatedIssueUrl(issueUrl);
    await publishSuperpowersSpecArtifact({
      repoRoot,
      forge,
      issueNumber: createdIssue.issueNumber,
      specFilePath: workspace.superpowersSpecFilePath,
      outputLogPath: workspace.outputLogPath,
    });
  }
  if (shouldPublishSuperpowersPlan) {
    const createdIssue = parseCreatedIssueUrl(issueUrl);
    await publishSuperpowersPlanArtifact({
      repoRoot,
      forge,
      issueNumber: createdIssue.issueNumber,
      planFilePath: workspace.superpowersPlanFilePath,
      outputLogPath: workspace.outputLogPath,
    });
  }
}

export async function runIssueDraftRuntimeCommand(): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const repositoryConfig = getRepositoryConfig(repoRoot);
  const runtime = selectInteractiveRuntime(repositoryConfig.ai.runtime, {
    onFallback: (message) => {
      console.log(message);
    },
  });
  const shouldUseCodexSuperpowers =
    runtime.type === "codex" &&
    repositoryConfig.ai.issue.useCodexSuperpowers &&
    isCodexSuperpowersAvailable();

  if (
    runtime.type === "codex" &&
    repositoryConfig.ai.issue.useCodexSuperpowers &&
    !shouldUseCodexSuperpowers
  ) {
    console.log(
      "Codex Superpowers-backed issue workflows are enabled in .prs/config.json, but Superpowers is not available in the current Codex installation. Falling back to the standard issue-draft prompt."
    );
  }

  const featureIdea = await promptForRequiredLine("Rough idea: ");
  const workspace = createIssueDraftWorkspace(repoRoot);
  writeIssueDraftWorkspaceFiles(repoRoot, featureIdea, workspace, runtime.type, {
    useCodexSuperpowers: shouldUseCodexSuperpowers,
  });

  console.log(
    `${runtime.displayName} will open a separate interactive AI session for issue drafting. Only the context saved in ${toRepoRelativePath(
      repoRoot,
      workspace.promptFilePath
    )} will be available to that session.`
  );
  runtime.launch(repoRoot, {
    promptFilePath: workspace.promptFilePath,
    outputLogPath: workspace.outputLogPath,
  });

  const issueSet = existsSync(workspace.issueSetFilePath)
    ? loadIssueDraftSet({
        repoRoot,
        runDir: workspace.runDir,
        issueSetFilePath: workspace.issueSetFilePath,
      })
    : undefined;

  const forge = getRepositoryForge(repoRoot);
  if (issueSet) {
    if (!forge.isAuthenticated()) {
      printGeneratedTextPreview(
        "Generated issue draft set",
        formatIssueDraftSetPreview(repoRoot, issueSet)
      );
      if (forge.type === "github") {
        console.log("Issue creation skipped because GitHub access is unavailable.");
      } else {
        console.log(
          "Issue creation skipped because repository forge support is disabled by .prs/config.json."
        );
      }
      return;
    }

    const reviewedIssueSet = await reviewIssueDraftSet({
      repoRoot,
      issueSet,
      prompt: "Create these linked issues in GitHub? [Y/n/m]: ",
      promptForLine,
      reload: () =>
        loadIssueDraftSet({
          repoRoot,
          runDir: workspace.runDir,
          issueSetFilePath: workspace.issueSetFilePath,
        }),
    });

    if (!reviewedIssueSet) {
      console.log(
        `Issue draft set kept at ${toRepoRelativePath(
          repoRoot,
          workspace.issueSetFilePath
        )}.`
      );
      return;
    }

    const createdIssues = await createLinkedIssueDraftSet({
      issueSet: reviewedIssueSet,
      forge,
      forcePrsManaged: false,
    });
    for (const issue of createdIssues) {
      console.log(`Created issue: ${issue.url}`);
    }
    if (shouldUseCodexSuperpowers && createdIssues[0]) {
      await publishSuperpowersSpecArtifact({
        repoRoot,
        forge,
        issueNumber: createdIssues[0].number,
        specFilePath: workspace.superpowersSpecFilePath,
        outputLogPath: workspace.outputLogPath,
      });
    }
    if (shouldUseCodexSuperpowers && createdIssues[0]) {
      await publishSuperpowersPlanArtifact({
        repoRoot,
        forge,
        issueNumber: createdIssues[0].number,
        planFilePath: workspace.superpowersPlanFilePath,
        outputLogPath: workspace.outputLogPath,
      });
    }
    return;
  }

  if (!existsSync(workspace.draftFilePath)) {
    throw new Error(
      [
        `${runtime.displayName} returned without writing the expected issue draft.`,
        `Expected draft path: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
        `Run directory: ${toRepoRelativePath(repoRoot, workspace.runDir)}`,
        `Prompt path: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
        `Output log path: ${toRepoRelativePath(repoRoot, workspace.outputLogPath)}`,
        "Recovery: rerun the prs:create skill flow in the current Codex session, then pass the completed draft with `prs issue draft --draft-file <path>`.",
      ].join("\n")
    );
  }

  const draftContents = readFileSync(workspace.draftFilePath, "utf8").trim();
  if (!draftContents) {
    throw new Error(
      `${runtime.displayName} wrote an empty issue draft at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }
  if (!forge.isAuthenticated()) {
    printGeneratedTextPreview("Generated issue draft", draftContents);
    if (forge.type === "github") {
      console.log("Issue creation skipped because GitHub access is unavailable.");
    } else {
      console.log(
        "Issue creation skipped because repository forge support is disabled by .prs/config.json."
      );
    }
    return;
  }

  const reviewedDraft = await reviewGeneratedText({
    filePath: workspace.draftFilePath,
    initialContent: draftContents,
    previewHeading: "Generated issue draft",
    prompt: "Create this issue in GitHub? [Y/n/m]: ",
    emptyContentMessage: "Issue draft cannot be empty.",
    editorDescription: "issue draft",
    promptForLine,
    validate: (content) => {
      parseIssueDraftDocument(content);
    },
  });

  if (!reviewedDraft) {
    console.log(
      `Draft kept at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
    return;
  }

  const parsedDraft = parseIssueDraftDocument(reviewedDraft.content);
  const issueBody = shouldUseCodexSuperpowers
    ? buildIssueSummaryBodyFromDraftBody(parsedDraft.body)
    : parsedDraft.body;
  const issueUrl = await forge.createDraftIssue(parsedDraft.title, issueBody);
  console.log(`Created issue: ${issueUrl}`);
  if (shouldUseCodexSuperpowers) {
    const createdIssue = parseCreatedIssueUrl(issueUrl);
    await publishSuperpowersSpecArtifact({
      repoRoot,
      forge,
      issueNumber: createdIssue.issueNumber,
      specFilePath: workspace.superpowersSpecFilePath,
      outputLogPath: workspace.outputLogPath,
    });
  }
  if (shouldUseCodexSuperpowers) {
    const createdIssue = parseCreatedIssueUrl(issueUrl);
    await publishSuperpowersPlanArtifact({
      repoRoot,
      forge,
      issueNumber: createdIssue.issueNumber,
      planFilePath: workspace.superpowersPlanFilePath,
      outputLogPath: workspace.outputLogPath,
    });
  }
}
