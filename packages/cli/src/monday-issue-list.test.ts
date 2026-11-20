import {expect, it} from 'vitest';
import {resolveRepositoryConfig} from '@prs/core';
import {createMondayIssueTracker} from './monday-issue-tracker';
import {mondayTestApi} from './monday-test-api';
import {listMondayIssues} from './monday-issue-list';

const config = () => resolveRepositoryConfig({issueTracker: {type: 'monday', monday: {boardId: '10', scope: {columnRules: [{columnId: 'epic', operator: 'any_of', compareValue: [3]}]}, workflow: {'10': {peopleColumnId: 'owner', labelsColumnId: 'labels', statusColumnId: 'status', doneLabels: ['Done']}, '11': {statusColumnId: 'status', doneLabels: ['Done']}}}}});
const repository = {owner: 'DevwareUK', name: 'prs', url: 'https://github.com/DevwareUK/prs'};
const noLinks = {findLinkedPullRequests: async () => ({status: 'available' as const, pullRequests: []}), formatClosingReference: () => undefined};
it('uses native user, assignment, label IDs and managed plans to rank actionable tasks', async () => {
    const api = mondayTestApi();
    for (const id of ['1', '2', '4', '5']) {const item = api.item(id, `Task ${id}`); item.creator_id = '8'; api.items.set(id, item);}
    api.items.get('1')!.column_values.push({id: 'owner', text: 'Viewer', value: JSON.stringify({personsAndTeams: [{id: 7, kind: 'person'}]})});
    api.items.get('2')!.column_values.push({id: 'labels', text: 'ready', value: JSON.stringify({ids: [1]})});
    const tracker = createMondayIssueTracker('/unused', config(), {client: api.client, repository});
    await tracker.createIssuePlanComment(4, '<!-- prs:issue-plan -->\n# Plan');
    const result = await listMondayIssues(tracker, {actionable: true}, noLinks);
    expect(result).toMatchObject({status: 'ready', source: 'monday-api', currentUser: '7', issues: [{number: 1}, {number: 4}, {number: 2, labels: ['ready']}]});
});
it('excludes descendants of completed parents and tasks with linked open PRs', async () => {
    const api = mondayTestApi();
    api.items.set('1', api.item('1', 'Done parent'));
    api.items.get('1')!.column_values.push({id: 'status', text: 'Done', value: '{"index":2}'});
    api.items.set('2', api.item('2', 'Child', '11', '1'));
    api.items.set('4', api.item('4', 'Active PR'));
    const tracker = createMondayIssueTracker('/unused', config(), {client: api.client, repository});
    const links = {...noLinks, findLinkedPullRequests: async () => ({status: 'available' as const, pullRequests: [{number: 9, title: 'Active', url: repository.url + '/pull/9', state: 'open' as const}]})};
    expect(await listMondayIssues(tracker, {actionable: true}, links)).toMatchObject({status: 'ready', issues: []});
    expect(await listMondayIssues(tracker, {actionable: false}, links)).toMatchObject({status: 'ready', issues: [{number: 4}]});
});
it('blocks actionable selection when PR evidence is unavailable but reports ordinary listing evidence', async () => {
    const api = mondayTestApi(); api.items.set('1', api.item('1'));
    const tracker = createMondayIssueTracker('/unused', config(), {client: api.client, repository});
    const links = {...noLinks, findLinkedPullRequests: async () => ({status: 'unavailable' as const, reason: 'permission-denied'})};
    expect(await listMondayIssues(tracker, {actionable: true}, links)).toMatchObject({status: 'blocked', reason: 'issue-pr-links-unavailable'});
    expect(await listMondayIssues(tracker, {actionable: false}, links)).toMatchObject({status: 'ready', linkedPullRequestsStatus: {status: 'unavailable'}, issues: [{number: 1}]});
});
