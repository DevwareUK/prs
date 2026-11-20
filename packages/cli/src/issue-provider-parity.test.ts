import { beforeEach, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRepositoryConfig } from "@prs/core";
import { createGitHubIssueTracker } from "./github-issue-tracker";
import { createMondayIssueTracker } from "./monday-issue-tracker";
import { mondayTestApi } from "./monday-test-api";
import { publishIssueArtifactsTool } from "./issue-publish-artifacts-tool";
import { contextIssueTool } from "./issue-context-tool";
import { readyIssueTool } from "./issue-ready-tool";
import type { IssueTracker } from "./issue-tracker";
vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));
const repo = { owner: 'DevwareUK', name: 'prs', url: 'https://github.com/DevwareUK/prs' };
const links = { findLinkedPullRequests: async () => ({ status: 'available' as const, pullRequests: [] }), formatClosingReference: () => undefined };
beforeEach(() => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    const issues = new Map<number, {
        number: number;
        id: number;
        title: string;
        body: string;
        html_url: string;
        assignees: {
            login: string;
        }[];
        labels: {
            name: string;
        }[];
    }>();
    const comments = new Map<number, Array<{
        id: number;
        body: string;
        html_url: string;
        created_at: string;
        updated_at: string;
        user: {
            login: string;
            type: string;
        };
    }>>();
    const parents = new Map<number, number>();
    let seq = 10;
    vi.mocked(execFileSync).mockImplementation((command, args, options) => {
        if (command === 'git')
            return 'git@github.com:DevwareUK/prs.git';
        if (args?.[0] === 'auth')
            return 'fixture-token';
        const endpoint = String(args?.[1]);
        const input = (options as {
            input?: string;
        }).input;
        const body = input ? JSON.parse(input) : undefined;
        let payload: unknown;
        let status = 200;
        if (endpoint === 'user')
            payload = { login: 'work' };
        else if (endpoint.includes('/issue-fields'))
            payload = [];
        else if (endpoint.includes('?state=open'))
            payload = [...issues.values()];
        else if (endpoint === 'repos/DevwareUK/prs/issues' && body) {
            const n = ++seq;
            const issue = { number: n, id: n + 1000, title: body.title, body: body.body, html_url: repo.url + '/issues/' + n, assignees: [], labels: (body.labels ?? []).map((name: string) => ({ name })) };
            issues.set(n, issue);
            payload = issue;
        }
        else if (/\/issues\/comments\/\d+$/.test(endpoint)) {
            const id = Number(endpoint.split('/').at(-1));
            const comment = [...comments.values()].flat().find(c => c.id === id)!;
            comment.body = body.body;
            payload = comment;
        }
        else {
            const match = /\/issues\/(\d+)(.*)/.exec(endpoint);
            if (!match)
                throw new Error('Unexpected Github fixture endpoint');
            const n = Number(match[1]);
            const tail = match[2];
            if (tail.startsWith('/comments')) {
                if (body) {
                    const id = ++seq;
                    const comment = { id, body: body.body, html_url: repo.url + '/issues/' + n + '#issuecomment-' + id, created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', user: { login: 'work', type: 'User' } };
                    comments.set(n, [...(comments.get(n) ?? []), comment]);
                    payload = comment;
                }
                else
                    payload = comments.get(n) ?? [];
            }
            else if (tail === '/parent') {
                payload = parents.has(n) ? issues.get(parents.get(n)!) : {};
                if (!parents.has(n))
                    status = 404;
            }
            else if (tail.startsWith('/sub_issues')) {
                if (body) {
                    const child = [...issues.values()].find(i => i.id === body.sub_issue_id)!;
                    parents.set(child.number, n);
                    payload = child;
                }
                else
                    payload = [...issues.values()].filter(i => parents.get(i.number) === n);
            }
            else if (tail === '/assignees') {
                issues.get(n)!.assignees = body.assignees.map((login: string) => ({ login }));
                payload = issues.get(n);
            }
            else {
                if (body)
                    Object.assign(issues.get(n)!, body);
                payload = issues.get(n);
            }
        }
        return `HTTP/2.0 ${status} OK\r\n\r\n${JSON.stringify(payload)}`;
    });
});
it.each(['github', 'monday'] as const)('runs the same create/context/refine/audit/hierarchy/readiness contract with %s', async (type) => {
    const root = mkdtempSync(join(tmpdir(), 'prs-provider-contract-'));
    let tracker: IssueTracker;
    if (type === 'github')
        tracker = createGitHubIssueTracker(root, resolveRepositoryConfig());
    else {
        const api = mondayTestApi();
        tracker = createMondayIssueTracker(root, resolveRepositoryConfig({ issueTracker: { type: 'monday', defaults: { groupId: 'ready', columnValues: { epic: { item_ids: ['3'] } } }, monday: { boardId: '10', scope: { columnRules: [{ columnId: 'epic', operator: 'any_of', compareValue: [3] }] }, defaultsByBoard: { '11': { columnValues: {} } }, workflow: { '10': { peopleColumnId: 'owner', statusColumnId: 'status', inProgressLabel: 'In Progress', labelsColumnId: 'labels' }, '11': { peopleColumnId: 'owner', statusColumnId: 'status', inProgressLabel: 'In Progress', labelsColumnId: 'labels' } } } } }), { client: api.client, repository: repo, links });
    }
    const parent = await tracker.createOrReuseIssue('Parent', 'Request & code', []);
    const reused = await tracker.createOrReuseIssue(' Parent ', 'Changed request', []);
    expect(reused.number).toBe(parent.number);
    expect((await tracker.fetchIssueDetails(parent.number)).body).toBe('Request & code');
    const child = await tracker.createOrReuseIssue('Child', 'Child request', [], { parentNumber: parent.number });
    await tracker.addIssueChild(parent.number, (await tracker.fetchIssueIdentity(child.number)).id);
    expect((await tracker.fetchIssueParent(child.number))?.number).toBe(parent.number);
    expect((await tracker.fetchIssueChildren(parent.number)).map(c => c.number)).toContain(child.number);
    writeFileSync(join(root, 'spec.md'), '# Spec\n\nLiteral & <source>');
    writeFileSync(join(root, 'plan.md'), '# Plan\n\nSteps');
    const args = { issueNumber: child.number, repoRoot: root, specFilePath: 'spec.md', planFilePath: 'plan.md', tracker };
    const first = await publishIssueArtifactsTool(args);
    const second = await publishIssueArtifactsTool(args);
    expect(second.managedComments.map(c => c.id)).toEqual(first.managedComments.map(c => c.id));
    const context = await contextIssueTool({ issueNumber: child.number, tracker, links });
    expect(context).toMatchObject({ status: 'ready', managed: { spec: 'present', plan: 'present' }, linkedPullRequestsStatus: { status: 'available' }, hierarchy: { parent: { number: parent.number } } });
    await tracker.createAuditComment({ type: 'issue', number: child.number }, '<!-- prs:audit -->\n\nCompletion');
    expect((await tracker.fetchAuditComment({ type: 'issue', number: child.number }))?.body).toContain('Completion');
    const ready = await readyIssueTool({ issueNumber: child.number, repoRoot: root, tracker });
    expect(ready).toMatchObject({ status: 'ready', trackerUpdate: { assignee: { status: 'updated' } } });
    if (type === 'monday')
        expect(ready).not.toHaveProperty('githubUpdate');
});
