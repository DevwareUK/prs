import {
appendFileSync,
existsSync,
readFileSync,
writeFileSync
} from "node:fs";
import { resolve } from "node:path";
import {
getDefaultRepoRoot,
getRepositoryConfig,
getRepositoryForge,
} from "../../cli-context";
import {
type IssueDetails,
type RepositoryComment
} from "../../forge";
import {
printGeneratedTextPreview,
reviewGeneratedText,
type ReviewedGeneratedText
} from "../../generated-text-review";
import {
createIssueRefineWorkspace,
getIssueTokenUsageArtifactFilePath,
loadIssueRefineSessionState,
toRepoRelativePath,
writeIssueRefineSessionState,
type IssueRefineSessionState,
type IssueRefineWorkspace
} from "../../run-artifacts";
import {
findTrackedRuntimeSessionById,
getInteractiveRuntimeByType,
isCodexSuperpowersAvailable,
selectInteractiveRuntime,
type InteractiveRuntimeType
} from "../../runtime";
import {
parseSetupCommandArgs
} from "../../setup";
import {
preflightIssueBaseBranch
} from "../../workflow-preflights";

export { parseAuditCommandArgs } from "../../commands/audit";
export {
parseFeatureBacklogCommandArgs,
parseTestBacklogCommandArgs
} from "../../commands/backlog";
export { parseIssueCommandArgs } from "../../commands/issue";
export { parseReviewCommandArgs } from "../../commands/review";
export { parseSetupCommandArgs };

import { promptForLine,promptForRequiredLine,promptForYesNoDefaultNo } from "../../cli-prompts";



import { publishIssueRefinementArtifacts } from "./publication";

export function isPrsManagedIssue(issue: IssueDetails): boolean {
  return issue.body.trimStart().startsWith(PRS_MANAGED_ISSUE_MARKER);
}

export function formatIssueRefineComments(comments: RepositoryComment[]): string {
  if (comments.length === 0) {
    return "- (No issue comments.)";
  }

  return comments
    .map((comment) => {
      const author = comment.author.trim() || "unknown";
      const body = comment.body.trim() || "(No comment body provided.)";
      return `- @${author}: ${body}`;
    })
    .join("\n");
}

