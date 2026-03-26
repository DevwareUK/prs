import type { IssueDetails, RepositoryComment } from "../../forge";

export type PullRequestFixTestsWorkspace = {
  runDir: string;
  snapshotFilePath: string;
  promptFilePath: string;
  metadataFilePath: string;
  outputLogPath: string;
  finalMessageFilePath: string;
};

export type PullRequestLinkedIssueContext = IssueDetails & {
  number: number;
};

export type PullRequestTestSuggestionPriority = "high" | "medium" | "low";

export type PullRequestTestSuggestion = {
  suggestionId: string;
  area: string;
  priority: PullRequestTestSuggestionPriority;
  value: string;
  likelyLocations: string[];
};

export type PullRequestTestSuggestionsComment = {
  sourceComment: RepositoryComment;
  overview: string;
  suggestions: PullRequestTestSuggestion[];
  edgeCases: string[];
  likelyLocations: string[];
};
