// Conservative, section-scoped instruction checks. These detect omissions in an
// installed pack; they do not establish that a native agent obtained approval.
function section(text: string, heading: string, level: number): string {
  const pattern = new RegExp(
    `^${"#".repeat(level)} ${heading}\\n([\\s\\S]*?)(?=^#{1,${level}} |$(?![\\s\\S]))`,
    "m"
  );
  return pattern.exec(text)?.[1]?.trim() ?? "";
}

const PHASES = [
  {
    heading: "Artifact preparation",
    requirements: [
      /use `superpowers:brainstorming`/i,
      /Write and self-review (?:each|the) specification/i,
      /use `superpowers:writing-plans`/i,
      /write and self-review (?:each|the) implementation plan/i,
      /without requesting intermediate approval/i,
    ],
  },
  {
    heading: "Unified approval",
    requirements: [
      /Show[^\n]*(?:both|every) reviewed artifacts?[^\n]*together/i,
      /one explicit user approval/i,
      /accepts (?:every|the) specification and plan/i,
      /authorizes[^.\n]*publish both managed comments/i,
      /Design approval alone does not authorize publication/i,
      /no remote write may happen before this approval/i,
      /question, qualification, scope change, content change or target change is not approval/i,
      /complete revised packet/i,
      /one fresh approval/i,
      /check both files exist, contain non-empty Markdown and match the displayed, approved versions/i,
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
  for (const phase of PHASES) {
    const body = section(workflow, phase.heading, level);
    let valid = phase.requirements.every(requirement => requirement.test(body));
    if (phase.heading === "Unified approval") {
      if (name === "prs-create") {
        const linkedCommand = body.split("\n").find(line =>
          line.includes("prs tool issue create --issue-set")
        );
        valid &&= hasArtifactCommand(body, "prs tool issue create --draft-file") &&
          Boolean(linkedCommand?.includes("--json")) &&
          !linkedCommand?.includes("--spec-file") &&
          !linkedCommand?.includes("--plan-file") &&
          /version-2 linked-set manifest/i.test(body) &&
          body.includes("specFile") &&
          body.includes("planFile") &&
          body.includes("orchestratorId") &&
          body.includes("parentId") &&
          /flat/i.test(body) &&
          /native hierarchy/i.test(body) &&
          /Show the exact issue draft or linked set/.test(body) &&
          /authorizes[^.\n]*create or reuse/i.test(body) &&
          /authorizes[^.\n]*hierarchy mutations/i.test(body);
      } else {
        valid &&= hasArtifactCommand(body, "prs tool issue publish-artifacts <number>") &&
          /show the original issue target/i.test(body) &&
          /on that same issue/.test(body);
      }
    }
    if (phase.heading === "Completion verification") {
      valid &&= name === "prs-create"
        ? /For every created or reused issue/.test(body) &&
          /require every requested `hierarchy\.relationships` entry to have `status: verified`/.test(body) &&
          /confirm both hierarchy directions/.test(body) &&
          /Flat mode[^.\n]*perform no parent mutation/.test(body) &&
          /`issue-set-receipt\.json`/.test(body) &&
          /relationship results/.test(body) &&
          /Retry the same approved linked creation command/.test(body) &&
          /without force-reparenting/.test(body)
        : /For the original issue/.test(body);
    }
    if (!valid) missing(phase.heading.toLowerCase());
  }

  const oldGateHeading = new RegExp(
    `^${"#".repeat(level)} (?:Specification|Plan|Publication) approval$`,
    "im"
  );
  const stagedApprovalPatterns = [
    /(?:specification|plan)[^.\n]*(?:wait for|obtain|request|require)[^.\n]*approval[^.\n]*before[^.\n]*(?:plan|planning|publication|issue creation)/i,
    /(?:wait for|obtain|request|require)[^.\n]*approval[^.\n]*(?:before|,?\s*then)[^.\n]*(?:writ(?:e|ing)|prepar(?:e|ing)|draft(?:ing)?|creat(?:e|ing))[^.\n]*(?:specification|plan)/i,
    /approval[^.\n]*(?:is|required to be|must be)[^.\n]*(?:required|obtained|requested)[^.\n]*before[^.\n]*(?:writ(?:e|ing)|prepar(?:e|ing)|draft(?:ing)?|creat(?:e|ing))[^.\n]*(?:specification|plan)/i,
  ];
  const stagedApprovalText = [
    /\b(?:never|do not|must not|may not|cannot|can't)\b[^.;\n]*?\b(?:wait for|obtain|request|require)\b[^.;\n]*?\bapproval\b[^.;\n]*?\bbefore\b[^.;\n]*?\b(?:writ(?:e|ing)|prepar(?:e|ing)|draft(?:ing)?|creat(?:e|ing))\b[^.;\n]*?\b(?:specification|plan)\b/gi,
    /\bapproval\b[^.;\n]*?\b(?:is|are)\s+not\s+(?:required|obtained|requested)\b[^.;\n]*?\bbefore\b[^.;\n]*?\b(?:writ(?:e|ing)|prepar(?:e|ing)|draft(?:ing)?|creat(?:e|ing))\b[^.;\n]*?\b(?:specification|plan)\b/gi,
  ].reduce((value, pattern) => value.replace(pattern, ""), text);
  const stagedApproval = stagedApprovalPatterns.some(pattern => pattern.test(stagedApprovalText));
  if (oldGateHeading.test(text) || stagedApproval) {
    errors.push(`${name}: contradictory staged approval instructions`);
  }
  const unsafeEarlyWritePatterns = [
    /(?:create|reuse|publish|update)[^.\n]*(?:issue|managed comments?)[^.\n]*before (?:the )?(?:unified |explicit |user )*approval/i,
    /before (?:the )?(?:unified |explicit |user )*approval[^.\n]*(?:create|reuse|publish|update)[^.\n]*(?:issue|managed comments?)/i,
    /(?:issues?|managed comments?)[^.\n]*(?:may|must|should|can|will)\s+be\s+(?:created|reused|published|updated)[^.\n]*before (?:the )?(?:unified |explicit |user )*approval/i,
    /before (?:the )?(?:unified |explicit |user )*approval[^.\n]*(?:issues?|managed comments?)[^.\n]*(?:may|must|should|can|will)\s+be\s+(?:created|reused|published|updated)/i,
  ];
  const unsafeEarlyWriteText = [
    /\b(?:never|do not|must not|may not|cannot|can't)\b[^.;\n]*?\b(?:create|reuse|publish|update)\b[^.;\n]*?\b(?:issues?|managed comments?)\b[^.;\n]*?\bbefore\b[^.;\n]*?\bapproval\b/gi,
    /\bbefore\b[^.;\n]*?\bapproval\b[^.;\n]*?\b(?:never|do not|must not|may not|cannot|can't)\b[^.;\n]*?\b(?:create|reuse|publish|update)\b[^.;\n]*?\b(?:issues?|managed comments?)\b/gi,
    /\b(?:issues?|managed comments?)\b[^.;\n]*?\b(?:may|must|should|can|will)\s+not\s+be\s+(?:created|reused|published|updated)\b[^.;\n]*?\bbefore\b[^.;\n]*?\bapproval\b/gi,
    /\bbefore\b[^.;\n]*?\bapproval\b[^.;\n]*?\b(?:issues?|managed comments?)\b[^.;\n]*?\b(?:may|must|should|can|will)\s+not\s+be\s+(?:created|reused|published|updated)\b/gi,
  ].reduce((value, pattern) => value.replace(pattern, ""), text);
  const unsafeEarlyWrite = unsafeEarlyWritePatterns.some(pattern => pattern.test(unsafeEarlyWriteText));
  if (unsafeEarlyWrite) {
    errors.push(`${name}: unsafe pre-approval remote-write instructions`);
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

export function validateAuditAuthorizationInstructions(content: Map<string, string>): string[] {
  const policy = section((content.get("prs-finish") ?? "").replace(/\r\n/g, "\n"), "Audit publication authorization", 2);
  const required = [
    "explicit user request for issue implementation",
    "`--jdi`, `--auto` or `--unattended`",
    "routine completion and token-usage audits",
    "originating user request, execution mode and issue/PR targets",
    "Do not ask for another approval for those audits.",
    "Without that authorization, show the exact reports and obtain explicit user approval before publication.",
    "A later user instruction to withhold publication overrides the earlier authorization.",
    "A readiness-tool flag alone does not grant audit publication authorization.",
    "This authorization does not cover issue creation, specification or plan publication, discussion comments, PR reviews, merging or destructive cleanup.",
  ];
  const errors = required.every(instruction => policy.includes(instruction))
    ? [] : ["prs-finish: missing audit publication authorization instructions"];
  for (const name of ["prs", "prs-issue", "prs-pr"]) {
    if (!content.get(name)?.includes("audit publication authorization in `prs-finish`")) {
      errors.push(`${name}: missing audit authorization handoff`);
    }
  }
  for (const name of ["prs-finish", "prs-issue", "prs-pr"]) {
    if (/Obtain explicit user approval before publishing the reviewed (?:Markdown|content|audit) with/.test(content.get(name) ?? "")) {
      errors.push(`${name}: contradictory audit approval instructions`);
    }
  }
  return errors;
}

export function validateGitHubCredentialAccessInstructions(content: string | undefined): string[] {
  const recovery = section(
    (content ?? "").replace(/\r\n/g, "\n"),
    "GitHub credential-store recovery",
    2
  );
  const requirements = [
    /`forge\.githubAccount`[\s\S]*honor that account[\s\S]*without switching the global GitHub account[\s\S]*falling back to another account or an inherited token/i,
    /Never run `gh auth switch`/i,
    /`retry-with-credential-store-access`[\s\S]*retry the exact PRS command through the active host's normal permission mechanism/i,
    /PRS must not elevate itself or invoke a host-specific permission mechanism/i,
    /Preserve unchanged approval, artifact paths, targets and known issue numbers across the permission-only retry/i,
    /log in or refresh credentials only after an unrestricted retry still reports missing or rejected credentials/i,
    /Never print or capture token values, authentication headers, subprocess stderr, credential paths or inherited token variables in diagnostic output/i,
  ];
  return requirements.every(requirement => requirement.test(recovery))
    ? []
    : ["prs: missing GitHub credential-store recovery instructions"];
}
