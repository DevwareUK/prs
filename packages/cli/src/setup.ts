import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  GENERATED_BY_SETUP_HEADER,
  LEGACY_ACTION_REPOSITORY,
  LEGACY_GENERATED_BY_SETUP_HEADER,
  LEGACY_SETUP_SECTION_END,
  LEGACY_SETUP_SECTION_START,
  SETUP_SECTION_END,
  SETUP_SECTION_START,
  type RepositoryConfigType,
} from "@prs/contracts";
import {
  DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS,
  DEFAULT_REPOSITORY_AI_RUNTIME_TYPE,
  DEFAULT_REPOSITORY_BASE_BRANCH,
  DEFAULT_REPOSITORY_BUILD_COMMAND,
} from "@prs/core";
import {
  formatCommandForDisplay,
  getRepositoryConfigPath,
  loadRepositoryConfig,
} from "./config";
import { getInteractiveRuntimeByType, isCodexSuperpowersAvailable } from "./runtime";

const SETUP_USAGE = ["Usage:", "  prs setup"].join("\n");
const AGENTS_SECTION_START = SETUP_SECTION_START;
const AGENTS_SECTION_END = SETUP_SECTION_END;
const GIT_AI_WORKFLOW_MARKER = GENERATED_BY_SETUP_HEADER;
const GIT_AI_ACTION_REF = "main";
const GIT_AI_ACTION_REPOSITORY = "DevwareUK/prs";

type ForgeType = "github" | "none";
type PackageManagerType = "pnpm" | "yarn" | "npm";
type RuntimeType = "codex" | "claude-code";
type GitHubWorkflowId = "pr-review" | "pr-assistant" | "test-suggestions";

type DetectionResult<T> = {
  value: T;
  source: string;
  warnings: string[];
};

type PackageJson = {
  packageManager?: string;
  scripts?: Record<string, string>;
  workspaces?: unknown;
};

type ComposerJson = {
  scripts?: Record<string, unknown>;
};

type RepositoryInspection = {
  summary: string;
  signals: string[];
  suggestedBaseBranch: string;
  suggestedBaseBranchSource: string;
  suggestedBuildCommand: string[];
  suggestedBuildCommandSource: string;
  suggestedIssueDraftUseCodexSuperpowers: boolean;
  suggestedIssueDraftUseCodexSuperpowersSource: string;
  suggestedForgeTypeSource: string;
  suggestedRuntimeType: RuntimeType;
  suggestedRuntimeTypeSource: string;
  suggestedExcludePaths: string[];
  suggestedForgeType: ForgeType;
  actionableGitHubWorkflowIds: GitHubWorkflowId[];
  missingGitHubWorkflowIds: GitHubWorkflowId[];
  warnings: string[];
  stackLabel: string;
  hasGitHubWorkflows: boolean;
};

type SetupAnswers = {
  baseBranch: string;
  buildCommand: string[];
  excludePaths: string[];
  forgeType: ForgeType;
  issueDraftUseCodexSuperpowers: boolean;
  runtimeType: RuntimeType;
  installGitHubWorkflows: boolean;
  updateAgents: boolean;
};

type GitHubWorkflowTemplate = {
  fileName: string;
  id: GitHubWorkflowId;
  label: string;
};

type GitHubWorkflowInstallResult = {
  installed: string[];
  skipped: string[];
  updated: string[];
};

const RECOMMENDED_GITHUB_WORKFLOWS: readonly GitHubWorkflowTemplate[] = [
  {
    fileName: "prs-pr-review.yml",
    id: "pr-review",
    label: "PR review",
  },
  {
    fileName: "prs-pr-assistant.yml",
    id: "pr-assistant",
    label: "PR assistant",
  },
  {
    fileName: "prs-test-suggestions.yml",
    id: "test-suggestions",
    label: "test suggestions",
  },
];

function readJsonFile<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function fileExists(repoRoot: string, relativePath: string): boolean {
  return existsSync(resolve(repoRoot, relativePath));
}