export function buildIssueRefineRuntimePrompt(input: {
  repoRoot: string;
  workspace: IssueRefineWorkspace;
  issue: IssueDetails;
  issueNumber: number;
  requestedChanges?: string;
  comments: RepositoryComment[];
  useCodexSuperpowers: boolean;
}): string {
  const draftFile = toRepoRelativePath(input.repoRoot, input.workspace.draftFilePath);
  const questionsFile = toRepoRelativePath(
    input.repoRoot,
    input.workspace.questionsFilePath
  );
  const runDir = toRepoRelativePath(input.repoRoot, input.workspace.runDir);
  const superpowersSpecFile = toRepoRelativePath(
    input.repoRoot,
    input.workspace.superpowersSpecFilePath
  );
  const superpowersPlanFile = toRepoRelativePath(
    input.repoRoot,
    input.workspace.superpowersPlanFilePath
  );
  const requestedChangesSection = input.requestedChanges
    ? [
        "What changes should be made to the original requirements?",
        input.requestedChanges,
        "",
      ]
    : [];

  const superpowersArtifactInstructions = input.useCodexSuperpowers
    ? [
        `Write the Superpowers spec artifact to \`${superpowersSpecFile}\`.`,
        `Write the Superpowers plan artifact to \`${superpowersPlanFile}\`.`,
      ]
    : [];
  const superpowersAgentInstructions = input.useCodexSuperpowers
    ? [
        "- use `superpowers:brainstorming` first for clarification and scope shaping; treat GitHub issue comments as the asynchronous user conversation",
        "- only use `superpowers:writing-plans` once brainstorming is satisfied that no blocking questions remain",
        "- override the normal Superpowers spec/plan continuation for this workflow",
        "- keep any intermediate Superpowers docs inside the provided `.prs/runs/...` directory",
        "- write any Superpowers brainstorming/spec artifact only to the provided spec path",
        "- write any Superpowers writing-plans artifact only to the provided plan path",
        "- do not create `docs/superpowers/specs/...` documents",
        "- do not create `docs/superpowers/plans/...` documents",
      ]
    : [];

  return [
    "You are working in the current repository.",
    "",
    `Refine GitHub issue #${input.issueNumber} through a non-technical GitHub issue refinement process.`,
    "",
    "The issue body is summary context. The settled specification and implementation plan belong in managed issue comments, not in the issue body.",
    "Issue comments are the refinement conversation. Treat user answers in comments as authoritative refinement context.",
    "",
    ...requestedChangesSection,
    "Current issue title:",
    input.issue.title,
    "",
    "Current issue body:",
    input.issue.body.trim() || "(No issue body provided.)",
    "",
    "Relevant issue comments:",
    formatIssueRefineComments(input.comments),
    "",
    `If brainstorming has any unresolved blocking questions, write only the GitHub issue comment body to \`${questionsFile}\` and stop. Do not write the refined draft, specification artifact, or implementation plan artifact in that case.`,
    `Only write the refined markdown to \`${draftFile}\` once brainstorming is happy the important questions and knock-on effects have been answered.`,
    "Keep this refinement attached to the original GitHub issue. Do not write an issue-set manifest, do not create linked issue drafts, and do not propose linked issue creation in this workflow.",
    "If the work seems too large or naturally split, ask scope and splitting questions in the issue-comment conversation instead of splitting it yourself.",
    ...superpowersArtifactInstructions,
    `Use \`${runDir}\` for run artifacts created by this workflow.`,
    "",
    "Instructions to the coding agent:",
    "- inspect the repository to discover nearby code, workflows, and knock-on effects that matter to the user's intention",
    "- run the equivalent of Superpowers brainstorming before producing any specification or plan",
    "- capture the why and intended outcome before deciding scope",
    "- when information is missing, write all currently blocking high-value questions to the questions file in GitHub issue-comment style; do not limit yourself to three questions",
    "- cover access, data changes, existing users/data, acceptance criteria, and likely adjacent behavior such as emails, reports, exports, admin screens, APIs, permissions, audit logs, migrations, and integrations when relevant",
    "- do not write a partial specification or plan while important questions remain open",
    "- once the issue is settled, write the full specification artifact and implementation plan artifact",
    "- keep the refined draft grounded in the current repository structure and existing patterns",
    ...superpowersAgentInstructions,
    "- write an implementation-ready Markdown issue draft with a top-level title heading and concise summary body only when the issue is settled",
    "- write the completed draft to the provided draft path before exiting only when the issue is settled",
    "- do not create or update GitHub issues directly",
    "- do not modify unrelated repository files",
    "- do not modify `.prs/` except for the provided draft file and local workflow artifacts",
    "",
    "When the refined specification is complete and saved, stop.",
  ].join("\n");
}

export function appendIssueRefineLog(outputLogPath: string, message: string): void {
  appendFileSync(outputLogPath, `${message}\n`, "utf8");
}

export function updateIssueRefineWorkspaceMetadata(
  workspace: IssueRefineWorkspace,
  updater: (currentMetadata: Record<string, unknown>) => Record<string, unknown>
): void {
  const currentMetadata = JSON.parse(
    readFileSync(workspace.metadataFilePath, "utf8")
  ) as Record<string, unknown>;
  writeFileSync(
    workspace.metadataFilePath,
    `${JSON.stringify(updater(currentMetadata), null, 2)}\n`,
    "utf8"
  );
}

export function buildIssueRefineTokenUsageMetadata(
  repoRoot: string,
  workspace: IssueRefineWorkspace,
  issueNumber: number
): Record<string, unknown> {
  return {
    artifactFile: toRepoRelativePath(
      repoRoot,
      getIssueTokenUsageArtifactFilePath(workspace.runDir)
    ),
    mode: "issue-token-usage-ledger",
    workflow: {
      name: "issue-refine",
      role: "planner",
      sourceIssueNumber: issueNumber,
      runDir: toRepoRelativePath(repoRoot, workspace.runDir),
    },
    auditPublication: {
      target: "issue",
      issueNumber,
      section: "token-usage",
      publishWhen: [
        "questions-posted",
        "published-artifacts",
        "refinement-complete",
      ],
    },
  };
}

