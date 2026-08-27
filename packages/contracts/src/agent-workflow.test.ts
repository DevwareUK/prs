import { describe, expect, it } from "vitest";
import {
  AGENT_WORKFLOW_CONTRACT,
  AgentHost,
  AgentSkillManifest,
  ISSUE_LIFECYCLE_PHASES,
  IssueLifecyclePhase,
  SUPPORTED_AGENT_HOSTS,
} from "./agent-workflow";

const validManifest = {
  version: 1,
  skills: [
    {
      name: "prs",
      source: "skills/prs/SKILL.md",
      phases: ["create", "refine", "plan", "implement", "verify", "open-pr", "validate"],
    },
    {
      name: "prs-issue",
      source: "skills/prs-issue/SKILL.md",
      phases: ["refine", "plan", "implement"],
    },
  ],
} as const;

describe("agent workflow contract", () => {
  it("exposes the supported hosts and complete issue lifecycle", () => {
    expect(SUPPORTED_AGENT_HOSTS).toEqual(["codex", "claude-code", "copilot"]);
    expect(ISSUE_LIFECYCLE_PHASES).toEqual([
      "create",
      "refine",
      "plan",
      "implement",
      "verify",
      "open-pr",
      "validate",
    ]);

    for (const host of SUPPORTED_AGENT_HOSTS) {
      expect(AgentHost.parse(host)).toBe(host);
    }
    for (const phase of ISSUE_LIFECYCLE_PHASES) {
      expect(IssueLifecyclePhase.parse(phase)).toBe(phase);
    }
    expect(() => AgentHost.parse("cursor")).toThrow();
    expect(() => IssueLifecyclePhase.parse("review")).toThrow();
  });

  it("accepts a portable manifest whose canonical paths match skill names", () => {
    expect(AgentSkillManifest.parse(validManifest)).toEqual(validManifest);
  });

  it("defines deterministic commands, approval boundaries, artifacts, and capability fallbacks", () => {
    expect(AGENT_WORKFLOW_CONTRACT).toMatchObject({
      version: 1,
      hosts: ["codex", "claude-code", "copilot"],
      phases: ISSUE_LIFECYCLE_PHASES,
      artifacts: {
        runRoot: ".prs/runs",
        specificationMarker: "<!-- prs:issue-spec -->",
        planMarker: "<!-- prs:issue-plan -->",
        auditMarker: "<!-- prs:audit -->",
      },
      capabilityFallbacks: {
        isolation: "continue-in-active-workspace",
        delegation: "execute-sequentially",
      },
    });
    expect(AGENT_WORKFLOW_CONTRACT.commands.map((command) => command.name)).toEqual([
      "issue-create",
      "issue-context",
      "issue-publish-artifacts",
      "issue-ready",
      "issue-finalize",
      "audit-publish",
    ]);
    expect(
      AGENT_WORKFLOW_CONTRACT.commands
        .filter((command) => command.mutatesRemote)
        .every((command) => command.approval === "explicit")
    ).toBe(true);
    expect(
      AGENT_WORKFLOW_CONTRACT.commands.find((command) => command.name === "issue-context")
    ).toMatchObject({ json: true, mutatesRemote: false, approval: "none" });
  });

  it.each([
    {
      name: "a skill without lifecycle phases",
      manifest: {
        ...validManifest,
        skills: [{ name: "prs", source: "skills/prs/SKILL.md", phases: [] }],
      },
    },
    {
      name: "duplicate skill names",
      manifest: {
        ...validManifest,
        skills: [validManifest.skills[0], validManifest.skills[0]],
      },
    },
    {
      name: "an absolute source path",
      manifest: {
        ...validManifest,
        skills: [{ ...validManifest.skills[0], source: "/tmp/prs/SKILL.md" }],
      },
    },
    {
      name: "a host-specific source tree",
      manifest: {
        ...validManifest,
        skills: [{ ...validManifest.skills[0], source: "hosts/codex/prs/SKILL.md" }],
      },
    },
    {
      name: "a canonical path that does not match its skill name",
      manifest: {
        ...validManifest,
        skills: [{ ...validManifest.skills[0], source: "skills/prs-issue/SKILL.md" }],
      },
    },
  ])("rejects $name", ({ manifest }) => {
    expect(() => AgentSkillManifest.parse(manifest)).toThrow();
  });
});
