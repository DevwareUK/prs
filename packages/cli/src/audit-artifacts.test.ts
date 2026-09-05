import { describe, expect, it } from "vitest";
import { UNATTENDED_GITHUB_OUTPUT_NOTE } from "@prs/contracts";
import { makeUsageFixture } from "./token-usage.test-support";
import { normalizeUsageEvidence } from "./token-usage-normalize";
import { aggregateUsageEvents } from "./token-usage-aggregate";
import { priceUsage } from "./token-usage-pricing";
import { renderUsageMarkdown } from "./token-usage-render";
import type { AuditTarget, RepositoryForge, RepositoryComment } from "./forge";
import {
  AUDIT_COMMENT_MARKER,
  publishAuditArtifact,
  renderAuditCommentBody,
} from "./audit-artifacts";

function comment(body: string): RepositoryComment {
  return {
    id: 7,
    body,
    url: "https://github.test/comment/7",
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z",
    author: "prs[bot]",
    isBot: true,
  };
}

describe("audit artifacts", () => {
  it.each(["issue", "pr"] as const)("upserts fixture-rendered usage for a %s without duplicating sections", async type => {
    const ledger = normalizeUsageEvidence(makeUsageFixture("baseline-review"));
    const totals = aggregateUsageEvents(ledger.events);
    const content = renderUsageMarkdown(ledger, totals, priceUsage(totals, []));
    let saved: RepositoryComment | undefined;
    const forge = {
      type: "github", isAuthenticated: () => true,
      fetchAuditComment: async () => saved,
      createAuditComment: async (_target: AuditTarget, body: string) => { saved = comment(body); return saved; },
      updateIssueComment: async (_id: number, body: string) => { saved = comment(body); return saved; },
    } as unknown as RepositoryForge;
    const input = { target: { type: type === "pr" ? "pull-request" : "issue", number: 350 } as AuditTarget, sectionName: "token-usage", content };
    expect((await publishAuditArtifact(forge, input)).status).toBe("created");
    await publishAuditArtifact(forge, { ...input, sectionName: "checks", content: "Keep this check evidence." });
    expect((await publishAuditArtifact(forge, input)).status).toBe("updated");
    expect(saved!.body.match(/<!-- prs:audit:token-usage:start -->/g)).toHaveLength(1);
    expect(saved!.body).toContain("Model-token known total: 160");
    expect(saved!.body).toContain("Keep this check evidence.");
  });
  it("renders a managed audit comment with a stable marker and section", () => {
    const body = renderAuditCommentBody({
      title: "Issue #42 audit",
      sections: [{ name: "Spec", content: "# Spec\n\nApproved." }],
      localRun: ".prs/runs/example",
    });

    expect(body).toContain(AUDIT_COMMENT_MARKER);
    expect(body).toContain("## Spec");
    expect(body).toContain("# Spec\n\nApproved.");
    expect(body).toContain("Local run: `.prs/runs/example`");
    expect(body).not.toContain(UNATTENDED_GITHUB_OUTPUT_NOTE);
  });

  it("renders unattended audit comments with visible automation framing after the marker", () => {
    const body = renderAuditCommentBody({
      title: "Pull request #42 audit",
      sections: [{ name: "Review", content: "Review body" }],
      outputMode: "unattended",
    });

    expect(body).toContain(AUDIT_COMMENT_MARKER);
    expect(body).toContain(UNATTENDED_GITHUB_OUTPUT_NOTE);
    expect(body.indexOf(AUDIT_COMMENT_MARKER)).toBeLessThan(
      body.indexOf(UNATTENDED_GITHUB_OUTPUT_NOTE)
    );
  });

  it("rejects section names without marker-safe alphanumeric content", () => {
    expect(() =>
      renderAuditCommentBody({
        title: "Issue #42 audit",
        sections: [{ name: "!!!", content: "No marker id" }],
      })
    ).toThrow("Audit section name must contain at least one alphanumeric character.");
  });

  it("rejects duplicate normalized section marker IDs in one comment", () => {
    expect(() =>
      renderAuditCommentBody({
        title: "Issue #42 audit",
        sections: [
          { name: "Spec Review", content: "First" },
          { name: "Spec-Review", content: "Second" },
        ],
      })
    ).toThrow('Duplicate audit section marker ID "spec-review".');
  });

  it("creates a new issue audit comment when none exists", async () => {
    const calls: string[] = [];
    const forge = {
      type: "github",
      isAuthenticated: () => true,
      fetchAuditComment: async () => undefined,
      createAuditComment: async (_target: AuditTarget, body: string) => {
        calls.push(body);
        return comment(body);
      },
    } as unknown as RepositoryForge;

    const result = await publishAuditArtifact(forge, {
      target: { type: "issue", number: 42 },
      sectionName: "Plan",
      content: "Plan body",
      localRun: ".prs/runs/example",
    });

    expect(result.status).toBe("created");
    expect(calls[0]).toContain("## Plan");
  });

  it("updates an existing issue audit comment by replacing the named section and local run", async () => {
    const existing = renderAuditCommentBody({
      title: "Issue #42 audit",
      sections: [{ name: "Plan", content: "Old plan" }],
      localRun: ".prs/runs/old",
    });
    let updatedBody = "";
    const forge = {
      type: "github",
      isAuthenticated: () => true,
      fetchAuditComment: async () => comment(existing),
      updateIssueComment: async (_commentId: number, body: string) => {
        updatedBody = body;
        return comment(body);
      },
    } as unknown as RepositoryForge;

    const result = await publishAuditArtifact(forge, {
      target: { type: "issue", number: 42 },
      sectionName: "Plan",
      content: "New plan",
      localRun: ".prs/runs/new",
    });

    expect(result.status).toBe("updated");
    expect(updatedBody).toContain("New plan");
    expect(updatedBody).not.toContain("Old plan");
    expect(updatedBody).toContain("Local run: `.prs/runs/new`");
    expect(updatedBody).not.toContain("Local run: `.prs/runs/old`");
  });

  it("removes unattended framing when updating in manual mode", async () => {
    const existing = renderAuditCommentBody({
      title: "Issue #42 audit",
      sections: [{ name: "Plan", content: "Old plan" }],
      outputMode: "unattended",
    });
    let updatedBody = "";
    const forge = {
      type: "github",
      isAuthenticated: () => true,
      fetchAuditComment: async () => comment(existing),
      updateIssueComment: async (_commentId: number, body: string) => {
        updatedBody = body;
        return comment(body);
      },
    } as unknown as RepositoryForge;

    await publishAuditArtifact(forge, {
      target: { type: "issue", number: 42 },
      sectionName: "Plan",
      content: "New plan",
    });

    expect(updatedBody).toContain("New plan");
    expect(updatedBody).not.toContain(UNATTENDED_GITHUB_OUTPUT_NOTE);
  });
});
