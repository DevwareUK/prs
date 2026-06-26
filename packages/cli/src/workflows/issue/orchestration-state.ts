import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const ISSUE_ORCHESTRATION_STAGES = [
  "prepare",
  "implement",
  "local-verify",
  "open-pr",
  "pr-ready",
  "pr-review",
  "publish-review",
  "address-comments",
  "wait-ci",
  "fix-ci",
  "final-audit",
  "ready-for-review",
] as const;

export type IssueOrchestrationStageName = (typeof ISSUE_ORCHESTRATION_STAGES)[number];

export const ISSUE_ORCHESTRATION_STATUSES = [
  "pending",
  "running",
  "complete",
  "skipped",
  "blocked",
  "failed",
] as const;

export type IssueOrchestrationStageStatus =
  (typeof ISSUE_ORCHESTRATION_STATUSES)[number];

export type IssueOrchestrationStage = {
  name: IssueOrchestrationStageName;
  status: IssueOrchestrationStageStatus;
  summary?: string;
  retryCommand?: string;
  updatedAt?: string;
};

export type IssueOrchestrationState = {
  version: 1;
  issueNumber: number;
  prNumber?: number;
  createdAt: string;
  updatedAt: string;
  stages: IssueOrchestrationStage[];
};

export type IssueOrchestrationSummary = Record<
  IssueOrchestrationStageStatus,
  number
>;

const STAGE_NAMES = new Set<string>(ISSUE_ORCHESTRATION_STAGES);
const STATUSES = new Set<string>(ISSUE_ORCHESTRATION_STATUSES);

export function getIssueOrchestrationStateFilePath(runDir: string): string {
  return resolve(runDir, "issue-orchestration-state.json");
}

function nowIso(explicitNow?: string): string {
  return explicitNow ?? new Date().toISOString();
}

function writeIssueOrchestrationState(
  runDir: string,
  state: IssueOrchestrationState
): IssueOrchestrationState {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    getIssueOrchestrationStateFilePath(runDir),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  return state;
}

export function createIssueOrchestrationState(input: {
  runDir: string;
  issueNumber: number;
  prNumber?: number;
  now?: string;
}): IssueOrchestrationState {
  const timestamp = nowIso(input.now);
  const state: IssueOrchestrationState = {
    version: 1,
    issueNumber: input.issueNumber,
    prNumber: input.prNumber,
    createdAt: timestamp,
    updatedAt: timestamp,
    stages: ISSUE_ORCHESTRATION_STAGES.map((name) => ({
      name,
      status: "pending",
    })),
  };

  return writeIssueOrchestrationState(input.runDir, state);
}

export function loadIssueOrchestrationState(runDir: string): IssueOrchestrationState {
  const stateFilePath = getIssueOrchestrationStateFilePath(runDir);
  if (!existsSync(stateFilePath)) {
    throw new Error(`Issue orchestration state does not exist at ${stateFilePath}.`);
  }

  const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as unknown;
  if (!isIssueOrchestrationState(parsed)) {
    throw new Error(
      `Issue orchestration state at ${stateFilePath} is malformed. Remove it and rerun the issue workflow to recreate orchestration state.`
    );
  }
  return parsed;
}

export function updateIssueOrchestrationStage(input: {
  runDir: string;
  stage: IssueOrchestrationStageName;
  status: IssueOrchestrationStageStatus;
  summary?: string;
  retryCommand?: string;
  now?: string;
}): IssueOrchestrationState {
  const state = loadIssueOrchestrationState(input.runDir);
  const timestamp = nowIso(input.now);
  const stages = state.stages.map((stage) =>
    stage.name === input.stage
      ? {
          name: stage.name,
          status: input.status,
          summary: input.summary,
          retryCommand: input.retryCommand,
          updatedAt: timestamp,
        }
      : stage
  );

  return writeIssueOrchestrationState(input.runDir, {
    ...state,
    updatedAt: timestamp,
    stages,
  });
}

export function getNextIssueOrchestrationStage(
  state: IssueOrchestrationState
): IssueOrchestrationStage | undefined {
  return state.stages.find(
    (stage) => stage.status !== "complete" && stage.status !== "skipped"
  );
}

export function summarizeIssueOrchestrationState(
  state: IssueOrchestrationState
): IssueOrchestrationSummary {
  return state.stages.reduce<IssueOrchestrationSummary>(
    (summary, stage) => ({
      ...summary,
      [stage.status]: summary[stage.status] + 1,
    }),
    {
      pending: 0,
      running: 0,
      complete: 0,
      skipped: 0,
      blocked: 0,
      failed: 0,
    }
  );
}

function isIssueOrchestrationState(value: unknown): value is IssueOrchestrationState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<IssueOrchestrationState>;
  return (
    state.version === 1 &&
    Number.isSafeInteger(state.issueNumber) &&
    state.issueNumber > 0 &&
    (state.prNumber === undefined ||
      (Number.isSafeInteger(state.prNumber) && state.prNumber > 0)) &&
    typeof state.createdAt === "string" &&
    typeof state.updatedAt === "string" &&
    Array.isArray(state.stages) &&
    state.stages.length === ISSUE_ORCHESTRATION_STAGES.length &&
    state.stages.every(isIssueOrchestrationStage) &&
    state.stages.every((stage, index) => stage.name === ISSUE_ORCHESTRATION_STAGES[index])
  );
}

function isIssueOrchestrationStage(
  value: unknown
): value is IssueOrchestrationStage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const stage = value as Partial<IssueOrchestrationStage>;
  return (
    typeof stage.name === "string" &&
    STAGE_NAMES.has(stage.name) &&
    typeof stage.status === "string" &&
    STATUSES.has(stage.status) &&
    (stage.summary === undefined || typeof stage.summary === "string") &&
    (stage.retryCommand === undefined || typeof stage.retryCommand === "string") &&
    (stage.updatedAt === undefined || typeof stage.updatedAt === "string")
  );
}
