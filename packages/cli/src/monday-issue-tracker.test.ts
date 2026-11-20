import { expect, it } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
import { createMondayIssueTracker } from "./monday-issue-tracker";
import { mondayTestApi } from "./monday-test-api";
import { publishIssueArtifactsTool } from "./issue-publish-artifacts-tool";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const testConfig = () => resolveRepositoryConfig({ issueTracker: { type: 'monday', defaults: { groupId: 'ready', columnValues: { epic: { item_ids: ['3'] } } }, monday: { boardId: '10', scope: { columnRules: [{ columnId: 'epic', operator: 'any_of', compareValue: [3] }] }, defaultsByBoard: { '11': { columnValues: {} } }, workflow: { '10': { statusColumnId: 'status', peopleColumnId: 'owner', inProgressLabel: 'In Progress', doneLabels: ['Done', 'No Longer Needed'], closedLabel: 'No Longer Needed', labelsColumnId: 'labels' }, '11': { statusColumnId: 'status', peopleColumnId: 'owner', inProgressLabel: 'In Progress', doneLabels: ['Done'], labelsColumnId: 'labels', migrationSourceColumnId: 'migration' } } } } });
const noLinks = { findLinkedPullRequests: async () => ({ status: 'available' as const, pullRequests: [] }), formatClosingReference: () => undefined };
const repo = { owner: 'DevwareUK', name: 'prs', url: 'https://github.com/DevwareUK/prs' };
it("creates defaults/labels, preserves Markdown and edits the same managed update", async () => {
    const api = mondayTestApi();
    const tracker = createMondayIssueTracker('/unused', testConfig(), { client: api.client, repository: repo, links: noLinks });
    const issue = await tracker.createOrReuseIssue('New', 'Original & <body>\n\n```ts\nx\n```', ['with spaces']);
    expect(api.items.get(String(issue.number))?.column_values.find(c => c.id === 'epic')?.linked_item_ids).toEqual(['3']);
    expect(await tracker.fetchIssueDetails(issue.number)).toMatchObject({ body: 'Original & <body>\n\n```ts\nx\n```' });
    const root = mkdtempSync(join(tmpdir(), 'prs-monday-'));
    writeFileSync(join(root, 'spec.md'), '# Spec\n\nA & B');
    writeFileSync(join(root, 'plan.md'), '# Plan');
    const args = { issueNumber: issue.number, repoRoot: root, specFilePath: 'spec.md', planFilePath: 'plan.md', tracker };
    const one = await publishIssueArtifactsTool(args);
    const two = await publishIssueArtifactsTool(args);
    expect(two.managedComments.map(c => c.id)).toEqual(one.managedComments.map(c => c.id));
    expect(await tracker.fetchIssueComments(issue.number)).toHaveLength(3);
    expect((await tracker.startIssueWork(issue.number)).assignee.status).toBe('updated');
    expect((await tracker.startIssueWork(issue.number)).assignee.status).toBe('already-set');
});
it("creates native children without sending parent Epic columns to their board", async () => {
    const api = mondayTestApi();
    api.items.set('1', api.item('1', 'Parent'));
    const tracker = createMondayIssueTracker('/unused', testConfig(), { client: api.client, repository: repo, links: noLinks });
    const child = await tracker.createOrReuseIssue('Child', 'Request', [], { parentNumber: 1 });
    expect(await tracker.fetchIssueParent(child.number)).toMatchObject({ number: 1 });
    expect(api.items.get(String(child.number))?.column_values.some(c => c.id === 'epic')).toBe(false);
    expect(await tracker.fetchIssueChildren(1)).toEqual([await tracker.fetchIssueIdentity(child.number)]);
});
it("keeps original open until replacement is verified and final retirement is requested", async () => {
    const api = mondayTestApi();
    api.items.set('1', api.item('1', 'Parent'));
    api.items.set('2', api.item('2', 'Existing'));
    const tracker = createMondayIssueTracker('/unused', testConfig(), { client: api.client, repository: repo, links: noLinks });
    await tracker.updateIssue(2, 'Existing', 'Request');
    const replacement = await tracker.addIssueChild(1, 2);
    expect(replacement).toBeTruthy();
    expect(api.items.get('2')?.column_values.find(c => c.id === 'status')).toBeUndefined();
    expect(await tracker.fetchIssueDetails(replacement!.number)).toMatchObject({ body: 'Request' });
    expect(await tracker.addIssueChild(1, 2)).toEqual(replacement);
    await tracker.createIssuePlanComment(replacement!.number, '<!-- prs:issue-spec -->\n# Spec');
    await tracker.createIssuePlanComment(replacement!.number, '<!-- prs:issue-plan -->\n# Plan');
    expect(await tracker.finalizeIssueReplacement!(2, replacement!.number)).toMatchObject({ status: 'verified' });
    expect(api.items.get('2')?.column_values.find(c => c.id === 'status')?.text).toBe('No Longer Needed');
});
it("blocks unknown defaults and foreign-owned artifacts before writes", async () => {
    const api = mondayTestApi();
    const config = testConfig();
    config.issueTracker.defaults = { columnValues: { missing: 'x' } };
    const tracker = createMondayIssueTracker('/unused', config, { client: api.client, repository: repo, links: noLinks });
    await expect(tracker.createOrReuseIssue('Bad', 'Request', [])).rejects.toThrow('column');
    expect(api.mutations).toHaveLength(0);
});
it("propagates replacement identity through the shared hierarchy workflow", async () => {
    const api = mondayTestApi();
    api.items.set('1', api.item('1', 'Parent'));
    api.items.set('2', api.item('2', 'Existing'));
    const tracker = createMondayIssueTracker('/unused', testConfig(), { client: api.client, repository: repo, links: noLinks });
    const { ensureIssueHierarchy } = await import('./workflows/issue/hierarchy');
    const issues = [{ id: 'parent', number: 1, title: 'Parent', url: api.items.get('1')!.url, status: 'existing' as const }, { id: 'child', number: 2, title: 'Existing', url: api.items.get('2')!.url, status: 'existing' as const }];
    const issueSet = { mode: 'multiple' as const, orchestration: { mode: 'parent' as const, orchestratorId: 'parent' }, issues: [{ id: 'parent', title: 'Parent', body: '', draftFilePath: '', specFilePath: '', planFilePath: '', specMarkdown: '# Spec', planMarkdown: '# Plan', dependsOn: [], blocks: [], related: [] }, { id: 'child', parentId: 'parent', title: 'Existing', body: '', draftFilePath: '', specFilePath: '', planFilePath: '', specMarkdown: '# Spec', planMarkdown: '# Plan', dependsOn: [], blocks: [], related: [] }] };
    const result = await ensureIssueHierarchy({ tracker, issueSet, issues });
    expect(result.relationships[0].status).toBe('verified');
    expect(issues[1].number).not.toBe(2);
    expect(api.items.get('2')?.column_values.find(c => c.id === 'status')).toBeUndefined();
});
it("does not edit foreign managed updates or write to completed items", async () => {
    const api = mondayTestApi();
    api.items.set('1', api.item('1', 'Task'));
    api.updates.set('1', [{ id: '40', body: '<p>&lt;!-- prs:issue-plan --&gt;<br />Old</p>', creator_id: '8', created_at: '2026-10-13T00:00:00Z' }]);
    const tracker = createMondayIssueTracker('/unused', testConfig(), { client: api.client, repository: repo, links: noLinks });
    await expect(tracker.createIssuePlanComment(1, '<!-- prs:issue-plan -->\nNew')).rejects.toThrow('another user');
    expect(api.mutations).toHaveLength(0);
    api.items.get('1')!.column_values.push({ id: 'status', text: 'Done', value: '{"index":2}' });
    await expect(tracker.updateIssue(1, 'Task', 'Request')).rejects.toThrow('protected');
    expect(api.mutations).toHaveLength(0);
});
it("recovers a replacement created before its body write failed", async () => {
    const api = mondayTestApi();
    api.items.set('1', api.item('1', 'Parent'));
    api.items.set('2', api.item('2', 'Existing'));
    const tracker = createMondayIssueTracker('/unused', testConfig(), { client: api.client, repository: repo, links: noLinks });
    await tracker.updateIssue(2, 'Existing', 'Important request');
    api.fail('CreateUpdate');
    await expect(tracker.addIssueChild(1, 2)).rejects.toThrow();
    expect([...api.items.values()].filter(i => i.parent_item?.id === '1')).toHaveLength(1);
    api.fail('');
    const replacement = await tracker.addIssueChild(1, 2);
    expect(await tracker.fetchIssueDetails(replacement.number)).toMatchObject({ body: 'Important request' });
    expect([...api.items.values()].filter(i => i.parent_item?.id === '1')).toHaveLength(1);
});
it("preflights an entire linked set before creating a parent when child defaults are invalid", async () => {
    const api = mondayTestApi();
    const config = testConfig();
    config.issueTracker.monday!.defaultsByBoard!['11'] = { columnValues: { missing: 'bad' } };
    const tracker = createMondayIssueTracker('/unused', config, { client: api.client, repository: repo, links: noLinks });
    const { createIssueDraftSetWithRecords } = await import('./workflows/issue/create-set');
    const issueSet = { mode: 'multiple' as const, orchestration: { mode: 'parent' as const, orchestratorId: 'p' }, issues: [{ id: 'p', title: 'Parent', body: 'Request', draftFilePath: '', specFilePath: '', planFilePath: '', specMarkdown: '# Spec', planMarkdown: '# Plan', dependsOn: [], blocks: [], related: [] }, { id: 'c', parentId: 'p', title: 'Child', body: 'Request', draftFilePath: '', specFilePath: '', planFilePath: '', specMarkdown: '# Spec', planMarkdown: '# Plan', dependsOn: [], blocks: [], related: [] }] };
    await expect(createIssueDraftSetWithRecords({ issueSet, tracker, labels: [], forcePrsManaged: false })).rejects.toThrow('column');
    expect(api.mutations).toHaveLength(0);
});
it("copies mapped owner/status/label fields across different parent and subitem schemas", async () => {
    const api = mondayTestApi();
    api.items.set('1', api.item('1', 'Parent'));
    const source = api.item('2', 'Existing');
    source.column_values.push({ id: 'owner', type: 'people', text: 'Viewer', value: '{"personsAndTeams":[{"id":7,"kind":"person"}]}' }, { id: 'labels', type: 'dropdown', text: 'with spaces', value: '{"ids":[2]}' }, { id: 'status', type: 'status', text: 'In Progress', value: '{"index":1}' });
    api.items.set('2', source);
    const config = testConfig();
    config.issueTracker.monday!.workflow!['11'] = { ...config.issueTracker.monday!.workflow!['11'], peopleColumnId: 'person', statusColumnId: 'child_status', labelsColumnId: 'child_labels' };
    const childBoard = api.boards.find(b => b.id === '11')!;
    childBoard.columns = childBoard.columns.map(c => ({ ...c, id: c.id === 'owner' ? 'person' : c.id === 'status' ? 'child_status' : c.id === 'labels' ? 'child_labels' : c.id }));
    const tracker = createMondayIssueTracker('/unused', config, { client: api.client, repository: repo, links: noLinks });
    const replacement = await tracker.addIssueChild(1, 2);
    const child = api.items.get(String(replacement.number))!;
    expect(child.column_values.find(c => c.id === 'person')?.value).toBe('{"personsAndTeams":[{"id":7,"kind":"person"}]}');
    expect(child.column_values.find(c => c.id === 'child_status')?.text).toBe('In Progress');
    expect(child.column_values.find(c => c.id === 'child_labels')?.text).toBe('with spaces');
});
it("cannot rename a request owned by another account before detecting its body conflict", async () => {
    const api = mondayTestApi();
    api.items.set('1', api.item('1', 'Original'));
    api.updates.set('1', [{ id: '40', body: '<p>&lt;!-- prs:managed-issue --&gt;<br /><br />Original</p>', creator_id: '8', created_at: '2026-10-13T00:00:00Z' }]);
    const tracker = createMondayIssueTracker('/unused', testConfig(), { client: api.client, repository: repo, links: noLinks });
    await expect(tracker.updateIssue(1, 'Renamed', 'Request')).rejects.toThrow('another user');
    expect(api.items.get('1')!.name).toBe('Original');
    expect(api.mutations).toHaveLength(0);
});

