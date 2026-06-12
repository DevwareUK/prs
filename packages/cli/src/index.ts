#!/usr/bin/env node

export {
  extractIssuePlanLikelyFiles,
  findOverlappingPullRequests,
  normalizeRepositoryPath,
  parseCodexCommand,
  parsePrCommandArgs,
  parseSetupCommandArgs,
  parseUpdateCommandArgs,
  readReviewDiff,
  readReviewDiffForAutomation,
  recommendIssueBranchBase,
  run,
} from "./cli-runtime";
export { parseAuditCommandArgs } from "./commands/audit";
export {
  parseFeatureBacklogCommandArgs,
  parseTestBacklogCommandArgs,
} from "./commands/backlog";
export { parseIssueCommandArgs } from "./commands/issue";
export { parseReviewCommandArgs } from "./commands/review";

import { run } from "./cli-runtime";

if (process.env.PRS_DISABLE_AUTO_RUN !== "1") {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