export function writeIssueRefineWorkspaceFiles(
  repoRoot: string,
  workspace: IssueRefineWorkspace,
  runtimeType: InteractiveRuntimeType,
  issueNumber: number,
  issue: IssueDetails,
  comments: RepositoryComment[],
  requestedChanges: string | undefined,
  runtimeInvocation: "new" | "resume",
  useCodexSuperpowers: boolean,
  sessionId?: string,
  warnings: string[] = []
): void {
  const createdAt = new Date().toISOString();
  const runtime = getInteractiveRuntimeByType(runtimeType);
  const prompt = buildIssueRefineRuntimePrompt({
    repoRoot,
    workspace,
    issue,
    issueNumber,
    requestedChanges,
    comments,
    useCodexSuperpowers,
  });
  const superpowersMetadata = useCodexSuperpowers
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
        flow: "issue-refine",
        issueNumber,
        issueTitle: issue.title,
        issueUrl: issue.url,
        sourceIssueManaged: isPrsManagedIssue(issue),
        ...(requestedChanges ? { requestedChanges } : {}),
        commentCount: comments.length,
        draftFile: toRepoRelativePath(repoRoot, workspace.draftFilePath),
        questionsFile: toRepoRelativePath(repoRoot, workspace.questionsFilePath),
        issueSetFile: toRepoRelativePath(repoRoot, workspace.issueSetFilePath),
        promptFile: toRepoRelativePath(repoRoot, workspace.promptFilePath),
        outputLog: toRepoRelativePath(repoRoot, workspace.outputLogPath),
        runDir: toRepoRelativePath(repoRoot, workspace.runDir),
        superpowers: superpowersMetadata,
        tokenUsage: buildIssueRefineTokenUsageMetadata(repoRoot, workspace, issueNumber),
        runtime: {
          type: runtime.type,
          displayName: runtime.displayName,
          command: runtime.metadata.command,
          invocation: runtimeInvocation,
          sessionId,
          sandboxMode: runtime.metadata.sandboxMode,
          approvalPolicy: runtime.metadata.approvalPolicy,
          warnings,
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
      "# prs issue refine run log",
      "",
      `Created: ${createdAt}`,
      `Issue number: ${issueNumber}`,
      `Issue URL: ${issue.url}`,
      `Draft file: ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}`,
      `Questions file: ${toRepoRelativePath(repoRoot, workspace.questionsFilePath)}`,
      `Issue set file: ${toRepoRelativePath(repoRoot, workspace.issueSetFilePath)}`,
      `Prompt file: ${toRepoRelativePath(repoRoot, workspace.promptFilePath)}`,
      ...(useCodexSuperpowers
        ? [
            `Superpowers spec file: ${toRepoRelativePath(repoRoot, workspace.superpowersSpecFilePath)}`,
            `Superpowers plan file: ${toRepoRelativePath(repoRoot, workspace.superpowersPlanFilePath)}`,
          ]
        : []),
      `Runtime: ${runtime.displayName}`,
      `Runtime invocation: ${runtimeInvocation}`,
      ...(sessionId ? [`Runtime session: ${sessionId}`] : []),
      ...warnings.map((warning) => `Warning: ${warning}`),
      "",
    ].join("\n"),
    "utf8"
  );
}

export type IssueRefineCompletion =
  | {
      mode: "updated-existing" | "published-artifacts";
      issueNumber: number;
      issueUrl: string;
    }
  | {
      mode: "created-linked";
      issueNumber: number;
      issueUrl: string;
    }
  | {
      mode: "created-linked";
      issues: Array<{ issueNumber: number; issueUrl: string }>;
    }
  | {
      mode: "kept-on-disk" | "questions-posted";
    };