function directoryExists(repoRoot: string, relativePath: string): boolean {
  const path = resolve(repoRoot, relativePath);
  if (!existsSync(path)) {
    return false;
  }

  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listDirectoryEntries(repoRoot: string, relativePath: string): string[] {
  try {
    return readdirSync(resolve(repoRoot, relativePath));
  } catch {
    return [];
  }
}

function parsePackageManagerName(
  packageManager: string | undefined
): PackageManagerType | undefined {
  const normalized = packageManager?.trim().split("@")[0];
  if (normalized === "pnpm" || normalized === "yarn" || normalized === "npm") {
    return normalized;
  }

  return undefined;
}

function detectPackageManager(
  repoRoot: string,
  packageJson?: PackageJson
): DetectionResult<PackageManagerType> {
  const packageManagerField = parsePackageManagerName(packageJson?.packageManager);
  const lockfileSignals = [
    fileExists(repoRoot, "pnpm-lock.yaml") ? "pnpm" : undefined,
    fileExists(repoRoot, "yarn.lock") ? "yarn" : undefined,
    fileExists(repoRoot, "package-lock.json") || fileExists(repoRoot, "npm-shrinkwrap.json")
      ? "npm"
      : undefined,
  ].filter((value): value is PackageManagerType => value !== undefined);

  if (packageManagerField) {
    const conflictingLockfiles = lockfileSignals.filter(
      (lockfileManager) => lockfileManager !== packageManagerField
    );
    return {
      value: packageManagerField,
      source: `package.json packageManager field (${packageManagerField})`,
      warnings:
        conflictingLockfiles.length > 0
          ? [
              `Detected conflicting package-manager lockfiles (${conflictingLockfiles.join(", ")}). Using package.json packageManager field "${packageManagerField}" and asking you to confirm it.`,
            ]
          : [],
    };
  }

  const uniqueLockfileSignals = uniqueStrings(lockfileSignals);
  if (uniqueLockfileSignals.length === 1) {
    const detected = uniqueLockfileSignals[0] as PackageManagerType;
    return {
      value: detected,
      source: `${detected} lockfile`,
      warnings: [],
    };
  }

  if (uniqueLockfileSignals.length > 1) {
    const detected = uniqueLockfileSignals.includes("npm")
      ? "npm"
      : (uniqueLockfileSignals[0] as PackageManagerType);
    return {
      value: detected,
      source: `conflicting lockfiles (${uniqueLockfileSignals.join(", ")})`,
      warnings: [
        `Detected multiple package-manager lockfiles (${uniqueLockfileSignals.join(", ")}). Using "${detected}" as the initial suggestion and asking you to confirm it.`,
      ],
    };
  }

  return {
    value: "npm",
    source: "prs fallback",
    warnings: [
      "No package-manager signal was detected. Falling back to npm-style script suggestions until you confirm a command.",
    ],
  };
}

function commandForScript(packageManager: PackageManagerType, scriptName: string): string[] {
  if (packageManager === "yarn") {
    return ["yarn", scriptName];
  }

  if (packageManager === "pnpm") {
    return scriptName === "build" || scriptName === "test"
      ? ["pnpm", scriptName]
      : ["pnpm", "run", scriptName];
  }

  if (scriptName === "test") {
    return ["npm", "test"];
  }

  return ["npm", "run", scriptName];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseOriginDefaultBranch(rawValue: string): string | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  const parts = trimmed.split("/");
  return parts[parts.length - 1] || undefined;
}

function collectLocalBranches(repoRoot: string): string[] {
  const rawBranches = tryGitCommand(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
  if (!rawBranches) {
    return [];
  }

  return rawBranches
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function tryGitCommand(repoRoot: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
}

function detectBaseBranch(
  repoRoot: string,
  existingConfig?: RepositoryConfigType
): DetectionResult<string> {
  if (existingConfig?.baseBranch) {
    return {
      value: existingConfig.baseBranch,
      source: "existing .prs/config.json",
      warnings: [],
    };
  }

  const originHead = tryGitCommand(repoRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  const originBranch = originHead ? parseOriginDefaultBranch(originHead) : undefined;
  if (originBranch) {
    return {
      value: originBranch,
      source: "origin default branch",
      warnings: [],
    };
  }

  const localBranches = collectLocalBranches(repoRoot);
  const wellKnownBranches = localBranches.filter((branchName) =>
    ["main", "master", "develop", "development", "trunk"].includes(branchName)
  );
  const currentBranch = tryGitCommand(repoRoot, ["branch", "--show-current"]);
  if (wellKnownBranches.length === 1) {
    return {
      value: wellKnownBranches[0] as string,
      source: `local branch "${wellKnownBranches[0]}"`,
      warnings: [
        `Could not resolve origin's default branch. Falling back to the local "${wellKnownBranches[0]}" branch and asking you to confirm it.`,
      ],
    };
  }

  if (currentBranch && !wellKnownBranches.includes(currentBranch)) {
    return {
      value: currentBranch,
      source: `current branch "${currentBranch}"`,
      warnings: [
        `Could not resolve origin's default branch. Falling back to the current branch "${currentBranch}" and asking you to confirm it.`,
      ],
    };
  }

  const conflicts = wellKnownBranches.length > 1 ? wellKnownBranches.join(", ") : undefined;
  return {
    value: DEFAULT_REPOSITORY_BASE_BRANCH,
    source: conflicts ? `prs fallback after conflicting local branches (${conflicts})` : "prs fallback",
    warnings: [
      conflicts
        ? `Could not resolve origin's default branch and found multiple plausible local base branches (${conflicts}). Starting from "${DEFAULT_REPOSITORY_BASE_BRANCH}" so you can choose the correct branch explicitly.`
        : `Could not resolve origin's default branch and found no clear local base-branch signal. Falling back to "${DEFAULT_REPOSITORY_BASE_BRANCH}" until you confirm the right branch.`,
    ],
  };
}

function detectForgeType(
  repoRoot: string,
  existingConfig?: RepositoryConfigType
): DetectionResult<ForgeType> {
  const existingType = existingConfig?.forge?.type;
  if (existingType === "github" || existingType === "none") {
    return {
      value: existingType,
      source: "existing .prs/config.json",
      warnings: [],
    };
  }

  const remoteUrl = tryGitCommand(repoRoot, ["remote", "get-url", "origin"]);
  if (remoteUrl && /github\.com[:/]/i.test(remoteUrl)) {
    const warnings: string[] = [];
    if (!canUseGitHubForgeFromCurrentShell()) {
      warnings.push(
        "GitHub repository signals were detected, but neither an authenticated `gh` session nor `GH_TOKEN`/`GITHUB_TOKEN` is available in the current shell. GitHub-backed issue and PR flows will need auth before they can run."
      );
    }
    return {
      value: "github",
      source: "GitHub origin remote",
      warnings,
    };
  }

  if (directoryExists(repoRoot, ".github")) {
    return {
      value: "github",
      source: ".github directory",
      warnings: canUseGitHubForgeFromCurrentShell()
        ? []
        : [
            "GitHub workflow files were detected, but GitHub auth is not available in the current shell yet. GitHub-backed issue and PR flows will need auth before they can run.",
          ],
    };
  }

  return {
    value: "none",
    source: "no GitHub repository signal detected",
    warnings: [],
  };
}

function canUseGitHubForgeFromCurrentShell(): boolean {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    return true;
  }

  try {
    execFileSync("gh", ["auth", "status"], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function detectRuntimeType(
  existingConfig?: RepositoryConfigType
): DetectionResult<RuntimeType> {
  const existingRuntime = existingConfig?.ai?.runtime?.type;
  if (existingRuntime === "codex" || existingRuntime === "claude-code") {
    return {
      value: existingRuntime,
      source: "existing .prs/config.json",
      warnings: [],
    };
  }

  const codexAvailability = getInteractiveRuntimeByType("codex").checkAvailability();
  if (codexAvailability.available) {
    return {
      value: "codex",
      source: "Codex CLI on PATH",
      warnings: [],
    };
  }

  const claudeAvailability = getInteractiveRuntimeByType("claude-code").checkAvailability();
  return {
    value: DEFAULT_REPOSITORY_AI_RUNTIME_TYPE,
    source: "prs default runtime",
    warnings: [
      claudeAvailability.available
        ? "Codex is not available on PATH yet, so interactive prs workflows would fail until you install it. Claude Code is available if you prefer to switch the runtime explicitly."
        : "Codex is not available on PATH yet, so interactive prs workflows would fail until you install it.",
    ],
  };
}

function detectIssueDraftUseCodexSuperpowers(
  existingConfig?: RepositoryConfigType
): DetectionResult<boolean> {
  const existingValue = existingConfig?.ai?.issueDraft?.useCodexSuperpowers;
  if (typeof existingValue === "boolean") {
    return {
      value: existingValue,
      source: "existing .prs/config.json",
      warnings: [],
    };
  }

  return isCodexSuperpowersAvailable()
    ? {
        value: true,
        source: "Superpowers plugin detected in local Codex installation",
        warnings: [],
      }
    : {
        value: false,
        source: "Superpowers plugin not detected in local Codex installation",
        warnings: [],
      };
}

function getGitAiWorkflowPath(repoRoot: string, fileName: string): string {
  return resolve(repoRoot, ".github", "workflows", fileName);
}

function getLegacyWorkflowFileName(workflowId: GitHubWorkflowId): string {
  if (workflowId === "pr-review") {
    return "git-ai-pr-review.yml";
  }

  if (workflowId === "pr-assistant") {
    return "git-ai-pr-assistant.yml";
  }

  return "git-ai-test-suggestions.yml";
}

function getLegacyWorkflowPath(repoRoot: string, workflowId: GitHubWorkflowId): string {
  return getGitAiWorkflowPath(repoRoot, getLegacyWorkflowFileName(workflowId));
}

function isLegacyManagedGitHubWorkflowContent(
  content: string,
  workflowId: GitHubWorkflowId
): boolean {
  const actionPath =
    workflowId === "pr-review"
      ? "actions/pr-review"
      : workflowId === "pr-assistant"
        ? "actions/pr-assistant"
        : "actions/test-suggestions";

  return (
    content.includes(LEGACY_GENERATED_BY_SETUP_HEADER) ||
    content.includes(`DevwareUK/ai-actions/${actionPath}@`) ||
    content.includes(`${LEGACY_ACTION_REPOSITORY}/${actionPath}@`)
  );
}

function isManagedGitHubWorkflow(
  repoRoot: string,
  workflow: GitHubWorkflowTemplate
): boolean {
  const filePath = getGitAiWorkflowPath(repoRoot, workflow.fileName);
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, "utf8");
    return (
      content.includes(GIT_AI_WORKFLOW_MARKER) ||
      isLegacyManagedGitHubWorkflowContent(content, workflow.id)
    );
  }

  const legacyPath = getLegacyWorkflowPath(repoRoot, workflow.id);
  if (!existsSync(legacyPath)) {
    return false;
  }

  return isLegacyManagedGitHubWorkflowContent(readFileSync(legacyPath, "utf8"), workflow.id);
}

function findMissingGitHubWorkflowIds(repoRoot: string): GitHubWorkflowId[] {
  return RECOMMENDED_GITHUB_WORKFLOWS.filter(
    (workflow) =>
      !existsSync(getGitAiWorkflowPath(repoRoot, workflow.fileName)) &&
      !existsSync(getLegacyWorkflowPath(repoRoot, workflow.id))
  ).map((workflow) => workflow.id);
}

function findActionableGitHubWorkflowIds(repoRoot: string): GitHubWorkflowId[] {
  return RECOMMENDED_GITHUB_WORKFLOWS.filter((workflow) => {
    const filePath = getGitAiWorkflowPath(repoRoot, workflow.fileName);
    return !existsSync(filePath) || isManagedGitHubWorkflow(repoRoot, workflow);
  }).map((workflow) => workflow.id);
}

function renderGitHubWorkflowLabels(workflowIds: readonly GitHubWorkflowId[]): string {
  return RECOMMENDED_GITHUB_WORKFLOWS.filter((workflow) => workflowIds.includes(workflow.id))
    .map((workflow) => workflow.label)
    .join(", ");
}

function renderGitAiWorkflowHeader(description: string): string[] {
  return [GIT_AI_WORKFLOW_MARKER, `# ${description}`, ""];
}

function renderPrReviewWorkflow(): string {
  return [
    ...renderGitAiWorkflowHeader(
      "Requires repository secret OPENAI_API_KEY. Optional repository variables: GIT_AI_OPENAI_MODEL, GIT_AI_OPENAI_BASE_URL."
    ),
    "name: Pull Request Smith PR Review",
    "",
    "on:",
    "  pull_request:",
    "    types:",
    "      - opened",
    "      - synchronize",
    "      - reopened",
    "",
    "permissions:",
    "  contents: read",
    "  issues: read",
    "  pull-requests: write",
    "",
    "jobs:",
    "  pr-review:",
    "    runs-on: ubuntu-latest",
    "",
    "    steps:",
    "      - name: Checkout repository",
    "        uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "",
    "      - name: Generate PR diff",
    "        id: diff",
    "        env:",
    "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
    "        run: |",
    "          DIFF_FILE=\"$RUNNER_TEMP/prs-pr-review.diff\"",
    "          git diff --unified=3 \"$BASE_SHA\" \"$HEAD_SHA\" > \"$DIFF_FILE\"",
    "          echo \"diff_file=$DIFF_FILE\" >> \"$GITHUB_OUTPUT\"",
    "          if [ -s \"$DIFF_FILE\" ]; then",
    "            echo \"has_diff=true\" >> \"$GITHUB_OUTPUT\"",
    "          else",
    "            echo \"has_diff=false\" >> \"$GITHUB_OUTPUT\"",
    "          fi",
    "",
    "      - name: Fetch linked issue context",
    "        id: linked_issue",
    "        uses: actions/github-script@v7",
    "        with:",
    "          github-token: ${{ secrets.GITHUB_TOKEN }}",
    "          script: |",
    "            const { owner, repo } = context.repo;",
    "            const pull_number = context.payload.pull_request.number;",
    "",
    "            const query = `",
    "              query($owner: String!, $repo: String!, $number: Int!) {",
    "                repository(owner: $owner, name: $repo) {",
    "                  pullRequest(number: $number) {",
    "                    closingIssuesReferences(first: 1) {",
    "                      nodes {",
    "                        number",
    "                        title",
    "                        body",
    "                        url",
    "                      }",
    "                    }",
    "                  }",
    "                }",
    "              }",
    "            `;",
    "",
    "            const data = await github.graphql(query, {",
    "              owner,",
    "              repo,",
    "              number: pull_number,",
    "            });",
    "",
    "            const issue =",
    "              data?.repository?.pullRequest?.closingIssuesReferences?.nodes?.[0];",
    "",
    "            core.setOutput(\"issue_number\", issue ? String(issue.number) : \"\");",
    "            core.setOutput(\"issue_title\", issue?.title ?? \"\");",
    "            core.setOutput(\"issue_body\", issue?.body ?? \"\");",
    "            core.setOutput(\"issue_url\", issue?.url ?? \"\");",
    "",
    "      - name: Generate AI PR review",
    "        id: pr_review",
    "        if: ${{ steps.diff.outputs.has_diff == 'true' }}",
    `        uses: ${GIT_AI_ACTION_REPOSITORY}/actions/pr-review@${GIT_AI_ACTION_REF}`,
    "        with:",
    "          diff_file: ${{ steps.diff.outputs.diff_file }}",
    "          pr_title: ${{ github.event.pull_request.title }}",
    "          pr_body: ${{ github.event.pull_request.body }}",
    "          issue_number: ${{ steps.linked_issue.outputs.issue_number }}",
    "          issue_title: ${{ steps.linked_issue.outputs.issue_title }}",
    "          issue_body: ${{ steps.linked_issue.outputs.issue_body }}",
    "          issue_url: ${{ steps.linked_issue.outputs.issue_url }}",
    "          openai_api_key: ${{ secrets.OPENAI_API_KEY }}",
    "          openai_model: ${{ vars.GIT_AI_OPENAI_MODEL }}",
    "          openai_base_url: ${{ vars.GIT_AI_OPENAI_BASE_URL }}",
    "",
    "      - name: Create or update managed PR review comment",
    "        if: ${{ steps.pr_review.outputs.body != '' }}",
    "        uses: actions/github-script@v7",
    "        env:",
    "          PR_REVIEW_BODY: ${{ steps.pr_review.outputs.body }}",
    "        with:",
    "          github-token: ${{ secrets.GITHUB_TOKEN }}",
    "          script: |",
    "            const marker = \"<!-- prs:pr-review -->\";",
    "            const managedBody = `${marker}\\n${process.env.PR_REVIEW_BODY}`;",
    "            const { owner, repo } = context.repo;",
    "            const issue_number = context.payload.pull_request.number;",
    "",
    "            const comments = await github.paginate(",
    "              github.rest.issues.listComments,",
    "              {",
    "                owner,",
    "                repo,",
    "                issue_number,",
    "                per_page: 100,",
    "              }",
    "            );",
    "",
    "            const existingComment = comments.find((comment) => {",
    "              const body = comment.body ?? \"\";",
    "              return body.includes(marker) && comment.user?.type === \"Bot\";",
    "            });",
    "",
    "            if (existingComment) {",
    "              await github.rest.issues.updateComment({",
    "                owner,",
    "                repo,",
    "                comment_id: existingComment.id,",
    "                body: managedBody,",
    "              });",
    "            } else {",
    "              await github.rest.issues.createComment({",
    "                owner,",
    "                repo,",
    "                issue_number,",
    "                body: managedBody,",
    "              });",
    "            }",
    "",
    "      - name: Publish inline review comments",
    "        if: ${{ steps.pr_review.outputs.comments_json != '' }}",
    "        uses: actions/github-script@v7",
    "        env:",
    "          COMMENTS_JSON: ${{ steps.pr_review.outputs.comments_json }}",
    "          DIFF_FILE: ${{ steps.diff.outputs.diff_file }}",
    "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
    "        with:",
    "          github-token: ${{ secrets.GITHUB_TOKEN }}",
    "          script: |",
    "            const { readFileSync } = require(\"node:fs\");",
    "",
    "            const parsedComments = JSON.parse(process.env.COMMENTS_JSON || \"[]\");",
    "            if (!Array.isArray(parsedComments) || parsedComments.length === 0) {",
    "              return;",
    "            }",
    "",
    "            function isCommentLike(value) {",
    "              return Boolean(",
    "                value &&",
    "                  typeof value === \"object\" &&",
    "                  typeof value.path === \"string\" &&",
    "                  Number.isInteger(value.line) &&",
    "                  value.line > 0 &&",
    "                  typeof value.body === \"string\" &&",
    "                  typeof value.whyThisMatters === \"string\" &&",
    "                  (value.confidence === \"high\" || value.confidence === \"medium\" || value.confidence === \"low\") &&",
    "                  (value.severity === \"high\" || value.severity === \"medium\" || value.severity === \"low\") &&",
    "                  typeof value.category === \"string\"",
    "              );",
    "            }",
    "",
    "            function collectChangedLines(diff) {",
    "              const changedLinesByPath = new Map();",
    "              let currentPath;",
    "              let newLine = 0;",
    "",
    "              for (const rawLine of diff.split(/\\r?\\n/)) {",
    "                if (rawLine.startsWith(\"+++ b/\")) {",
    "                  currentPath = rawLine.slice(6);",
    "                  if (!changedLinesByPath.has(currentPath)) {",
    "                    changedLinesByPath.set(currentPath, new Set());",
    "                  }",
    "                  continue;",
    "                }",
    "",
    "                const hunkMatch = rawLine.match(/^@@ -\\d+(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@/);",
    "                if (hunkMatch) {",
    "                  newLine = Number.parseInt(hunkMatch[1], 10);",
    "                  continue;",
    "                }",
    "",
    "                if (!currentPath) {",
    "                  continue;",
    "                }",
    "",
    "                if (rawLine.startsWith(\"+\") && !rawLine.startsWith(\"+++\")) {",
    "                  changedLinesByPath.get(currentPath)?.add(newLine);",
    "                  newLine += 1;",
    "                  continue;",
    "                }",
    "",
    "                if (rawLine.startsWith(\"-\") && !rawLine.startsWith(\"---\")) {",
    "                  continue;",
    "                }",
    "",
    "                if (rawLine.startsWith(\" \")) {",
    "                  newLine += 1;",
    "                }",
    "              }",
    "",
    "              return changedLinesByPath;",
    "            }",
    "",
    "            function toTitleCase(value) {",
    "              return value.charAt(0).toUpperCase() + value.slice(1);",
    "            }",
    "",
    "            function formatCommentBody(comment) {",
    "              const lines = [",
    "                `**${toTitleCase(comment.severity)} severity, ${toTitleCase(comment.confidence)} confidence ${toTitleCase(comment.category)}**`,",
    "                \"\",",
    "                comment.body,",
    "                \"\",",
    "                `Why this matters: ${comment.whyThisMatters}`,",
    "              ];",
    "",
    "              if (comment.suggestedFix) {",
    "                lines.push(\"\", `Suggested fix: ${comment.suggestedFix}`);",
    "              }",
    "",
    "              return lines.join(\"\\n\");",
    "            }",
    "",
    "            function buildInlineComments(comments, diff) {",
    "              const changedLinesByPath = collectChangedLines(diff);",
    "              const dedupe = new Set();",
    "              const result = [];",
    "",
    "              for (const rawComment of comments) {",
    "                if (!isCommentLike(rawComment) || rawComment.confidence !== \"high\") {",
    "                  continue;",
    "                }",
    "",
    "                const changedLines = changedLinesByPath.get(rawComment.path);",
    "                if (!changedLines?.has(rawComment.line)) {",
    "                  continue;",
    "                }",
    "",
    "                const body = formatCommentBody(rawComment);",
    "                const key = `${rawComment.path}:${rawComment.line}:${body}`;",
    "                if (dedupe.has(key)) {",
    "                  continue;",
    "                }",
    "",
    "                dedupe.add(key);",
    "                result.push({",
    "                  path: rawComment.path,",
    "                  line: rawComment.line,",
    "                  side: \"RIGHT\",",
    "                  body,",
    "                });",
    "              }",
    "",
    "              return result;",
    "            }",
    "",
    "            const diff =",
    "              process.env.DIFF_FILE ? readFileSync(process.env.DIFF_FILE, \"utf8\") : \"\";",
    "            const comments = buildInlineComments(parsedComments, diff);",
    "",
    "            if (comments.length === 0) {",
    "              return;",
    "            }",
    "",
    "            await github.rest.pulls.createReview({",
    "              owner: context.repo.owner,",
    "              repo: context.repo.repo,",
    "              pull_number: context.payload.pull_request.number,",
    "              commit_id: process.env.HEAD_SHA,",
    "              event: \"COMMENT\",",
    "              body: \"AI PR pre-review signal generated high-confidence inline comments on changed lines.\",",
    "              comments,",
    "            });",
    "",
  ].join("\n");
}

function renderPrAssistantWorkflow(): string {
  return [
    ...renderGitAiWorkflowHeader(
      "Requires repository secret OPENAI_API_KEY. Optional repository variables: GIT_AI_OPENAI_MODEL, GIT_AI_OPENAI_BASE_URL."
    ),
    "name: Pull Request Smith PR Assistant",
    "",
    "on:",
    "  pull_request:",
    "    types:",
    "      - opened",
    "      - synchronize",
    "      - reopened",
    "",
    "permissions:",
    "  contents: read",
    "  pull-requests: write",
    "",
    "jobs:",
    "  pr-assistant:",
    "    runs-on: ubuntu-latest",
    "",
    "    steps:",
    "      - name: Checkout repository",
    "        uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "",
    "      - name: Generate PR diff",
    "        id: diff",
    "        env:",
    "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
    "        run: |",
    "          DIFF_FILE=\"$RUNNER_TEMP/prs-pr-assistant.diff\"",
    "          git diff --unified=3 \"$BASE_SHA\" \"$HEAD_SHA\" > \"$DIFF_FILE\"",
    "          echo \"diff_file=$DIFF_FILE\" >> \"$GITHUB_OUTPUT\"",
    "          if [ -s \"$DIFF_FILE\" ]; then",
    "            echo \"has_diff=true\" >> \"$GITHUB_OUTPUT\"",
    "          else",
    "            echo \"has_diff=false\" >> \"$GITHUB_OUTPUT\"",
    "          fi",
    "",
    "      - name: Generate PR commit messages",
    "        id: commits",
    "        env:",
    "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
    "        run: |",
    "          COMMIT_MESSAGES_FILE=\"$RUNNER_TEMP/prs-pr-assistant-commits.txt\"",
    "          git log --reverse --format='%s%n%b%n---' \"$BASE_SHA..$HEAD_SHA\" > \"$COMMIT_MESSAGES_FILE\"",
    "          echo \"commit_messages_file=$COMMIT_MESSAGES_FILE\" >> \"$GITHUB_OUTPUT\"",
    "",
    "      - name: Generate PR assistant section",
    "        id: pr_assistant",
    "        if: ${{ steps.diff.outputs.has_diff == 'true' }}",
    `        uses: ${GIT_AI_ACTION_REPOSITORY}/actions/pr-assistant@${GIT_AI_ACTION_REF}`,
    "        with:",
    "          diff_file: ${{ steps.diff.outputs.diff_file }}",
    "          commit_messages_file: ${{ steps.commits.outputs.commit_messages_file }}",
    "          pr_title: ${{ github.event.pull_request.title }}",
    "          pr_body: ${{ github.event.pull_request.body }}",
    "          openai_api_key: ${{ secrets.OPENAI_API_KEY }}",
    "          openai_model: ${{ vars.GIT_AI_OPENAI_MODEL }}",
    "          openai_base_url: ${{ vars.GIT_AI_OPENAI_BASE_URL }}",
    "",
    "      - name: Update PR body",
    "        if: ${{ steps.pr_assistant.outputs.body != '' }}",
    "        uses: actions/github-script@v7",
    "        env:",
    "          BODY: ${{ steps.pr_assistant.outputs.body }}",
    "        with:",
    "          github-token: ${{ secrets.GITHUB_TOKEN }}",
    "          script: |",
    "            await github.rest.pulls.update({",
    "              owner: context.repo.owner,",
    "              repo: context.repo.repo,",
    "              pull_number: context.payload.pull_request.number,",
    "              body: process.env.BODY,",
    "            });",
    "",
  ].join("\n");
}

function renderTestSuggestionsWorkflow(): string {
  return [
    ...renderGitAiWorkflowHeader(
      "Requires repository secret OPENAI_API_KEY. Optional repository variables: GIT_AI_OPENAI_MODEL, GIT_AI_OPENAI_BASE_URL."
    ),
    "name: Pull Request Smith Test Suggestions",
    "",
    "on:",
    "  pull_request:",
    "    types:",
    "      - opened",
    "      - synchronize",
    "      - reopened",
    "",
    "permissions:",
    "  contents: read",
    "  pull-requests: write",
    "",
    "jobs:",
    "  test-suggestions:",
    "    runs-on: ubuntu-latest",
    "",
    "    steps:",
    "      - name: Checkout repository",
    "        uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    "",
    "      - name: Generate PR diff",
    "        id: diff",
    "        env:",
    "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
    "        run: |",
    "          DIFF_FILE=\"$RUNNER_TEMP/prs-test-suggestions.diff\"",
    "          git diff --unified=3 \"$BASE_SHA\" \"$HEAD_SHA\" > \"$DIFF_FILE\"",
    "          echo \"diff_file=$DIFF_FILE\" >> \"$GITHUB_OUTPUT\"",
    "          if [ -s \"$DIFF_FILE\" ]; then",
    "            echo \"has_diff=true\" >> \"$GITHUB_OUTPUT\"",
    "          else",
    "            echo \"has_diff=false\" >> \"$GITHUB_OUTPUT\"",
    "          fi",
    "",
    "      - name: Generate test suggestions",
    "        id: test_suggestions",
    "        if: ${{ steps.diff.outputs.has_diff == 'true' }}",
    `        uses: ${GIT_AI_ACTION_REPOSITORY}/actions/test-suggestions@${GIT_AI_ACTION_REF}`,
    "        with:",
    "          diff_file: ${{ steps.diff.outputs.diff_file }}",
    "          pr_title: ${{ github.event.pull_request.title }}",
    "          pr_body: ${{ github.event.pull_request.body }}",
    "          openai_api_key: ${{ secrets.OPENAI_API_KEY }}",
    "          openai_model: ${{ vars.GIT_AI_OPENAI_MODEL }}",
    "          openai_base_url: ${{ vars.GIT_AI_OPENAI_BASE_URL }}",
    "",
    "      - name: Create or update managed PR comment",
    "        if: ${{ steps.test_suggestions.outputs.body != '' }}",
    "        uses: actions/github-script@v7",
    "        env:",
    "          TEST_SUGGESTIONS_BODY: ${{ steps.test_suggestions.outputs.body }}",
    "        with:",
    "          github-token: ${{ secrets.GITHUB_TOKEN }}",
    "          script: |",
    "            const marker = \"<!-- prs:test-suggestions -->\";",
    "            const managedBody = `${marker}\\n${process.env.TEST_SUGGESTIONS_BODY}`;",
    "            const { owner, repo } = context.repo;",
    "            const issue_number = context.payload.pull_request.number;",
    "",
    "            const comments = await github.paginate(",
    "              github.rest.issues.listComments,",
    "              {",
    "                owner,",
    "                repo,",
    "                issue_number,",
    "                per_page: 100,",
    "              }",
    "            );",
    "",
    "            const existingComment = comments.find((comment) => {",
    "              const body = comment.body ?? \"\";",
    "              return body.includes(marker) && comment.user?.type === \"Bot\";",
    "            });",
    "",
    "            if (existingComment) {",
    "              await github.rest.issues.updateComment({",
    "                owner,",
    "                repo,",
    "                comment_id: existingComment.id,",
    "                body: managedBody,",
    "              });",
    "            } else {",
    "              await github.rest.issues.createComment({",
    "                owner,",
    "                repo,",
    "                issue_number,",
    "                body: managedBody,",
    "              });",
    "            }",
    "",
  ].join("\n");
}

function renderGitHubWorkflow(workflowId: GitHubWorkflowId): string {
  if (workflowId === "pr-review") {
    return renderPrReviewWorkflow();
  }

  if (workflowId === "pr-assistant") {
    return renderPrAssistantWorkflow();
  }

  return renderTestSuggestionsWorkflow();
}

function installGitHubWorkflows(
  repoRoot: string,
  workflowIds: readonly GitHubWorkflowId[]
): GitHubWorkflowInstallResult {
  const workflowsDir = resolve(repoRoot, ".github", "workflows");
  mkdirSync(workflowsDir, { recursive: true });

  const result: GitHubWorkflowInstallResult = {
    installed: [],
    skipped: [],
    updated: [],
  };

  for (const workflow of RECOMMENDED_GITHUB_WORKFLOWS.filter((entry) =>
    workflowIds.includes(entry.id)
  )) {
    const filePath = resolve(workflowsDir, workflow.fileName);
    const legacyPath = getLegacyWorkflowPath(repoRoot, workflow.id);
    const nextContent = `${renderGitHubWorkflow(workflow.id)}\n`;

    if (!existsSync(filePath)) {
      writeFileSync(filePath, nextContent, "utf8");
      result.installed.push(filePath);
      if (existsSync(legacyPath) && isLegacyManagedGitHubWorkflowContent(readFileSync(legacyPath, "utf8"), workflow.id)) {
        rmSync(legacyPath, { force: true });
      }
      continue;
    }

    if (!isManagedGitHubWorkflow(repoRoot, workflow)) {
      result.skipped.push(filePath);
      continue;
    }

    writeFileSync(filePath, nextContent, "utf8");
    result.updated.push(filePath);
    if (existsSync(legacyPath) && isLegacyManagedGitHubWorkflowContent(readFileSync(legacyPath, "utf8"), workflow.id)) {
      rmSync(legacyPath, { force: true });
    }
  }

  return result;
}

function detectRepositoryShape(repoRoot: string, packageJson?: PackageJson, composerJson?: ComposerJson) {
  const hasPackageJson = packageJson !== undefined;
  const hasComposerJson = composerJson !== undefined;
  const hasTypeScript = fileExists(repoRoot, "tsconfig.json");
  const hasPnpmWorkspace = fileExists(repoRoot, "pnpm-workspace.yaml");
  const packageDirs = ["packages", "apps", "services", "actions"].filter((dir) =>
    directoryExists(repoRoot, dir)
  );
  const workspaceCount = packageDirs.reduce((count, dir) => {
    return (
      count +
      listDirectoryEntries(repoRoot, dir).filter((entry) =>
        fileExists(repoRoot, `${dir}/${entry}/package.json`)
      ).length
    );
  }, 0);
  const isMonorepo =
    hasPnpmWorkspace ||
    (Array.isArray(packageJson?.workspaces) && packageJson.workspaces.length > 0) ||
    workspaceCount > 1;
  const hasDrupal =
    hasComposerJson &&
    [
      "web/core",
      "docroot/core",
      "web/modules",
      "docroot/modules",
      "web/themes",
      "docroot/themes",
    ].some((path) => directoryExists(repoRoot, path));
  const hasGitHubWorkflows = directoryExists(repoRoot, ".github/workflows");

  let stackLabel = "repository";
  if (hasPackageJson && hasComposerJson && hasDrupal) {
    stackLabel = "mixed Node.js + Drupal/PHP repository";
  } else if (hasPackageJson && hasComposerJson) {
    stackLabel = "mixed Node.js + PHP repository";
  } else if (hasDrupal) {
    stackLabel = "Drupal/PHP repository";
  } else if (hasPackageJson && hasTypeScript && isMonorepo) {
    stackLabel = "TypeScript monorepo";
  } else if (hasPackageJson && hasTypeScript) {
    stackLabel = "TypeScript repository";
  } else if (hasPackageJson && isMonorepo) {
    stackLabel = "Node.js monorepo";
  } else if (hasPackageJson) {
    stackLabel = "Node.js repository";
  } else if (hasComposerJson) {
    stackLabel = "PHP repository";
  }

  return {
    hasComposerJson,
    hasDrupal,
    hasGitHubWorkflows,
    hasPackageJson,
    hasTypeScript,
    isMonorepo,
    stackLabel,
  };
}

function detectBuildCommand(
  repoRoot: string,
  existingConfig: RepositoryConfigType | undefined,
  packageJson: PackageJson | undefined,
  composerJson: ComposerJson | undefined
): DetectionResult<string[]> {
  if (existingConfig?.buildCommand) {
    return {
      value: existingConfig.buildCommand,
      source: "existing .prs/config.json",
      warnings: [],
    };
  }

  const packageManager = detectPackageManager(repoRoot, packageJson);
  const scripts = packageJson?.scripts ?? {};
  for (const scriptName of ["verify", "build", "test"]) {
    if (typeof scripts[scriptName] === "string" && scripts[scriptName].trim().length > 0) {
      return {
        value: commandForScript(packageManager.value, scriptName),
        source: `package.json script "${scriptName}" via ${packageManager.source}`,
        warnings: [...packageManager.warnings],
      };
    }
  }

  const composerScripts = composerJson?.scripts ?? {};
  for (const scriptName of ["verify", "build", "test"]) {
    if (composerScripts[scriptName] !== undefined) {
      return {
        value: ["composer", scriptName],
        source: `composer.json script "${scriptName}"`,
        warnings: [],
      };
    }
  }

  if (fileExists(repoRoot, "vendor/bin/phpunit")) {
    return {
      value: ["vendor/bin/phpunit"],
      source: "vendor/bin/phpunit",
      warnings: [],
    };
  }

  if (fileExists(repoRoot, "phpunit.xml") || fileExists(repoRoot, "phpunit.xml.dist")) {
    return {
      value: ["phpunit"],
      source: "phpunit.xml",
      warnings: [],
    };
  }

  return {
    value: [...DEFAULT_REPOSITORY_BUILD_COMMAND],
    source: "prs fallback",
    warnings: [
      `No obvious verification or test command was detected. Falling back to \`${formatCommandForDisplay(
        [...DEFAULT_REPOSITORY_BUILD_COMMAND]
      )}\` until you confirm a repository-specific command.`,
    ],
  };
}

function detectSuggestedExcludePaths(
  repoRoot: string,
  existingConfig: RepositoryConfigType | undefined
): string[] {
  const suggestions: string[] = [];
  const defaultExcludePaths = [...DEFAULT_REPOSITORY_AI_CONTEXT_EXCLUDE_PATHS];

  const optionalGeneratedPaths = [
    { exists: directoryExists(repoRoot, "coverage"), pattern: "**/coverage/**" },
    { exists: directoryExists(repoRoot, ".next"), pattern: "**/.next/**" },
    { exists: directoryExists(repoRoot, ".nuxt"), pattern: "**/.nuxt/**" },
    { exists: directoryExists(repoRoot, ".svelte-kit"), pattern: "**/.svelte-kit/**" },
    { exists: directoryExists(repoRoot, ".turbo"), pattern: "**/.turbo/**" },
    { exists: directoryExists(repoRoot, "storybook-static"), pattern: "**/storybook-static/**" },
    { exists: directoryExists(repoRoot, ".cache"), pattern: "**/.cache/**" },
    { exists: directoryExists(repoRoot, "public/build"), pattern: "public/build/**" },
    { exists: directoryExists(repoRoot, "generated"), pattern: "**/generated/**" },
    {
      exists: directoryExists(repoRoot, "web/sites/default/files"),
      pattern: "web/sites/default/files/**",
    },
    {
      exists: directoryExists(repoRoot, "docroot/sites/default/files"),
      pattern: "docroot/sites/default/files/**",
    },
    {
      exists: directoryExists(repoRoot, "web/themes"),
      pattern: "web/themes/**/css/**",
    },
    {
      exists: directoryExists(repoRoot, "web/themes"),
      pattern: "web/themes/**/js/**",
    },
    {
      exists: directoryExists(repoRoot, "docroot/themes"),
      pattern: "docroot/themes/**/css/**",
    },
    {
      exists: directoryExists(repoRoot, "docroot/themes"),
      pattern: "docroot/themes/**/js/**",
    },
  ];

  for (const suggestion of optionalGeneratedPaths) {
    if (suggestion.exists) {
      suggestions.push(suggestion.pattern);
    }
  }

  return uniqueStrings([
    ...(existingConfig?.aiContext?.excludePaths ?? []),
    ...suggestions.filter(
      (pattern) => !defaultExcludePaths.some((defaultPattern) => defaultPattern === pattern)
    ),
  ]);
}

function inspectRepository(
  repoRoot: string,
  existingConfig: RepositoryConfigType | undefined
): RepositoryInspection {
  const packageJson = readJsonFile<PackageJson>(resolve(repoRoot, "package.json"));
  const composerJson = readJsonFile<ComposerJson>(resolve(repoRoot, "composer.json"));
  const shape = detectRepositoryShape(repoRoot, packageJson, composerJson);
  const buildCommand = detectBuildCommand(repoRoot, existingConfig, packageJson, composerJson);
  const baseBranch = detectBaseBranch(repoRoot, existingConfig);
  const forgeType = detectForgeType(repoRoot, existingConfig);
  const issueDraftUseCodexSuperpowers = detectIssueDraftUseCodexSuperpowers(existingConfig);
  const runtimeType = detectRuntimeType(existingConfig);
  const actionableGitHubWorkflowIds = findActionableGitHubWorkflowIds(repoRoot);
  const missingGitHubWorkflowIds = findMissingGitHubWorkflowIds(repoRoot);

  const signals = [shape.stackLabel];
  if (shape.isMonorepo) {
    signals.push("workspace layout detected");
  }
  if (shape.hasGitHubWorkflows) {
    signals.push("GitHub Actions workflows detected");
  }
  if (shape.hasDrupal) {
    signals.push("Drupal-style web/ or docroot/ structure detected");
  }
  if (shape.hasTypeScript) {
    signals.push("TypeScript config detected");
  }

  const warnings = [
    ...baseBranch.warnings,
    ...buildCommand.warnings,
    ...forgeType.warnings,
    ...runtimeType.warnings,
  ];

  return {
    summary: `Detected ${shape.stackLabel}.`,
    signals,
    suggestedBaseBranch: baseBranch.value,
    suggestedBaseBranchSource: baseBranch.source,
    suggestedBuildCommand: buildCommand.value,
    suggestedBuildCommandSource: buildCommand.source,
    suggestedIssueDraftUseCodexSuperpowers: issueDraftUseCodexSuperpowers.value,
    suggestedIssueDraftUseCodexSuperpowersSource: issueDraftUseCodexSuperpowers.source,
    suggestedForgeTypeSource: forgeType.source,
    suggestedRuntimeType: runtimeType.value,
    suggestedRuntimeTypeSource: runtimeType.source,
    suggestedExcludePaths: detectSuggestedExcludePaths(repoRoot, existingConfig),
    suggestedForgeType: forgeType.value,
    actionableGitHubWorkflowIds,
    missingGitHubWorkflowIds,
    warnings,
    stackLabel: shape.stackLabel,
    hasGitHubWorkflows: shape.hasGitHubWorkflows,
  };
}

function renderList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function parseCommandString(value: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        segments.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaped) {
    current += "\\";
  }

  if (quote) {
    throw new Error("Command contains an unmatched quote.");
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

function parseExcludePathList(value: string): string[] {
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === "none") {
    return [];
  }

  return uniqueStrings(normalized.split(","));
}

function renderDefaultValue(value: string): string {
  return value ? ` [${value}]` : "";
}

async function promptWithDefault(
  promptForLine: (prompt: string) => Promise<string>,
  prompt: string,
  defaultValue: string
): Promise<string> {
  const response = (await promptForLine(`${prompt}${renderDefaultValue(defaultValue)}: `)).trim();
  return response || defaultValue;
}

async function promptChoice<T extends string>(
  promptForLine: (prompt: string) => Promise<string>,
  prompt: string,
  choices: readonly T[],
  defaultValue: T
): Promise<T> {
  while (true) {
    const rawValue = (
      await promptForLine(`${prompt}${renderDefaultValue(defaultValue)}: `)
    )
      .trim()
      .toLowerCase();
    const value = (rawValue || defaultValue) as T;
    if (choices.includes(value)) {
      return value;
    }

    console.log(`Choose one of: ${choices.join(", ")}.`);
  }
}

async function promptCommand(
  promptForLine: (prompt: string) => Promise<string>,
  defaultCommand: string[]
): Promise<string[]> {
  while (true) {
    const response = await promptForLine(
      `Verification/build command${renderDefaultValue(
        formatCommandForDisplay(defaultCommand)
      )}: `
    );
    const normalized = response.trim();
    if (!normalized) {
      return defaultCommand;
    }

    try {
      const command = parseCommandString(normalized);
      if (command.length > 0) {
        return command;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(message);
      continue;
    }

    console.log("Enter a command like `pnpm build` or `composer test`.");
  }
}

async function promptExcludePaths(
  promptForLine: (prompt: string) => Promise<string>,
  defaultValue: string[]
): Promise<string[]> {
  while (true) {
    const response = await promptForLine(
      `Additional AI context exclusions beyond prs defaults${renderDefaultValue(
        renderList(defaultValue)
      )}: `
    );

    try {
      return response.trim() ? parseExcludePathList(response) : defaultValue;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(message);
    }
  }
}

async function promptYesNo(
  promptForLine: (prompt: string) => Promise<string>,
  prompt: string,
  defaultValue: boolean
): Promise<boolean> {
  while (true) {
    const suffix = defaultValue ? " [Y/n]" : " [y/N]";
    const response = (await promptForLine(`${prompt}${suffix}: `)).trim().toLowerCase();
    if (!response) {
      return defaultValue;
    }

    if (response === "y" || response === "yes") {
      return true;
    }

    if (response === "n" || response === "no") {
      return false;
    }

    console.log("Answer with yes or no.");
  }
}

function ensureGitAiIgnored(repoRoot: string): boolean {
  const gitignorePath = resolve(repoRoot, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());

  if (lines.includes(".prs") || lines.includes(".prs/")) {
    return false;
  }

  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(gitignorePath, `${existing}${prefix}.prs/\n`, "utf8");
  return true;
}

function buildRepositoryConfig(
  answers: SetupAnswers,
  existingConfig?: RepositoryConfigType
): RepositoryConfigType {
  const config: RepositoryConfigType = {
    baseBranch: answers.baseBranch,
    buildCommand: answers.buildCommand,
    forge: {
      type: answers.forgeType,
    },
  };

  const aiConfig: NonNullable<RepositoryConfigType["ai"]> = {
    ...(existingConfig?.ai ?? {}),
    issueDraft: {
      useCodexSuperpowers: answers.issueDraftUseCodexSuperpowers,
    },
    runtime: {
      type: answers.runtimeType,
    },
  };

  if (Object.keys(aiConfig).length > 0) {
    config.ai = aiConfig;
  }

  if (answers.excludePaths.length > 0) {
    config.aiContext = {
      excludePaths: answers.excludePaths,
    };
  }

  return config;
}

function writeRepositoryConfig(repoRoot: string, config: RepositoryConfigType): void {
  const configPath = getRepositoryConfigPath(repoRoot);
  mkdirSync(resolve(repoRoot, ".prs"), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function renderAgentsSection(): string {
  const lines = [
    AGENTS_SECTION_START,
    "## Repository guidance for agents",
    "",
    "Fill in only repository-specific guidance that is not obvious from code or config.",
    "",
    "- Protected paths or files:",
    "- Generated files that should not be edited directly:",
    "- Required verification beyond the default build/test command:",
    "- Deployment or rollback caveats:",
    "- Domain rules or content constraints:",
    "- Cross-file or cross-system updates agents should not miss:",
    "- Human approval checkpoints:",
    "",
    "Delete blank bullets once this scaffold is tailored to the repository.",
    AGENTS_SECTION_END,
    "",
  ];

  return lines.join("\n");
}

function upsertAgentsSection(repoRoot: string, section: string): void {
  const agentsPath = resolve(repoRoot, "AGENTS.md");
  const existing = existsSync(agentsPath) ? readFileSync(agentsPath, "utf8") : "";
  const markerPattern = new RegExp(
    `(?:${escapeRegExp(AGENTS_SECTION_START)}|${escapeRegExp(LEGACY_SETUP_SECTION_START)})[\\s\\S]*?(?:${escapeRegExp(AGENTS_SECTION_END)}|${escapeRegExp(LEGACY_SETUP_SECTION_END)})\\n?`,
    "m"
  );
  const nextContent = markerPattern.test(existing)
    ? existing.replace(markerPattern, section)
    : existing.trim().length > 0
      ? `${existing.replace(/\s*$/, "\n\n")}${section}`
      : section;

  writeFileSync(agentsPath, nextContent, "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureGitRepository(repoRoot: string): void {
  const actualRepoRoot = tryGitCommand(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (!actualRepoRoot) {
    throw new Error("prs setup must be run inside a Git repository.");
  }
}

function logInspection(repoRoot: string, inspection: RepositoryInspection): void {
  console.log(`Repository root: ${repoRoot}`);
  console.log(inspection.summary);
  console.log(`Signals: ${inspection.signals.join("; ")}`);
  console.log(
    `Suggested base branch: ${inspection.suggestedBaseBranch} (${inspection.suggestedBaseBranchSource})`
  );
  console.log(
    `Suggested verification command: ${formatCommandForDisplay(
      inspection.suggestedBuildCommand
    )} (${inspection.suggestedBuildCommandSource})`
  );
  console.log(
    `Suggested forge integration: ${inspection.suggestedForgeType} (${inspection.suggestedForgeTypeSource})`
  );
  console.log(
    `Suggested interactive runtime: ${inspection.suggestedRuntimeType} (${inspection.suggestedRuntimeTypeSource})`
  );
  console.log(
    `Suggested Codex Superpowers-backed issue drafting: ${
      inspection.suggestedIssueDraftUseCodexSuperpowers ? "enabled" : "disabled"
    } (${inspection.suggestedIssueDraftUseCodexSuperpowersSource})`
  );
  console.log(
    `Suggested extra AI context exclusions: ${renderList(inspection.suggestedExcludePaths)}`
  );
  if (
    inspection.suggestedForgeType === "github" &&
    inspection.actionableGitHubWorkflowIds.length > 0
  ) {
    console.log(
      `Recommended GitHub Actions available to install or update: ${renderGitHubWorkflowLabels(
        inspection.actionableGitHubWorkflowIds
      )}`
    );
  }
  for (const warning of inspection.warnings) {
    console.log(`Warning: ${warning}`);
  }
  console.log("");
}

function buildRecommendedAnswers(inspection: RepositoryInspection): Omit<
  SetupAnswers,
  "installGitHubWorkflows" | "updateAgents"
> {
  return {
    baseBranch: inspection.suggestedBaseBranch,
    buildCommand: inspection.suggestedBuildCommand,
    excludePaths: inspection.suggestedExcludePaths,
    forgeType: inspection.suggestedForgeType,
    issueDraftUseCodexSuperpowers: inspection.suggestedIssueDraftUseCodexSuperpowers,
    runtimeType: inspection.suggestedRuntimeType,
  };
}

async function collectCustomSetupAnswers(
  promptForLine: (prompt: string) => Promise<string>,
  inspection: RepositoryInspection
): Promise<Omit<SetupAnswers, "installGitHubWorkflows" | "updateAgents">> {
  const baseBranch = await promptWithDefault(
    promptForLine,
    "Default branch",
    inspection.suggestedBaseBranch
  );
  const forgeType = await promptChoice(
    promptForLine,
    "Forge integration",
    ["github", "none"],
    inspection.suggestedForgeType
  );
  const runtimeType = await promptChoice(
    promptForLine,
    "Interactive runtime",
    ["codex", "claude-code"],
    inspection.suggestedRuntimeType
  );
  const buildCommand = await promptCommand(promptForLine, inspection.suggestedBuildCommand);
  const excludePaths = await promptExcludePaths(
    promptForLine,
    inspection.suggestedExcludePaths
  );

  return {
    baseBranch,
    buildCommand,
    excludePaths,
    forgeType,
    issueDraftUseCodexSuperpowers: inspection.suggestedIssueDraftUseCodexSuperpowers,
    runtimeType,
  };
}

async function collectSetupAnswers(
  promptForLine: (prompt: string) => Promise<string>,
  inspection: RepositoryInspection,
  agentsFileExists: boolean
): Promise<SetupAnswers> {
  const useRecommendedAnswers = await promptYesNo(
    promptForLine,
    "Use the recommended setup values shown above",
    true
  );

  const recommendedAnswers = buildRecommendedAnswers(inspection);
  const customAnswers = useRecommendedAnswers
    ? recommendedAnswers
    : await collectCustomSetupAnswers(promptForLine, inspection);

  const installGitHubWorkflows =
    customAnswers.forgeType === "github" && inspection.actionableGitHubWorkflowIds.length > 0
      ? await promptYesNo(
          promptForLine,
          `Install or update recommended GitHub Actions workflows (${renderGitHubWorkflowLabels(
            inspection.actionableGitHubWorkflowIds
          )})`,
          true
        )
      : false;

  const updateAgents = await promptYesNo(
    promptForLine,
    agentsFileExists
      ? "Add or update a minimal prs managed scaffold in AGENTS.md"
      : "Create an optional AGENTS.md scaffold for repo-specific agent guidance",
    false
  );

  return {
    ...customAnswers,
    installGitHubWorkflows,
    updateAgents,
  };
}

export function parseSetupCommandArgs(args: string[]): void {
  if (args.length > 1) {
    throw new Error(`Unknown setup option "${args[1]}". ${SETUP_USAGE}`);
  }
}

export async function runSetupCommand(options: {
  promptForLine(prompt: string): Promise<string>;
  repoRoot: string;
}): Promise<void> {
  ensureGitRepository(options.repoRoot);

  const existingConfig = loadRepositoryConfig(options.repoRoot);
  const inspection = inspectRepository(options.repoRoot, existingConfig);
  const agentsPath = resolve(options.repoRoot, "AGENTS.md");

  console.log("Guided repository setup for prs");
  console.log("");
  console.log("Recommended launch path: GitHub forge, OpenAI provider, and Codex runtime.");
  console.log(
    "Advanced customization stays available through `bedrock-claude` and `claude-code`, but those paths are not the default launch recommendation."
  );
  console.log(
    "Runtime/provider asymmetry to keep in mind: GitHub Actions in this repo are OpenAI-only today, and unattended issue runs plus `prs pr prepare-review` remain Codex-specific."
  );
  console.log("");
  logInspection(options.repoRoot, inspection);

  const answers = await collectSetupAnswers(
    options.promptForLine,
    inspection,
    existsSync(agentsPath)
  );

  writeRepositoryConfig(options.repoRoot, buildRepositoryConfig(answers, existingConfig));
  const gitignoreUpdated = ensureGitAiIgnored(options.repoRoot);
  const workflowInstallResult = answers.installGitHubWorkflows
    ? installGitHubWorkflows(options.repoRoot, inspection.actionableGitHubWorkflowIds)
    : {
        installed: [],
        skipped: [],
        updated: [],
      };

  if (answers.updateAgents) {
    upsertAgentsSection(options.repoRoot, renderAgentsSection());
  }

  console.log("");
  console.log(`Wrote ${getRepositoryConfigPath(options.repoRoot)}.`);
  console.log(`Configured base branch: ${answers.baseBranch}`);
  console.log(
    `Configured verification command: ${formatCommandForDisplay(answers.buildCommand)}`
  );
  console.log(`Configured interactive runtime: ${answers.runtimeType}`);
  console.log(
    `Configured Codex Superpowers-backed issue drafting: ${
      answers.issueDraftUseCodexSuperpowers ? "enabled" : "disabled"
    }`
  );
  console.log(`Configured forge integration: ${answers.forgeType}`);
  console.log(
    gitignoreUpdated ? "Added `.prs/` to .gitignore." : "`.prs/` was already gitignored."
  );

  for (const installedPath of workflowInstallResult.installed) {
    console.log(`Installed ${installedPath}.`);
  }

  for (const updatedPath of workflowInstallResult.updated) {
    console.log(`Updated ${updatedPath}.`);
  }

  for (const skippedPath of workflowInstallResult.skipped) {
    console.log(
      `Skipped ${skippedPath} because it is not managed by prs setup.`
    );
  }

  if (answers.updateAgents) {
    console.log(`Updated ${resolve(options.repoRoot, "AGENTS.md")}.`);
  }

  if (!fileExists(options.repoRoot, ".env")) {
    console.log("");
    console.log(
      "Next step: create `.env` in the repository root with `OPENAI_API_KEY` for the recommended OpenAI launch path."
    );
    console.log("Optional OpenAI variables: `OPENAI_MODEL`, `OPENAI_BASE_URL`.");
    console.log(
      "Advanced customization: if you later switch the local CLI provider to `bedrock-claude`, also set AWS credentials plus `AWS_REGION` or `AWS_DEFAULT_REGION`."
    );
  }

  if (workflowInstallResult.installed.length > 0 || workflowInstallResult.updated.length > 0) {
    console.log("");
    console.log(
      "Next step: add the `OPENAI_API_KEY` repository secret in GitHub before enabling the installed workflows."
    );
    console.log(
      "Optional GitHub repository variables: `GIT_AI_OPENAI_MODEL`, `GIT_AI_OPENAI_BASE_URL`."
    );
  }
}
