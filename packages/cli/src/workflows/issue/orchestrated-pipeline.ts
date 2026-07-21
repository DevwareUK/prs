import type { IssuePullRequestOutcome } from "./types";
import {
  ISSUE_ORCHESTRATION_STAGES,
  createIssueOrchestrationState,
  updateIssueOrchestrationStage,
  type IssueOrchestrationStageName,
} from "./orchestration-state";

export type IssuePipelineStageHookResult =
  | {
      status: "ready" | "complete" | "skipped";
      summary: string;
    }
  | {
      status: "blocked";
      summary: string;
      retryCommand: string;
    };

export type IssuePipelineCiHookResult =
  | {
      status: "success";
      summary: string;
    }
  | {
      status: "skipped";
      summary: string;
    }
  | {
      status: "fix-needed";
      summary: string;
    }
  | {
      status: "blocked";
      summary: string;
      retryCommand: string;
    };

export type IssueOrchestratedPipelineHooks = {
  readyPullRequest(prNumber: number): Promise<IssuePipelineStageHookResult>;
  reviewPullRequest(prNumber: number): Promise<IssuePipelineStageHookResult>;
  publishReview(prNumber: number): Promise<IssuePipelineStageHookResult>;
  addressComments(prNumber: number): Promise<IssuePipelineStageHookResult>;
  waitForCi(prNumber: number): Promise<IssuePipelineCiHookResult>;
  fixCi(prNumber: number): Promise<IssuePipelineStageHookResult>;
  finalAudit(prNumber: number): Promise<IssuePipelineStageHookResult>;
  readyForReview(prNumber: number): Promise<IssuePipelineStageHookResult>;
};

export type IssueOrchestratedPipelineInput = {
  runDir: string;
  issueNumber: number;
  branchName: string;
  committed: boolean;
  pullRequest: IssuePullRequestOutcome;
  now?: string;
  maxCiFixAttempts?: number;
  hooks: IssueOrchestratedPipelineHooks;
};

export type IssueOrchestratedPipelineResult =
  | {
      status: "complete";
      prNumber: number;
    }
  | {
      status: "blocked";
      stage: IssueOrchestrationStageName;
      prNumber: number;
      retryCommand: string;
    }
  | {
      status: "skipped";
      reason: "no-pull-request";
    };

export async function runIssueOrchestratedPipeline(
  input: IssueOrchestratedPipelineInput
): Promise<IssueOrchestratedPipelineResult> {
  const prNumber =
    input.pullRequest.status === "created" && input.pullRequest.url
      ? parsePullRequestNumber(input.pullRequest.url)
      : undefined;
  createIssueOrchestrationState({
    runDir: input.runDir,
    issueNumber: input.issueNumber,
    prNumber,
    now: input.now,
  });

  markComplete(input, "prepare", `Prepared issue branch ${input.branchName}.`);
  markComplete(input, "implement", "Codex issue implementation completed.");
  markComplete(input, "local-verify", "Configured local verification completed.");

  if (input.pullRequest.status !== "created" || prNumber === undefined) {
    const reason =
      input.pullRequest.status === "skipped"
        ? input.pullRequest.reason
        : input.pullRequest.status;
    updateIssueOrchestrationStage({
      runDir: input.runDir,
      stage: "open-pr",
      status: "skipped",
      summary: `Pull request was not created: ${reason}.`,
      now: input.now,
    });
    skipPrLifecycleStages(input, "No pull request was available for this stage.");
    return { status: "skipped", reason: "no-pull-request" };
  }

  markComplete(input, "open-pr", `Opened pull request #${prNumber}.`);

  const readiness = await input.hooks.readyPullRequest(prNumber);
  const readinessResult = applyStageHookResult(input, "pr-ready", readiness, prNumber);
  if (readinessResult) {
    return readinessResult;
  }

  const reviewResult = applyStageHookResult(
    input,
    "pr-review",
    await input.hooks.reviewPullRequest(prNumber),
    prNumber
  );
  if (reviewResult) {
    return reviewResult;
  }

  const publishResult = applyStageHookResult(
    input,
    "publish-review",
    await input.hooks.publishReview(prNumber),
    prNumber
  );
  if (publishResult) {
    return publishResult;
  }

  const commentsResult = applyStageHookResult(
    input,
    "address-comments",
    await input.hooks.addressComments(prNumber),
    prNumber
  );
  if (commentsResult) {
    return commentsResult;
  }

  const ciResult = await runCiLoop(input, prNumber);
  if (ciResult) {
    return ciResult;
  }

  const finalAudit = await input.hooks.finalAudit(prNumber);
  const auditResult = applyStageHookResult(input, "final-audit", finalAudit, prNumber);
  if (auditResult) {
    return auditResult;
  }

  if (finalAudit.status === "skipped") {
    updateIssueOrchestrationStage({
      runDir: input.runDir,
      stage: "ready-for-review",
      status: "skipped",
      summary: "Draft promotion was skipped because final audit did not complete.",
      now: input.now,
    });
    return { status: "complete", prNumber };
  }

  const readyForReviewResult = applyStageHookResult(
    input,
    "ready-for-review",
    await input.hooks.readyForReview(prNumber),
    prNumber
  );
  if (readyForReviewResult) {
    return readyForReviewResult;
  }

  return { status: "complete", prNumber };
}

