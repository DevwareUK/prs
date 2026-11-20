import { expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRepositoryConfig } from "@prs/core";
import { createMondayIssueTracker } from "./monday-issue-tracker";
import { publishIssueArtifactsTool } from "./issue-publish-artifacts-tool";
import { readyIssueTool } from "./issue-ready-tool";
import { contextIssueTool } from "./issue-context-tool";
import { createIssuePullRequestLinks } from "./issue-pr-links";

// Explicit opt-in only. Normal repository tests make no real Monday requests.
const configPath = process.env.PRS_MONDAY_PILOT_CONFIG;
it.skipIf(!configPath)("verifies the explicitly approved disposable FOCAL native write pilot", async () => {
    if (process.env.PRS_MONDAY_PILOT_APPROVED !== "issue-375") throw new Error("Exact-target native pilot approval is required before writes.");
    const config = resolveRepositoryConfig(JSON.parse(readFileSync(configPath!, "utf8")));
    const repoRoot = process.env.PRS_MONDAY_PILOT_REPO;
    const runDir = process.env.PRS_MONDAY_PILOT_RUN;
    if (!repoRoot || !runDir) throw new Error("Supply the approved repository and local run directory.");
    const directory = resolve(runDir);
    if (!directory.startsWith(resolve(process.cwd(), ".prs", "runs") + "/")) throw new Error("Pilot evidence must remain under this repository's .prs/runs directory.");
    mkdirSync(directory, { recursive: true });
    const tracker = createMondayIssueTracker(repoRoot, config, {runDir: directory});
    const links = createIssuePullRequestLinks(repoRoot, config);
    const recordsPath = resolve(directory, "live-identities.json");
    const records: Record<string, number> = existsSync(recordsPath) ? JSON.parse(readFileSync(recordsPath, "utf8")) : {};
    const save = () => writeFileSync(resolve(directory, "live-identities.json"), JSON.stringify(records, null, 2));
    const body = "Disposable PRS #375 native pilot.\n\nLiteral & <Markdown> é 😀\n\n```ts\na < b && c\n```";
    const parent = records.parent ? await tracker.fetchIssueIdentity(records.parent) : await tracker.createOrReuseIssue("[PRS #375 pilot] parent", body, ["prs-pilot"]);
    records.parent = parent.number; save();
    const child = records.child ? await tracker.fetchIssueIdentity(records.child) : await tracker.createOrReuseIssue("[PRS #375 pilot] child", body, ["prs-pilot"], { parentNumber: parent.number });
    records.child = child.number; save();
    const source = records.source ? await tracker.fetchIssueIdentity(records.source) : await tracker.createOrReuseIssue("[PRS #375 pilot] conversion source", body, ["prs-pilot"]);
    records.source = source.number; save();
    const specPath = resolve(directory, "pilot-spec.md"); const planPath = resolve(directory, "pilot-plan.md");
    writeFileSync(specPath, "# Disposable pilot specification\n\nVerify literal & <source> and native provider outcomes.");
    writeFileSync(planPath, "# Disposable pilot plan\n\nRead back, repeat publication, then verify hierarchy and retirement.");
    for (const number of [parent.number, child.number, source.number]) {
        if (number === source.number && records.replacement) continue;
        const input = { issueNumber: number, repoRoot: process.cwd(), specFilePath: specPath, planFilePath: planPath, tracker };
        const first = await publishIssueArtifactsTool(input); const repeated = await publishIssueArtifactsTool(input);
        expect(repeated.managedComments.map(c => c.id)).toEqual(first.managedComments.map(c => c.id));
        expect((await tracker.fetchIssueDetails(number)).body).toBe(body);
        await tracker.createAuditComment({ type: "issue", number }, "<!-- prs:audit -->\n\n# Disposable native validation\n\nVerified & preserved Markdown.");
        expect((await tracker.fetchAuditComment({ type: "issue", number }))?.body).toContain("Verified & preserved");
    }
    const replacement = await tracker.addIssueChild(parent.number, source.number);
    records.replacement = replacement.number; save();
    expect((await tracker.fetchIssueDetails(replacement.number)).body).toBe(body);
    expect((await tracker.fetchIssueParent(replacement.number))?.number).toBe(parent.number);
    expect(await tracker.finalizeIssueReplacement(source.number, replacement.number)).toMatchObject({ status: "verified" });
    expect(await tracker.addIssueChild(parent.number, source.number)).toEqual(replacement);
    for (const number of [parent.number, child.number, replacement.number]) {
        const ready = await readyIssueTool({ issueNumber: number, repoRoot: process.cwd(), tracker });
        expect(ready).toMatchObject({ status: "ready" });
        expect(['updated', 'already-set']).toContain(ready.trackerUpdate?.assignee.status);
        const context = await contextIssueTool({ issueNumber: number, tracker, links });
        expect(context).toMatchObject({ status: "ready", managed: { spec: "present", plan: "present" }, linkedPullRequestsStatus: { status: "available" } });
    }
    expect(await tracker.listIssues({ actionable: false })).toMatchObject({ status: "ready", source: "monday-api" });
    await expect(tracker.updateIssue(source.number, "Never rename retired source", body)).rejects.toThrow("protected");
}, 240000);
