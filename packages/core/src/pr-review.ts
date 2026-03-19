import {
  PRReviewInput,
  PRReviewInputType,
  PRReviewOutput,
  PRReviewOutputType,
} from "@git-ai/contracts";
import { AIProvider } from "@git-ai/providers";
import {
  buildDiffTaskPrompt,
  DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
} from "./diff-task";
import {
  generateStructuredOutput,
  normalizeNullableFields,
} from "./structured-generation";

const PR_REVIEW_SYSTEM_PROMPT = [
  "You are a senior software engineer reviewing a GitHub pull request.",
  "Produce a concise overall review summary, a small set of high-signal inline review comments, and only when justified a very small set of higher-level findings.",
  ...DIFF_GROUNDED_SYSTEM_PROMPT_LINES,
  "Use linked issue context when it is provided so you can check whether the change matches the requested behavior.",
  "Focus on correctness, maintainability, performance, security, and testing concerns.",
  "When the diff is documentation-heavy, review onboarding flow, setup accuracy, command correctness, and time-to-first-success with the same rigor as code.",
  "Higher-level findings must stay grounded in the diff and should highlight correctness, usability, onboarding, or issue-alignment gaps that are awkward to express as a single inline comment.",
  "Avoid style nits, formatting feedback, and speculative comments.",
  "Only emit inline comments when the diff strongly supports an actionable concern.",
  "Each inline comment must point at a changed file path and a right-side line number from the diff.",
  "Prefer zero comments or findings over weak comments.",
].join(" ");

type ReviewMode = "docs-heavy" | "standard";

interface DiffFileStats {
  path: string;
  changedLines: number;
}

interface ReviewClassification {
  mode: ReviewMode;
  signals: string[];
}

const README_PATH_RE = /(^|\/)README(\.[^/]+)?$/i;
const DOC_DIRECTORY_RE = /(^|\/)(docs?|documentation|guides?|onboarding)(\/|$)/i;
const EXAMPLE_DIRECTORY_RE = /(^|\/)(examples?|samples?)(\/|$)/i;
const DOC_EXTENSION_RE = /\.(md|mdx|rst|adoc|txt)$/i;
const CONFIG_EXAMPLE_RE = /(\.|-)(example|sample|template)(\.[^/]+)?$/i;

function isDocLikePath(path: string): boolean {
  return (
    README_PATH_RE.test(path) ||
    DOC_DIRECTORY_RE.test(path) ||
    EXAMPLE_DIRECTORY_RE.test(path) ||
    DOC_EXTENSION_RE.test(path) ||
    CONFIG_EXAMPLE_RE.test(path)
  );
}

function collectDiffFileStats(diff: string): DiffFileStats[] {
  const statsByPath = new Map<string, DiffFileStats>();
  let currentPath: string | undefined;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentPath = match?.[2];
      if (currentPath && !statsByPath.has(currentPath)) {
        statsByPath.set(currentPath, {
          path: currentPath,
          changedLines: 0,
        });
      }
      continue;
    }

    if (!currentPath) {
      continue;
    }

    if (
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---"))
    ) {
      const current = statsByPath.get(currentPath);
      if (current) {
        current.changedLines += 1;
      }
    }
  }

  return [...statsByPath.values()];
}

function classifyReviewDiff(diff: string): ReviewClassification {
  const fileStats = collectDiffFileStats(diff);
  if (fileStats.length === 0) {
    return {
      mode: "standard",
      signals: ["No changed file paths were detected from the diff header."],
    };
  }

  const docFiles = fileStats.filter((file) => isDocLikePath(file.path));
  const totalChangedLines = fileStats.reduce(
    (sum, file) => sum + file.changedLines,
    0
  );
  const docChangedLines = docFiles.reduce(
    (sum, file) => sum + file.changedLines,
    0
  );
  const readmeChangedLines = fileStats
    .filter((file) => README_PATH_RE.test(file.path))
    .reduce((sum, file) => sum + file.changedLines, 0);
  const docFileRatio = docFiles.length / fileStats.length;
  const docLineRatio =
    totalChangedLines > 0 ? docChangedLines / totalChangedLines : 0;
  const isDocsHeavy =
    docFiles.length > 0 &&
    (docFileRatio >= 0.6 ||
      docLineRatio >= 0.65 ||
      readmeChangedLines >= 25 ||
      (docChangedLines >= 20 && docLineRatio >= 0.5));

  const signals = [
    `Changed files: ${fileStats.length}; doc-like files: ${docFiles.length}.`,
    `Changed lines: ${totalChangedLines}; doc-like changed lines: ${docChangedLines}.`,
  ];
  if (readmeChangedLines > 0) {
    signals.push(`README changed lines: ${readmeChangedLines}.`);
  }

  return {
    mode: isDocsHeavy ? "docs-heavy" : "standard",
    signals,
  };
}

