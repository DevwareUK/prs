import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import type { IssueReference } from "./issue-tracker";
import type { IssuePullRequestLinks } from "./issue-pr-links";
import type { RepositoryIdentity, IssueLinkedPullRequest } from "./integration-types";
import { createGitHubClient } from "./github-client";
import { parseGitHubRepoFromRemote, listIssueLinkedPullRequestsForRepoRoot } from "./github-api";
export function createMondayIssuePullRequestLinks(repoRoot: string, config: ResolvedRepositoryConfigType, options: {
    repository?: RepositoryIdentity;
    request?: (endpoint: string) => Promise<{
        ok: boolean;
        json(): Promise<unknown>;
    }>;
    legacyLinks?: (id: number) => Promise<IssueLinkedPullRequest[]>;
} = {}): IssuePullRequestLinks {
    return {
        formatClosingReference: () => undefined,
        async findLinkedPullRequests(issue) {
            if (config.forge.type === 'none')
                return { status: 'unavailable', reason: 'forge-disabled' };
            if (issue.provider !== 'monday' || issue.scope !== config.issueTracker.monday?.boardId || !/^[1-9]\d*$/.test(issue.key))
                return { status: 'unavailable', reason: 'unsupported-issue-reference' };
            try {
                const repository = options.repository ?? (() => { const { owner, repo } = parseGitHubRepoFromRemote(repoRoot); return { owner, name: repo, url: `https://github.com/${owner}/${repo}` }; })();
                const request = options.request ?? createGitHubClient({ repoRoot }).request;
                const references = [issue, ...(issue.previous ?? [])];
                if (references.some(r => !validReference(r, issue)))
                    return { status: 'unavailable', reason: 'invalid-monday-lineage' };
                const found = new Map<string, IssueLinkedPullRequest>();
                const seen = new Set<number>();
                for (let page = 1;; page++) {
                    const response = await request(`repos/${repository.owner}/${repository.name}/pulls?state=all&per_page=100&page=${page}`);
                    if (!response.ok)
                        throw new Error('PR read failed');
                    const payload = await response.json();
                    if (!Array.isArray(payload))
                        throw new Error('Invalid PR page');
                    for (const pr of payload) {
                        if (!pr || !Number.isSafeInteger(pr.number) || pr.number < 1 || typeof pr.body !== 'string' && pr.body !== null || typeof pr.title !== 'string' || !['open', 'closed'].includes(pr.state) || pr.html_url !== `${repository.url}/pull/${pr.number}`)
                            throw new Error('Invalid PR identity');
                        if (seen.has(pr.number))
                            throw new Error('Repeated PR page');
                        seen.add(pr.number);
                        if (references.some(ref => matches(pr.body ?? '', ref)))
                            found.set(pr.html_url, { number: pr.number, title: pr.title, url: pr.html_url, state: pr.state === 'open' ? 'open' : pr.merged_at ? 'merged' : 'closed' });
                    }
                    if (payload.length < 100)
                        break;
                }
                if (issue.sourceUrl) {
                    const match = new RegExp(`^${escapeRegex(repository.url)}/issues/([1-9]\\d*)$`, 'i').exec(issue.sourceUrl);
                    if (match) {
                        const links = await (options.legacyLinks ?? (number => listIssueLinkedPullRequestsForRepoRoot(repoRoot, number)))(Number(match[1]));
                        for (const pr of links)
                            found.set(pr.url, pr);
                    }
                }
                return { status: 'available', pullRequests: [...found.values()] };
            }
            catch {
                return { status: 'unavailable', reason: 'github-pr-evidence-unavailable' };
            }
        }
    };
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function matches(body: string, ref: IssueReference) { return body.includes(`<!-- prs:issue-ref monday ${ref.key} -->`) && new RegExp(`(?:^|[\\s(<])${escapeRegex(ref.url)}(?=$|[\\s)>\\]])`).test(body); }
function validReference(ref: IssueReference, current: IssueReference) { try {
    const url = new URL(ref.url);
    return ref.provider === 'monday' && ref.scope === current.scope && /^[1-9]\d*$/.test(ref.key) && url.protocol === 'https:' && url.hostname === new URL(current.url).hostname && url.hostname.endsWith('.monday.com') && !url.username && !url.password && new RegExp(`^/boards/[1-9]\\d*/pulses/${ref.key}$`).test(url.pathname) && !url.search && !url.hash;
}
catch {
    return false;
} }