it("refuses original retirement until both replacement refinement artifacts exist", async () => {
    const api = mondayTestApi(); api.items.set('1', api.item('1', 'Parent')); api.items.set('2', api.item('2', 'Existing'));
    const tracker = createMondayIssueTracker('/unused', testConfig(), { client: api.client, repository: repo, links: noLinks });
    const replacement = await tracker.addIssueChild(1, 2);
    expect(await tracker.finalizeIssueReplacement(2, replacement.number)).toMatchObject({ status: 'incomplete' });
    expect(api.items.get('2')!.column_values.find(c => c.id === 'status')).toBeUndefined();
});

it("unions Monday default and explicit labels", async () => {
 const api=mondayTestApi();const config=testConfig();config.issueTracker.defaults={groupId:'ready',columnValues:{epic:{item_ids:['3']},labels:{labels:['ready']}}};
 const tracker=createMondayIssueTracker('/unused',config,{client:api.client,repository:repo,links:noLinks});const issue=await tracker.createOrReuseIssue('Labels','Request',['with spaces']);
 expect(api.items.get(String(issue.number))!.column_values.find(c=>c.id==='labels')?.text).toBe('ready, with spaces');
});
it("rejects silently dropped creation metadata instead of reporting created", async () => {
 const api=mondayTestApi();const config=testConfig();config.issueTracker.defaults={columnValues:{epic:{item_ids:['3']},owner:{personsAndTeams:[{id:7,kind:'person'}]}}};
 const client={request:async<T>(query:string,variables:Record<string,unknown>)=>{const result=await api.client.request<T>(query,variables);if(query.includes('mutation CreateItem'))for(const item of api.items.values())if(item.name==='Dropped')item.column_values=item.column_values.filter(c=>c.id!=='owner');return result;}};
 const tracker=createMondayIssueTracker('/unused',config,{client,repository:repo,links:noLinks});await expect(tracker.createOrReuseIssue('Dropped','Request',[])).rejects.toThrow('verification');
});
it("preserves native board relation metadata whose read value is null",async()=>{
 const api=mondayTestApi();for(const board of api.boards.filter(b=>['10','11'].includes(b.id)))board.columns.push({id:'related',title:'Related',type:'board_relation',settings_str:'{"boardIds":[30]}'});
 api.items.set('1',api.item('1','Parent'));const source=api.item('2','Existing');source.column_values.push({id:'related',type:'board_relation',value:null,linked_item_ids:['3'],text:'FOCAL'});api.items.set('2',source);
 const tracker=createMondayIssueTracker('/unused',testConfig(),{client:api.client,repository:repo,links:noLinks});const replacement=await tracker.addIssueChild(1,2);expect(api.items.get(String(replacement.number))!.column_values.find(c=>c.id==='related')?.linked_item_ids).toEqual(['3']);
});
it("does not abandon source descendants when conversion topology cannot be preserved",async()=>{
 const api=mondayTestApi();api.items.set('1',api.item('1','Parent'));api.items.set('2',api.item('2','Source'));api.items.set('4',api.item('4','Existing descendant','11','2'));
 const tracker=createMondayIssueTracker('/unused',testConfig(),{client:api.client,repository:repo,links:noLinks});await expect(tracker.addIssueChild(1,2)).rejects.toThrow('descendant');expect(api.mutations).toHaveLength(0);
});
it("repairs its own partial creation without replacing a legitimate existing issue body",async()=>{
 const api=mondayTestApi();const tracker=createMondayIssueTracker('/unused',testConfig(),{client:api.client,repository:repo,links:noLinks});api.fail('CreateUpdate');await expect(tracker.createOrReuseIssue('Partial','Important request',[])).rejects.toThrow();api.fail('');
 const issue=await tracker.createOrReuseIssue('Partial','Important request',[]);expect((await tracker.fetchIssueDetails(issue.number)).body).toBe('Important request');expect([...api.items.values()].filter(i=>i.name==='Partial')).toHaveLength(1);
});

