import { expect, it } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
import { createMondayIssuePullRequestLinks } from "./monday-issue-pr-links";
const repo = { owner: 'DevwareUK', name: 'prs', url: 'https://github.com/DevwareUK/prs' };
const config = resolveRepositoryConfig({ issueTracker: { type: 'monday', monday: { boardId: '10' } } });
const reference = { provider: 'monday', scope: '10', key: '12', url: 'https://example.monday.com/boards/10/pulses/12' };
it("matches exact native marker and URL, retaining merged/closed PR state", async () => {
    const request = async () => new Response(JSON.stringify([
        { number: 1, title: 'Native', html_url: repo.url + '/pull/1', state: 'open', merged_at: null, body: `<!-- prs:issue-ref monday 12 -->\n${reference.url}` },
        { number: 2, title: 'Collision', html_url: repo.url + '/pull/2', state: 'open', merged_at: null, body: `<!-- prs:issue-ref monday 123 -->\n${reference.url}` },
        { number: 3, title: 'Merged', html_url: repo.url + '/pull/3', state: 'closed', merged_at: '2026-10-13T00:00:00Z', body: `<!-- prs:issue-ref monday 12 -->\n${reference.url}` },
    ]));
    const links = createMondayIssuePullRequestLinks('/unused', config, { repository: repo, request });
    expect(await links.findLinkedPullRequests(reference)).toMatchObject({ status: 'available', pullRequests: [{ number: 1, state: 'open' }, { number: 3, state: 'merged' }] });
    expect(links.formatClosingReference(reference)).toBeUndefined();
});
it("never turns failed or malformed PR evidence into an empty available list", async () => {
    const links = createMondayIssuePullRequestLinks('/unused', config, { repository: repo, request: async () => new Response('[]', { status: 403 }) });
    expect(await links.findLinkedPullRequests(reference)).toMatchObject({ status: 'unavailable' });
});
it("includes exact previous native references for a replacement item", async () => {
    const previous = { ...reference, key: '5', url: 'https://example.monday.com/boards/10/pulses/5' };
    const links = createMondayIssuePullRequestLinks('/unused', config, { repository: repo, request: async () => new Response(JSON.stringify([{ number: 9, title: 'History', html_url: repo.url + '/pull/9', state: 'open', merged_at: null, body: `<!-- prs:issue-ref monday 5 -->\n${previous.url}` }])) });
    expect(await links.findLinkedPullRequests({ ...reference, previous: [previous] })).toMatchObject({ status: 'available', pullRequests: [{ number: 9 }] });
});
it('scans later PR pages and rejects repeated pages as incomplete evidence', async () => {
    const first = Array.from({length: 100}, (_, i) => ({number: i + 1, title: 'Unrelated', html_url: `${repo.url}/pull/${i + 1}`, state: 'closed', merged_at: null, body: ''}));
    const last = {number: 101, title: 'Later', html_url: repo.url + '/pull/101', state: 'closed', merged_at: null, body: `<!-- prs:issue-ref monday 12 -->\n${reference.url}`};
    const endpoints: string[] = [];
    const links = createMondayIssuePullRequestLinks('/unused', config, {repository: repo, request: async endpoint => {endpoints.push(endpoint); return new Response(JSON.stringify(endpoints.length === 1 ? first : [last]));}});
    expect(await links.findLinkedPullRequests(reference)).toMatchObject({status: 'available', pullRequests: [{number: 101, state: 'closed'}]});
    expect(endpoints).toHaveLength(2);
    const repeated = createMondayIssuePullRequestLinks('/unused', config, {repository: repo, request: async () => new Response(JSON.stringify(first))});
    expect(await repeated.findLinkedPullRequests(reference)).toMatchObject({status: 'unavailable'});
});
it('bridges only verified source URLs from the configured repository and deduplicates PRs', async () => {
    const pr = {number: 1, title: 'Native', html_url: repo.url + '/pull/1', state: 'open', merged_at: null, body: `<!-- prs:issue-ref monday 12 -->\n${reference.url}`};
    const calls: number[] = [];
    const links = createMondayIssuePullRequestLinks('/unused', config, {repository: repo, request: async () => new Response(JSON.stringify([pr])), legacyLinks: async id => {calls.push(id); return [{number: 1, title: 'Native', url: pr.html_url, state: 'open'}];}});
    expect(await links.findLinkedPullRequests({...reference, sourceUrl: repo.url + '/issues/50'})).toMatchObject({status: 'available', pullRequests: [{number: 1}]});
    expect(calls).toEqual([50]);
    await links.findLinkedPullRequests({...reference, sourceUrl: 'https://github.com/Other/repo/issues/50'});
    expect(calls).toEqual([50]);
});