export function createIssueRefineSessionState(
  repoRoot: string,
  issueNumber: number,
  runtimeType: InteractiveRuntimeType,
  workspace: IssueRefineWorkspace,
  sessionId?: string,
  completion?: IssueRefineCompletion
): IssueRefineSessionState {
  const previousState = loadIssueRefineSessionState(repoRoot, issueNumber);
  const createdAt =
    previousState && previousState.runDir === workspace.runDir
      ? previousState.createdAt
      : new Date().toISOString();
  let completionState: Partial<IssueRefineSessionState> = {};

  if (completion) {
    if (
      completion.mode === "kept-on-disk" ||
      completion.mode === "questions-posted"
    ) {
      completionState = {
        completionMode: completion.mode,
      };
    } else if ("issues" in completion) {
      completionState = {
        completionMode: completion.mode,
        completedIssues: completion.issues,
      };
    } else if ("issueNumber" in completion) {
      completionState = {
        completionMode: completion.mode,
        completedIssueNumber: completion.issueNumber,
        completedIssueUrl: completion.issueUrl,
      };
    }
  }

  return {
    issueNumber,
    runtimeType,
    runDir: workspace.runDir,
    promptFile: workspace.promptFilePath,
    outputLog: workspace.outputLogPath,
    latestDraftFile: workspace.draftFilePath,
    ...(sessionId ? { sessionId } : {}),
    ...completionState,
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

export function persistIssueRefineSessionState(
  repoRoot: string,
  issueNumber: number,
  runtimeType: InteractiveRuntimeType,
  workspace: IssueRefineWorkspace,
  sessionId?: string,
  completion?: IssueRefineCompletion
): void {
  writeIssueRefineSessionState(
    repoRoot,
    createIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtimeType,
      workspace,
      sessionId,
      completion
    )
  );
}

export function createIssueRefineWorkspaceFromState(
  state: Pick<
    IssueRefineSessionState,
    "runDir" | "promptFile" | "outputLog" | "latestDraftFile"
  >
): IssueRefineWorkspace {
  return {
    runDir: state.runDir,
    draftFilePath: state.latestDraftFile,
    questionsFilePath: resolve(state.runDir, "issue-refine-questions.md"),
    issueSetFilePath: resolve(state.runDir, "issue-set.json"),
    promptFilePath: state.promptFile,
    metadataFilePath: resolve(state.runDir, "metadata.json"),
    outputLogPath: state.outputLog,
    superpowersSpecFilePath: resolve(state.runDir, "superpowers-spec.md"),
    superpowersPlanFilePath: resolve(state.runDir, "superpowers-plan.md"),
  };
}

export function buildIssueRefineStaleSessionWarning(
  issueNumber: number,
  runtimeType: InteractiveRuntimeType,
  sessionId: string
): string {
  return `Saved ${
    getInteractiveRuntimeByType(runtimeType).displayName
  } refine session ${sessionId} for issue #${issueNumber} is no longer available. Starting a fresh refinement session.`;
}

export function buildIssueRefineRuntimeMismatchWarning(
  savedRuntimeType: InteractiveRuntimeType,
  currentRuntimeType: InteractiveRuntimeType
): string {
  return `The saved issue-refine session used ${
    getInteractiveRuntimeByType(savedRuntimeType).displayName
  }, but the configured runtime is ${
    getInteractiveRuntimeByType(currentRuntimeType).displayName
  }. Starting a fresh refinement session.`;
}

export function buildIssueRefineMissingWorkspaceWarning(issueNumber: number): string {
  return `Saved issue-refine workspace artifacts for issue #${issueNumber} are missing. Starting a fresh refinement session.`;
}

export function ensurePrsManagedIssueBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith(PRS_MANAGED_ISSUE_MARKER)) {
    return trimmed;
  }

  return `${PRS_MANAGED_ISSUE_MARKER}\n\n${trimmed}`;
}