it("resumes a recorded replacement after the original is retired", async () => {
 const api=mondayTestApi();api.items.set('1',api.item('1','Parent'));api.items.set('2',api.item('2','Source'));
 const tracker=createMondayIssueTracker('/unused',testConfig(),{client:api.client,repository:repo,links:noLinks});const replacement=await tracker.addIssueChild(1,2);
 await tracker.createIssuePlanComment(replacement.number,'<!-- prs:issue-spec -->\n# Spec');await tracker.createIssuePlanComment(replacement.number,'<!-- prs:issue-plan -->\n# Plan');expect(await tracker.finalizeIssueReplacement(2,replacement.number)).toMatchObject({status:'verified'});
 const root=mkdtempSync(join(tmpdir(),'prs-receipt-resume-'));const receipt=join(root,'receipt.json');writeFileSync(receipt,JSON.stringify({version:1,issues:[{id:'p',number:1,title:'Parent',url:api.items.get('1')!.url,status:'existing'},{id:'c',number:replacement.number,title:'Source',url:replacement.url,status:'existing',replacementOf:{number:2,id:2,url:api.items.get('2')!.url}}]}));
 const issueSet={mode:'multiple' as const,orchestration:{mode:'parent' as const,orchestratorId:'p'},issues:[{id:'p',issueNumber:1,title:'Parent',body:'Request',draftFilePath:'',specFilePath:'',planFilePath:'',specMarkdown:'# Spec',planMarkdown:'# Plan',dependsOn:[],blocks:[],related:[]},{id:'c',issueNumber:2,parentId:'p',title:'Source',body:'Request',draftFilePath:'',specFilePath:'',planFilePath:'',specMarkdown:'# Spec',planMarkdown:'# Plan',dependsOn:[],blocks:[],related:[]}]};
 const {createIssueDraftSetWithRecords}=await import('./workflows/issue/create-set');const resumed=await createIssueDraftSetWithRecords({issueSet,tracker,labels:[],forcePrsManaged:false,receiptFilePath:receipt,deferLinks:true});expect(resumed.find(i=>i.id==='c')?.number).toBe(replacement.number);expect(await tracker.addIssueChild(1,2)).toEqual(replacement);
});
it("repairs a known partial creation across adapter instances from the local journal",async()=>{
 const api=mondayTestApi();const root=mkdtempSync(join(tmpdir(),'prs-durable-create-'));const options={client:api.client,repository:repo,links:noLinks};
 const first=createMondayIssueTracker(root,testConfig(),options);api.fail('CreateUpdate');await expect(first.createOrReuseIssue('Durable','Request',[])).rejects.toThrow();api.fail('');
 const second=createMondayIssueTracker(root,testConfig(),options);const result=await second.createOrReuseIssue('Durable','Request',[]);expect((await second.fetchIssueDetails(result.number)).body).toBe('Request');expect([...api.items.values()].filter(i=>i.name==='Durable')).toHaveLength(1);
});
it("rejects calculated defaults before any creation mutation",async()=>{
 const api=mondayTestApi();api.boards[0].columns.push({id:'estimate',type:'numbers',capabilities:{calculated:{function:'SUM'}}});const config=testConfig();config.issueTracker.defaults={columnValues:{epic:{item_ids:['3']},estimate:2}};
 const tracker=createMondayIssueTracker('/unused',config,{client:api.client,repository:repo,links:noLinks});await expect(tracker.createOrReuseIssue('Rollup','Request',[])).rejects.toThrow('calculated');expect(api.mutations).toHaveLength(0);
});

