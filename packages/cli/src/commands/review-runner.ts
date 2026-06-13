import {
formatPRReviewMarkdown as formatCorePRReviewMarkdown,
generatePRReview,
} from "@prs/core";
import { createProvider,getCliArgs,getRepositoryForge } from "../cli-context";
import { readReviewDiff } from "../cli-git";
import { runFeatureBacklogCommand,runTestBacklogCommand } from "./backlog-runner";
import { parseReviewCommandArgs } from "./review";

export async function runReviewCommand(args = getCliArgs()): Promise<void> {
  if (args[1] === "tests") {
    await runTestBacklogCommand(args);
    return;
  }

  if (args[1] === "features") {
    await runFeatureBacklogCommand(args);
    return;
  }

  const options = parseReviewCommandArgs(args);
  const diff = readReviewDiff(options.base, options.head);
  const { provider } = await createProvider(undefined, "reviewer");
  const issue =
    options.issueNumber !== undefined
      ? await getRepositoryForge().fetchIssueDetails(options.issueNumber)
      : undefined;
  const result = await generatePRReview(provider, {
    diff,
    issueNumber: options.issueNumber,
    issueTitle: issue?.title,
    issueBody: issue?.body,
    issueUrl: issue?.url,
  });
  const output = {
    ...result,
    issue: issue
      ? {
          number: options.issueNumber,
          title: issue.title,
          url: issue.url,
        }
      : undefined,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${formatCorePRReviewMarkdown(result, {
      number: options.issueNumber,
      title: issue?.title,
      url: issue?.url,
    })}\n`
  );
}