export async function runIssueRefineCommand(issueNumber: number): Promise<void> {
  const repoRoot = getDefaultRepoRoot();
  const forge = getRepositoryForge(repoRoot);
  const repositoryConfig = getRepositoryConfig(repoRoot);
  preflightIssueBaseBranch(repoRoot, repositoryConfig.baseBranch);
  ensureGuidedCheckoutReadyForRuntime(repoRoot, repositoryConfig.baseBranch);
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
      "Codex Superpowers-backed issue workflows are enabled in .prs/config.json, but Superpowers is not available in the current Codex installation. Falling back to the standard issue-refine prompt."
    );
  }

  console.log(`Fetching issue #${issueNumber}...`);
  const issue = await forge.fetchIssueDetails(issueNumber);
  const comments = await forge.fetchIssueComments(issueNumber);
  const existingSessionState = loadIssueRefineSessionState(repoRoot, issueNumber);
  const resumableSessionState =
    existingSessionState?.completionMode === undefined ? existingSessionState : undefined;
  const warnings: string[] = [];
  let runtimeInvocation: "new" | "resume" = "new";
  let sessionId: string | undefined;

  if (resumableSessionState) {
    if (resumableSessionState.runtimeType !== runtime.type) {
      warnings.push(
        buildIssueRefineRuntimeMismatchWarning(
          resumableSessionState.runtimeType,
          runtime.type
        )
      );
    } else if (
      resumableSessionState.sessionId &&
      getInteractiveRuntimeByType(runtime.type).metadata.supportsSessionTracking
    ) {
      const savedSession = findTrackedRuntimeSessionById(
        runtime.type,
        repoRoot,
        resumableSessionState.sessionId
      );

      if (savedSession) {
        if (existsSync(resumableSessionState.runDir)) {
          runtimeInvocation = "resume";
          sessionId = resumableSessionState.sessionId;
        } else {
          warnings.push(buildIssueRefineMissingWorkspaceWarning(issueNumber));
        }
      } else {
        warnings.push(
          buildIssueRefineStaleSessionWarning(
            issueNumber,
            runtime.type,
            resumableSessionState.sessionId
          )
        );
      }
    }
  }
  let requestedChanges: string | undefined;
  if (runtimeInvocation !== "resume") {
    const shouldSpecifyChanges = await promptForYesNoDefaultNo(
      "Specify changes to the original requirements? [y/N]: "
    );
    requestedChanges = shouldSpecifyChanges
      ? await promptForRequiredLine(
          "What changes should be made to the original requirements? "
        )
      : undefined;
  }

  const workspace =
    runtimeInvocation === "resume" && resumableSessionState
      ? createIssueRefineWorkspaceFromState(resumableSessionState)
      : createIssueRefineWorkspace(repoRoot, issueNumber);
  writeIssueRefineWorkspaceFiles(
    repoRoot,
    workspace,
    runtime.type,
    issueNumber,
    issue,
    comments,
    requestedChanges,
    runtimeInvocation,
    shouldUseCodexSuperpowers,
    sessionId,
    warnings
  );

  for (const warning of warnings) {
    console.log(warning);
    appendIssueRefineLog(workspace.outputLogPath, `Warning: ${warning}`);
  }

  const runtimeLaunch = runtime.launch(
    repoRoot,
    {
      promptFilePath: workspace.promptFilePath,
      outputLogPath: workspace.outputLogPath,
    },
    runtimeInvocation === "resume" ? { resumeSessionId: sessionId } : undefined
  );
  const resolvedSessionId = runtimeLaunch.sessionId;
  persistIssueRefineSessionState(
    repoRoot,
    issueNumber,
    runtime.type,
    workspace,
    resolvedSessionId
  );
  updateIssueRefineWorkspaceMetadata(workspace, (currentMetadata) => ({
    ...currentMetadata,
    runtime: {
      ...((currentMetadata.runtime as Record<string, unknown> | undefined) ?? {}),
      type: runtime.type,
      displayName: runtime.displayName,
      command: runtime.metadata.command,
      invocation: runtimeLaunch.invocation,
      sessionId: resolvedSessionId,
      sandboxMode: runtime.metadata.sandboxMode,
      approvalPolicy: runtime.metadata.approvalPolicy,
      warnings,
    },
  }));

  const issueSet = existsSync(workspace.issueSetFilePath)
    ? loadIssueDraftSet({
        repoRoot,
        runDir: workspace.runDir,
        issueSetFilePath: workspace.issueSetFilePath,
        fallbackSourceIssueNumber: issueNumber,
      })
    : undefined;

  if (issueSet) {
    persistIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtime.type,
      workspace,
      resolvedSessionId,
      {
        mode: "kept-on-disk",
      }
    );
    printGeneratedTextPreview(
      "Generated issue set ignored by issue refinement",
      formatIssueDraftSetPreview(repoRoot, issueSet)
    );
    console.log(
      `Issue refinement no longer creates linked issues. The generated issue set was kept at ${toRepoRelativePath(
        repoRoot,
        workspace.issueSetFilePath
      )}; rerun refinement with a single original-issue specification or split the work explicitly outside this refinement flow.`
    );
    return;
  }

  const questionsContents = existsSync(workspace.questionsFilePath)
    ? readFileSync(workspace.questionsFilePath, "utf8").trim()
    : "";

  if (questionsContents) {
    if (!forge.isAuthenticated()) {
      printGeneratedTextPreview(
        "Generated issue refinement questions",
        questionsContents
      );
      console.log(
        forge.type === "github"
          ? "Issue refinement questions were not posted because GitHub access is unavailable."
          : "Issue refinement questions were not posted because repository forge support is disabled by .prs/config.json."
      );
      persistIssueRefineSessionState(
        repoRoot,
        issueNumber,
        runtime.type,
        workspace,
        resolvedSessionId,
        {
          mode: "kept-on-disk",
        }
      );
      return;
    }

    const reviewedQuestions = await reviewGeneratedText({
      filePath: workspace.questionsFilePath,
      initialContent: questionsContents,
      previewHeading: "Generated issue refinement questions",
      prompt: `Post these refinement questions to issue #${issueNumber}? [Y/n/m]: `,
      emptyContentMessage: "Issue refinement questions cannot be empty.",
      editorDescription: "issue refinement questions",
      promptForLine,
    });

    if (!reviewedQuestions) {
      persistIssueRefineSessionState(
        repoRoot,
        issueNumber,
        runtime.type,
        workspace,
        resolvedSessionId,
        {
          mode: "kept-on-disk",
        }
      );
      console.log(
        `Refinement questions kept at ${toRepoRelativePath(
          repoRoot,
          workspace.questionsFilePath
        )}.`
      );
      return;
    }

    await publishIssueRefinementQuestionsComment({
      forge,
      issueNumber,
      questionsMarkdown: reviewedQuestions.content,
      outputLogPath: workspace.outputLogPath,
    });
    persistIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtime.type,
      workspace,
      resolvedSessionId,
      {
        mode: "questions-posted",
      }
    );
    return;
  }

  if (!existsSync(workspace.draftFilePath)) {
    throw new Error(
      `${runtime.displayName} did not write refinement questions to ${toRepoRelativePath(repoRoot, workspace.questionsFilePath)} or a refined issue draft to ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }

  const draftContents = readFileSync(workspace.draftFilePath, "utf8").trim();
  if (!draftContents) {
    throw new Error(
      `${runtime.displayName} wrote an empty refined issue draft at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
  }

  if (!forge.isAuthenticated()) {
    printGeneratedTextPreview("Generated refined issue draft", draftContents);
    console.log(
      forge.type === "github"
        ? "Issue refinement apply step skipped because GitHub access is unavailable."
        : "Issue refinement apply step skipped because repository forge support is disabled by .prs/config.json."
    );
    persistIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtime.type,
      workspace,
      resolvedSessionId,
      {
        mode: "kept-on-disk",
      }
    );
    return;
  }

  const reviewedDraft = await reviewIssueRefinementPublicationArtifacts({
    repoRoot,
    issueNumber,
    workspace,
    draftContents,
    useCodexSuperpowers: shouldUseCodexSuperpowers,
    promptForLine,
  });

  if (!reviewedDraft) {
    persistIssueRefineSessionState(
      repoRoot,
      issueNumber,
      runtime.type,
      workspace,
      resolvedSessionId,
      {
        mode: "kept-on-disk",
      }
    );
    console.log(
      `Refined draft kept at ${toRepoRelativePath(repoRoot, workspace.draftFilePath)}.`
    );
    if (shouldUseCodexSuperpowers) {
      console.log(
        `Issue specification kept at ${toRepoRelativePath(
          repoRoot,
          workspace.superpowersSpecFilePath
        )}.`
      );
      console.log(
        `Issue implementation plan kept at ${toRepoRelativePath(
          repoRoot,
          workspace.superpowersPlanFilePath
        )}.`
      );
    }
    return;
  }

  const parsedDraft = parseIssueDraftDocument(reviewedDraft.content);
  persistIssueRefineSessionState(
    repoRoot,
    issueNumber,
    runtime.type,
    workspace,
    resolvedSessionId,
    {
      mode: "published-artifacts",
      issueNumber,
      issueUrl: issue.url,
    }
  );
  console.log(`Publishing refinement artifacts on issue: ${issue.url}`);
  await publishIssueRefinementArtifacts({
    repoRoot,
    forge,
    issueNumber,
    issueTitle: parsedDraft.title,
    issueBody: parsedDraft.body,
    issueUrl: issue.url,
    refinedMarkdown: reviewedDraft.content,
    comments,
    workspace,
    useCodexSuperpowers: shouldUseCodexSuperpowers,
  });
}