function buildPrompt(input: PRReviewInputType): string {
  const contextLines: string[] = [];
  const classification = classifyReviewDiff(input.diff);
  if (input.prTitle) {
    contextLines.push(`PR Title: ${input.prTitle}`);
  }
  if (input.prBody) {
    contextLines.push(`PR Body: ${input.prBody}`);
  }
  if (input.issueNumber !== undefined) {
    contextLines.push(`Linked Issue Number: ${input.issueNumber}`);
  }
  if (input.issueTitle) {
    contextLines.push(`Linked Issue Title: ${input.issueTitle}`);
  }
  if (input.issueBody) {
    contextLines.push(`Linked Issue Body: ${input.issueBody}`);
  }
  if (input.issueUrl) {
    contextLines.push(`Linked Issue URL: ${input.issueUrl}`);
  }

  contextLines.push(
    `Review classification: ${classification.mode}.`,
    ...classification.signals.map((signal) => `Classification signal: ${signal}`)
  );

  return buildDiffTaskPrompt({
    taskLine:
      "Generate an AI pull request review from the provided diff.",
    guidanceLines: [
      'The "summary" should be a short paragraph describing the overall review outcome and how the change aligns with the diff context.',
      'The "comments" array should contain 0 to 8 actionable inline comments.',
      'The "findings" array should contain 0 to 3 actionable higher-level findings that are grounded in the diff but are not naturally tied to one changed line.',
      'Each comment must use a "path" that appears in the diff.',
      'Each comment "line" must be the right-side line number for an added or modified line in the diff.',
      'Use "severity" to communicate review priority.',
      'Use "category" to classify the concern.',
      'The comment "body" should explain the specific concern and why it matters.',
      'Include "suggestion" only when you can concisely describe a better implementation.',
      "When the linked issue context matters, mention requirement alignment in the summary or comments.",
      "Return an empty comments array when there are no strong line-level concerns.",
      "Return an empty findings array when there are no strong higher-level concerns.",
      ...(classification.mode === "docs-heavy"
        ? [
            "This diff is documentation-heavy, so review for command correctness, setup accuracy, first-time user clarity, time to first success, duplicated or overly dense guidance, confusing internal language, and whether the issue goals are only partially satisfied.",
            'Prefer the "findings" array for invalid or confusing commands, incomplete onboarding/setup flows, or docs issues that span multiple changed sections.',
            "Do not emit generic writing advice, tone feedback, or style-only wording suggestions.",
          ]
        : [
            'The "findings" array should usually stay empty for code-heavy diffs unless the diff strongly supports a broader actionable concern.',
          ]),
    ],
    schemaLines: [
      '  "summary": string,',
      '  "comments": [',
      "    {",
      '      "path": string,',
      '      "line": number,',
      '      "severity": "high" | "medium" | "low",',
      '      "category": "bug" | "correctness" | "security" | "performance" | "maintainability" | "testing" | "documentation" | "usability",',
      '      "body": string,',
      '      "suggestion"?: string',
      "    }",
      "  ],",
      '  "findings": [',
      "    {",
      '      "title": string,',
      '      "severity": "high" | "medium" | "low",',
      '      "category": "bug" | "correctness" | "security" | "performance" | "maintainability" | "testing" | "documentation" | "usability",',
      '      "body": string,',
      '      "suggestion"?: string,',
      '      "relatedPaths"?: string[]',
      "    }",
      "  ]",
    ],
    contextLines:
      contextLines.length > 0
        ? ["Supporting context (optional, may be incomplete):", ...contextLines]
        : undefined,
    diff: input.diff,
  });
}

function normalizeModelOutput(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const result = normalizeNullableFields(value, []);
  if (!result || typeof result !== "object") {
    return result;
  }

  const normalized = { ...(result as Record<string, unknown>) };
  if (Array.isArray(normalized.comments)) {
    normalized.comments = normalized.comments.map((comment) =>
      normalizeNullableFields(comment, ["suggestion"])
    );
  }
  if (Array.isArray(normalized.findings)) {
    normalized.findings = normalized.findings.map((finding) =>
      normalizeNullableFields(finding, ["suggestion", "relatedPaths"])
    );
  }

  return normalized;
}

export async function generatePRReview(
  provider: AIProvider,
  input: PRReviewInputType
): Promise<PRReviewOutputType> {
  const parsedInput = PRReviewInput.parse(input);
  const prompt = buildPrompt(parsedInput);

  return generateStructuredOutput({
    provider,
    systemPrompt: PR_REVIEW_SYSTEM_PROMPT,
    prompt,
    schema: PRReviewOutput,
    validationErrorPrefix: "Model output failed PR review schema validation",
    normalizeParsedJson: normalizeModelOutput,
  });
}