it("renders Monday source and dependency references using native URLs",async()=>{
 const api=mondayTestApi();api.items.set('1',api.item('1','Source'));api.items.set('2',api.item('2','Existing'));
 const tracker=createMondayIssueTracker('/unused',testConfig(),{client:api.client,repository:repo,links:noLinks});
 const issueSet={mode:'multiple' as const,sourceIssueNumber:1,orchestration:{mode:'flat' as const,reason:'Independent'},issues:[{id:'a',issueNumber:2,title:'Existing',body:'Request',draftFilePath:'',specFilePath:'',planFilePath:'',specMarkdown:'# Spec',planMarkdown:'# Plan',dependsOn:[],blocks:[],related:[]}]};
 const {createIssueDraftSetWithRecords}=await import('./workflows/issue/create-set');await createIssueDraftSetWithRecords({issueSet,tracker,labels:[],forcePrsManaged:false});
 expect((await tracker.fetchIssueDetails(2)).body).toContain('- Source issue: https://example.monday.com/boards/10/pulses/1');
});
it('rejects invalid default label IDs even when explicit labels are valid', async () => {
    const api = mondayTestApi();
    const config = testConfig();
    config.issueTracker.defaults!.columnValues!.labels = {ids: [999]};
    const tracker = createMondayIssueTracker('/unused', config, {client: api.client, repository: repo, links: noLinks});
    await expect(tracker.preflightIssueSet({issues: [{id: 'parent'}], labels: ['with spaces']})).rejects.toThrow('invalid dropdown');
    await expect(tracker.createOrReuseIssue('Parent', 'Body', ['with spaces'])).rejects.toThrow('invalid dropdown');
    expect(api.mutations).toHaveLength(0);
});
it('rejects a source subtree during linked-set preflight', async () => {
    const api = mondayTestApi();
    api.items.set('2', api.item('2', 'Source'));
    api.items.set('4', api.item('4', 'Descendant', '11', '2'));
    const tracker = createMondayIssueTracker('/unused', testConfig(), {client: api.client, repository: repo, links: noLinks});
    await expect(tracker.preflightIssueSet({issues: [{id: 'parent'}, {id: 'child', parentId: 'parent', issueNumber: 2}], labels: []})).rejects.toThrow('descendants');
    expect(api.mutations).toHaveLength(0);
});
