import type { MondayIssueTracker } from "./monday-issue-tracker";
import type { IssueListToolResult } from "./issue-list-tool";
import type { IssuePullRequestLinks } from "./issue-pr-links";
import { createIssuePullRequestLinks } from "./issue-pr-links";
import { filterActionableIssuesForUser, type ActionableIssue } from "./actionable-github";
import { ISSUE_PLAN_COMMENT_MARKER } from "@prs/contracts";
import { mondayNumber, columnJson } from "./monday-items";
import { mondaySettings } from "./monday-values";
export async function listMondayIssues(tracker: MondayIssueTracker, options: {
    actionable: boolean;
}, suppliedLinks?: IssuePullRequestLinks): Promise<IssueListToolResult> {
    if (!tracker.isAuthenticated())
        return { status: 'blocked', reason: 'monday-auth-required', message: 'Set the configured Monday token environment variable.', nextAction: 'configure-monday-token' };
    try {
        const me = await tracker.me();
        const items = await tracker.store.listItems();
        const issues: ActionableIssue[] = [];
        let unavailable: {
            status: 'unavailable';
            reason: string;
        } | undefined;
        const links = suppliedLinks ?? createIssuePullRequestLinks(tracker.repoRoot, tracker.config);
        for (const item of items) {
            if (tracker.store.isDone(item))
                continue;
            let ancestor = item;
            while (ancestor.parent_item?.id)
                ancestor = await tracker.store.getItem(mondayNumber(ancestor.parent_item.id));
            if (tracker.store.isDone(ancestor))
                continue;
            const number = mondayNumber(item.id);
            const mapping = tracker.store.monday.workflow?.[item.board.id];
            const people = columnJson(item.column_values.find(c => c.id === mapping?.peopleColumnId)).personsAndTeams;
            const column = item.column_values.find(c => c.id === mapping?.labelsColumnId);
            const raw = columnJson(column);
            let labels = Array.isArray(raw.labels) ? raw.labels.map(String) : [];
            if (Array.isArray(raw.ids) && mapping?.labelsColumnId) {
                const board = await tracker.store.getBoard(item.board.id);
                const settings = board.columns.find(c => c.id === mapping.labelsColumnId);
                if (settings) {
                    const options = mondaySettings(settings).labels as Array<{
                        id: number;
                        name: string;
                    }>;
                    labels = options.filter(o => (raw.ids as unknown[]).map(String).includes(String(o.id))).map(o => o.name);
                }
            }
            const result = await links.findLinkedPullRequests(await tracker.getIssueReference(number));
            if (result.status === 'unavailable')
                unavailable = result;
            issues.push({ number, title: item.name, url: item.url, author: item.creator_id ?? item.creator?.id ?? '', assignees: Array.isArray(people) ? people.filter(p => p.kind === 'person').map(p => String(p.id)) : [], labels, updatedAt: item.updated_at ?? item.created_at ?? '', hasPrsPlan: (await tracker.fetchIssueComments(number)).some(c => c.body.startsWith(ISSUE_PLAN_COMMENT_MARKER)), hasLinkedOpenPullRequest: result.status === 'available' && result.pullRequests.some(p => p.state === 'open') });
        }
        if (tracker.config.forge.type === 'none')
            unavailable = { status: 'unavailable', reason: 'forge-disabled' };
        if (options.actionable && unavailable)
            return { status: 'blocked', reason: 'issue-pr-links-unavailable', message: `Cannot select actionable Monday issues without PR evidence: ${unavailable.reason}`, nextAction: 'configure-issue-pr-links' };
        return { status: 'ready', actionable: options.actionable, currentUser: me.id, source: 'monday-api', issues: options.actionable ? filterActionableIssuesForUser(issues, me.id) : issues, linkedPullRequestsStatus: unavailable ?? { status: 'available' } };
    }
    catch {
        return { status: 'blocked', reason: 'monday-request-failed', message: 'Monday issue listing failed; check token permissions, board scope and schema.', nextAction: 'check-monday-configuration' };
    }
}
