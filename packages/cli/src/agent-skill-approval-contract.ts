// Conservative, section-scoped instruction checks. These detect omissions in an
// installed pack; they do not establish that a native agent obtained approval.
function section(text: string, heading: string, level: number): string {
  const pattern = new RegExp(
    `^${"#".repeat(level)} ${heading}\\n([\\s\\S]*?)(?=^#{1,${level}} |$(?![\\s\\S]))`,
    "m"
  );
  return pattern.exec(text)?.[1]?.trim() ?? "";
}

const GATES = [
  {
    heading: "Specification approval",
    requirements: [
      /Use `superpowers:brainstorming`/,
      /Write and self-review the specification/i,
      /Show the specification file and wait for explicit user approval before proceeding to the plan/i,
    ],
  },
  {
    heading: "Plan approval",
    requirements: [
      /Use `superpowers:writing-plans`/,
      /write and self-review the implementation plan from the approved specification/i,
      /Show the plan file and wait for explicit user approval before (?:issue creation or )?publication/i,
    ],
  },
  {
    heading: "Publication approval",
    requirements: [
      /Show[^\n]*both reviewed artifacts/i,
      /Obtain explicit user approval to [^.\n]*publish both managed comments/i,
      /Design approval alone does not authorize publication/i,
      /question or scope change is not publication approval/i,
      /check both files exist, contain non-empty Markdown and match the approved versions/i,
    ],
  },
  {
    heading: "Completion verification",
    requirements: [
      /managedComments/,
      /status: published/,
      /<!-- prs:issue-spec -->/,
      /<!-- prs:issue-plan -->/,
      /mean(?:s)? incomplete work/,
      /prs tool issue context <number> --json/,
      /confirm both managed artifacts are present/i,
      /published content matches the approved files/i,
      /preserve the known issue numbers? and approved files/i,
      /prs tool issue publish-artifacts <number> --spec-file <spec> --plan-file <plan> --json/,
      /Changed content or targets require renewed approval/,
      /both verified managed-comment URLs/,
    ],
  },
];

function hasArtifactCommand(text: string, command: string): boolean {
  return text.split("\n").some(line =>
    line.includes(command) && line.includes("--spec-file ") &&
    line.includes("--plan-file ") && line.includes("--json")
  );
}

export function validateIssueApprovalInstructions(
  name: "prs-create" | "prs-issue",
  content: string | undefined
): string[] {
  if (content === undefined) return [`missing workflow skill: ${name}`];
  const text = content.replace(/\r\n/g, "\n");
  const errors: string[] = [];
  const missing = (phase: string): void => {
    errors.push(`${name}: missing ${phase} instructions`);
  };
  if (!/Both written artifacts are required even for bounded work\./.test(text)) {
    missing("mandatory written artifacts");
  }
  if (/\b(?:artifacts?|specification|plan)\b[^.\n]*\b(?:optional|when available)\b/i.test(text)) {
    errors.push(`${name}: optional artifact instructions`);
  }

  const workflow = name === "prs-create" ? text : section(text, "Refinement", 2);
  const level = name === "prs-create" ? 2 : 3;
  for (const gate of GATES) {
    const body = section(workflow, gate.heading, level);
    let valid = gate.requirements.every(requirement => requirement.test(body));
    if (gate.heading === "Publication approval") {
      const commands = name === "prs-create"
        ? ["prs tool issue create --draft-file", "prs tool issue create --issue-set"]
        : ["prs tool issue publish-artifacts <number>"];
      valid &&= commands.every(command => hasArtifactCommand(body, command));
    }
    if (gate.heading === "Completion verification") {
      valid &&= name === "prs-create"
        ? /For every created or reused issue/.test(body)
        : /For the original issue/.test(body);
    }
    if (!valid) missing(gate.heading.toLowerCase());
  }

  if (name === "prs-issue") {
    if (
      !/Preserve the original issue number, URL and request body\./.test(workflow) ||
      !/Never create a replacement issue or linked set from refinement/.test(workflow)
    ) missing("refinement identity");
    if (
      !/For a refine-only request, stop after verified publication unless implementation was requested\./.test(workflow) ||
      !/Continue here only when implementation was requested\./.test(section(text, "Lifecycle", 2))
    ) missing("refinement boundary");
    // Reject known contradictory directives even if the correct boundary remains
    // elsewhere in the skill. This is deliberately not a natural-language parser.
    if (/^[\t ]*(?:(?:[-*+]|\d+[.)])[\t ]+)?(?:Always|Automatically)\s+(?:create (?:a replacement issue|linked issues)|(?:run )?readiness|implement)\b/im.test(text)) {
      errors.push(`${name}: unsafe refinement instructions`);
    }
  }
  return errors;
}