export function readRequiredIssueRefineArtifact(
  repoRoot: string,
  filePath: string,
  label: string
): string {
  if (!existsSync(filePath)) {
    throw new Error(
      `${label} was not written to ${toRepoRelativePath(repoRoot, filePath)}.`
    );
  }

  const contents = readFileSync(filePath, "utf8").trim();
  if (!contents) {
    throw new Error(`${label} is empty: ${toRepoRelativePath(repoRoot, filePath)}`);
  }

  return contents;
}

export async function reviewIssueRefinementPublicationArtifacts(options: {
  repoRoot: string;
  issueNumber: number;
  workspace: IssueRefineWorkspace;
  draftContents: string;
  useCodexSuperpowers: boolean;
  promptForLine(prompt: string): Promise<string>;
}): Promise<ReviewedGeneratedText | null> {
  const reviewedDraft = await reviewGeneratedText({
    filePath: options.workspace.draftFilePath,
    initialContent: options.draftContents,
    previewHeading: "Generated refined issue draft",
    prompt: `Apply this refinement to issue #${options.issueNumber} and review managed spec/plan comments? [Y/n/m]: `,
    emptyContentMessage: "Issue refine draft cannot be empty.",
    editorDescription: "issue refine draft",
    promptForLine: options.promptForLine,
    validate: (content) => {
      parseIssueDraftDocument(content);
    },
  });

  if (!reviewedDraft || !options.useCodexSuperpowers) {
    return reviewedDraft;
  }

  const specContents = readRequiredIssueRefineArtifact(
    options.repoRoot,
    options.workspace.superpowersSpecFilePath,
    "Issue specification"
  );
  const reviewedSpec = await reviewGeneratedText({
    filePath: options.workspace.superpowersSpecFilePath,
    initialContent: specContents,
    previewHeading: "Generated issue specification",
    prompt: `Publish this issue specification comment on issue #${options.issueNumber}? [Y/n/m]: `,
    emptyContentMessage: "Issue specification cannot be empty.",
    editorDescription: "issue specification",
    promptForLine: options.promptForLine,
  });

  if (!reviewedSpec) {
    return null;
  }

  const planContents = readRequiredIssueRefineArtifact(
    options.repoRoot,
    options.workspace.superpowersPlanFilePath,
    "Issue implementation plan"
  );
  const reviewedPlan = await reviewGeneratedText({
    filePath: options.workspace.superpowersPlanFilePath,
    initialContent: planContents,
    previewHeading: "Generated issue implementation plan",
    prompt: `Publish this issue implementation plan comment on issue #${options.issueNumber}? [Y/n/m]: `,
    emptyContentMessage: "Issue implementation plan cannot be empty.",
    editorDescription: "issue implementation plan",
    promptForLine: options.promptForLine,
  });

  if (!reviewedPlan) {
    return null;
  }

  return reviewedDraft;
}