export function parsePullRequestNumber(url: string): number | undefined {
  const match = url.match(/\/pull\/(\d+)(?:$|[?#])/);
  if (!match) {
    return undefined;
  }

  const prNumber = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(prNumber) && prNumber > 0 ? prNumber : undefined;
}

function markComplete(
  input: IssueOrchestratedPipelineInput,
  stage: IssueOrchestrationStageName,
  summary: string
): void {
  updateIssueOrchestrationStage({
    runDir: input.runDir,
    stage,
    status: "complete",
    summary,
    now: input.now,
  });
}

function skipPrLifecycleStages(
  input: IssueOrchestratedPipelineInput,
  summary: string
): void {
  for (const stage of ISSUE_ORCHESTRATION_STAGES) {
    if (
      stage === "prepare" ||
      stage === "implement" ||
      stage === "local-verify" ||
      stage === "open-pr"
    ) {
      continue;
    }

    updateIssueOrchestrationStage({
      runDir: input.runDir,
      stage,
      status: "skipped",
      summary,
      now: input.now,
    });
  }
}

function applyStageHookResult(
  input: IssueOrchestratedPipelineInput,
  stage: IssueOrchestrationStageName,
  result: IssuePipelineStageHookResult,
  prNumber: number
): Extract<IssueOrchestratedPipelineResult, { status: "blocked" }> | undefined {
  if (result.status === "blocked") {
    updateIssueOrchestrationStage({
      runDir: input.runDir,
      stage,
      status: "blocked",
      summary: result.summary,
      retryCommand: result.retryCommand,
      now: input.now,
    });
    return {
      status: "blocked",
      stage,
      prNumber,
      retryCommand: result.retryCommand,
    };
  }

  updateIssueOrchestrationStage({
    runDir: input.runDir,
    stage,
    status: result.status === "skipped" ? "skipped" : "complete",
    summary: result.summary,
    now: input.now,
  });
  return undefined;
}

async function runCiLoop(
  input: IssueOrchestratedPipelineInput,
  prNumber: number
): Promise<Extract<IssueOrchestratedPipelineResult, { status: "blocked" }> | undefined> {
  const maxFixAttempts = input.maxCiFixAttempts ?? 1;
  for (let fixAttempt = 0; fixAttempt <= maxFixAttempts; fixAttempt += 1) {
    const ci = await input.hooks.waitForCi(prNumber);
    if (ci.status === "success" || ci.status === "skipped") {
      updateIssueOrchestrationStage({
        runDir: input.runDir,
        stage: "wait-ci",
        status: ci.status === "skipped" ? "skipped" : "complete",
        summary: ci.summary,
        now: input.now,
      });
      if (fixAttempt === 0) {
        updateIssueOrchestrationStage({
          runDir: input.runDir,
          stage: "fix-ci",
          status: "skipped",
          summary: "CI fix was not needed.",
          now: input.now,
        });
      }
      return undefined;
    }

    if (ci.status === "blocked") {
      updateIssueOrchestrationStage({
        runDir: input.runDir,
        stage: "wait-ci",
        status: "blocked",
        summary: ci.summary,
        retryCommand: ci.retryCommand,
        now: input.now,
      });
      return {
        status: "blocked",
        stage: "wait-ci",
        prNumber,
        retryCommand: ci.retryCommand,
      };
    }

    if (fixAttempt >= maxFixAttempts) {
      const retryCommand = `prs pr ${prNumber} fix-tests`;
      updateIssueOrchestrationStage({
        runDir: input.runDir,
        stage: "fix-ci",
        status: "blocked",
        summary: `CI still needs fixes after ${maxFixAttempts} fix attempt(s): ${ci.summary}`,
        retryCommand,
        now: input.now,
      });
      return {
        status: "blocked",
        stage: "fix-ci",
        prNumber,
        retryCommand,
      };
    }

    const fix = await input.hooks.fixCi(prNumber);
    const fixResult = applyStageHookResult(input, "fix-ci", fix, prNumber);
    if (fixResult) {
      return fixResult;
    }
  }

  return undefined;
}
