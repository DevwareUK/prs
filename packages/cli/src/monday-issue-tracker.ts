import { MondayCreationJournal } from "./monday-creation-journal";
import { AUDIT_COMMENT_MARKER } from "./audit-artifacts";
import { createIssuePullRequestLinks } from "./issue-pr-links";
import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import { ISSUE_PLAN_COMMENT_MARKER, ISSUE_SPEC_COMMENT_MARKER } from "@prs/contracts";
import type { IssueTracker, IssueReference } from "./issue-tracker";
import type { AuditTarget, CreatedIssueRecord, IssueIdentity, RepositoryComment, RepositoryIdentity, IssuePlanComment } from "./integration-types";
import { createMondayClient, type MondayClient } from "./monday-client";
import { MondayItemStore, columnJson, mondayNumber, type MondayItem, type MondayUpdate } from "./monday-items";
import { decodeMondayMarkdown, decodeFocalMirror, encodeMondayMarkdown } from "./monday-content";
import { resolveIssueCreateDefaults, type ColumnValues } from "./issue-create-defaults";
import { mondaySettings, validateMondayValues, mondayValueMatches } from "./monday-values";
import { parseGitHubRepoFromRemote } from "./github-api";
import type { IssueStartResult } from "./issue-start-types";
import type { IssuePullRequestLinks } from "./issue-pr-links";
import { listMondayIssues } from "./monday-issue-list";
const BODY = '<!-- prs:managed-issue -->';
const MIGRATION = '<!-- prs:issue-migration -->';
export type MondayTrackerOptions = {
    client?: MondayClient;
    env?: Record<string, string | undefined>;
    repository?: RepositoryIdentity;
    links?: IssuePullRequestLinks;
    runDir?: string;
};
export class MondayIssueTracker implements IssueTracker {
    readonly type = 'monday' as const;
    readonly store: MondayItemStore;
    private viewer?: {
        id: string;
        name?: string;
    };
    private commentItems = new Map<number, number>();
    private replacements = new Map<number, IssueIdentity>();
    private journal: MondayCreationJournal;
    constructor(readonly repoRoot: string, readonly config: ResolvedRepositoryConfigType, private options: MondayTrackerOptions = {}) {
        const settings = config.issueTracker.monday;
        if (!settings)
            throw new Error('Monday configuration is required.');
        this.journal = new MondayCreationJournal(repoRoot, options.runDir);
        const token = (options.env ?? process.env)[settings.tokenEnv ?? 'MONDAY_API_TOKEN'] ?? '';
        this.store = new MondayItemStore(options.client ?? { request: <T>(query: string, variables: Record<string, unknown>) => createMondayClient({ token, apiVersion: settings.apiVersion }).request<T>(query, variables) }, config);
    }
    getRepositoryIdentity(): RepositoryIdentity { if (this.options.repository)
        return this.options.repository; const { owner, repo } = parseGitHubRepoFromRemote(this.repoRoot); return { owner, name: repo, url: `https://github.com/${owner}/${repo}` }; }
    isAuthenticated(): boolean { return Boolean(this.options.client || (this.options.env ?? process.env)[this.store.monday.tokenEnv ?? 'MONDAY_API_TOKEN']?.trim()); }
    async me() { if (!this.viewer) {
        const x = await this.store.client.request<{
            me: {
                id: string;
                name?: string;
            };
        }>('query Me { me { id name } }', {});
        if (!x.me?.id)
            throw new Error('Cannot identify the Monday user.');
        mondayNumber(x.me.id);
        this.viewer = x.me;
    } return this.viewer; }
    private identity(item: MondayItem): IssueIdentity { return { number: mondayNumber(item.id), id: mondayNumber(item.id), url: item.url }; }
    async fetchIssueIdentity(id: number) { return this.identity(await this.store.getItem(id)); }
    async fetchIssueParent(id: number): Promise<IssueIdentity | null> { const item = await this.store.getItem(id); return item.parent_item?.id ? this.fetchIssueIdentity(mondayNumber(item.parent_item.id)) : null; }
    async fetchIssueChildren(id: number): Promise<IssueIdentity[]> { const item = await this.store.getItem(id); return (item.subitems ?? []).filter(c => c.parent_item?.id === String(id)).map(c => this.identity(c)); }
    private decode(update: MondayUpdate) { return decodeMondayMarkdown(update.body); }
    async fetchIssueDetails(id: number) {
        const item = await this.store.getItem(id);
        const updates = await this.store.getUpdates(id);
        const owned = updates.map(u => this.decode(u)).filter((body): body is string => Boolean(body?.startsWith(BODY)));
        if (owned.length > 1)
            throw new Error('Multiple Monday request body updates; resolve the conflict.');
        let body = owned[0]?.slice(BODY.length).replace(/^\n\n?/, '');
        if (body === undefined && this.store.monday.bodyUpdatePrefix) {
            const mirrors = updates.map(u => decodeFocalMirror(u.body, this.store.monday.bodyUpdatePrefix!)).filter(m => m !== undefined);
            if (mirrors.length > 1)
                throw new Error('Multiple imported Monday body mirrors.');
            body = mirrors[0]?.body;
        }
        return { title: item.name, body: body ?? '', url: item.url };
    }
    private comment(item: MondayItem, u: MondayUpdate): RepositoryComment { const id = mondayNumber(u.id); this.commentItems.set(id, mondayNumber(item.id)); return { id, body: this.decode(u) ?? u.text_body ?? u.body, url: `${item.url}?updateId=${u.id}`, createdAt: u.created_at, updatedAt: u.updated_at ?? u.edited_at ?? u.created_at, author: u.creator?.name ?? u.creator_id, isBot: false }; }
    async fetchIssueComments(id: number) { const item = await this.store.getItem(id); const comments = (await this.store.getUpdates(id)).map(u => this.comment(item, u)); for (const marker of [BODY, ISSUE_SPEC_COMMENT_MARKER, ISSUE_PLAN_COMMENT_MARKER, AUDIT_COMMENT_MARKER, MIGRATION]) {
        if (comments.filter(c => c.body.startsWith(marker)).length > 1)
            throw new Error('Multiple managed Monday updates; resolve the conflict.');
    } return comments; }
    async fetchIssuePlanComment(id: number): Promise<IssuePlanComment | undefined> { const comments = (await this.fetchIssueComments(id)).filter(c => c.body.startsWith(ISSUE_PLAN_COMMENT_MARKER)); if (comments.length > 1)
        throw new Error('Multiple managed Monday plans.'); return comments[0]; }
    async fetchAuditComment(target: AuditTarget) { if (target.type !== 'issue')
        throw new Error('Audit target belongs to the other integration.'); const comments = (await this.fetchIssueComments(target.number)).filter(c => c.body.startsWith(AUDIT_COMMENT_MARKER)); if (comments.length > 1)
        throw new Error('Multiple managed Monday audit updates.'); return comments[0]; }
    private async writeComment(itemId: number, body: string, updateId?: number): Promise<RepositoryComment> {
        const item = await this.store.assertWritable(itemId);
        const viewer = await this.me();
        const updates = await this.store.getUpdates(itemId);
        if (updateId) {
            const update = updates.find(u => u.id === String(updateId));
            if (!update || update.creator_id !== viewer.id || !this.decode(update))
                throw new Error('Managed Monday update is missing or belongs to another user.');
        }
        const marker = /^<!-- prs:[a-z-]+ -->/.exec(body)?.[0];
        if (!marker)
            throw new Error('Expected a managed PRS marker.');
        const matches = updates.filter(u => this.decode(u)?.startsWith(marker));
        if (matches.length > 1)
            throw new Error('Multiple managed Monday updates; resolve ownership.');
        if (!updateId && matches.length) {
            updateId = mondayNumber(matches[0].id);
            if (matches[0].creator_id !== viewer.id)
                throw new Error('Managed Monday update belongs to another user.');
        }
        const html = encodeMondayMarkdown(body);
        const result = updateId ? await this.store.client.request<{
            edit_update: {
                id: string;
            };
        }>('mutation EditUpdate($updateId:ID!,$body:String!) { edit_update(id:$updateId,body:$body) { id } }', { updateId: String(updateId), body: html }) : await this.store.client.request<{
            create_update: {
                id: string;
            };
        }>('mutation CreateUpdate($itemId:ID!,$body:String!) { create_update(item_id:$itemId,body:$body) { id } }', { itemId: String(itemId), body: html });
        const resultId = 'edit_update' in result ? result.edit_update?.id : result.create_update?.id;
        if (!resultId || (updateId && resultId !== String(updateId)))
            throw new Error('Monday update write returned an invalid identity.');
        const verified = (await this.store.getUpdates(itemId)).find(u => u.id === resultId);
        if (!verified || this.decode(verified) !== body)
            throw new Error('Monday managed Markdown read-back failed.');
        return this.comment(item, verified);
    }
    async createIssuePlanComment(id: number, body: string) { return this.writeComment(id, body); }
    async updateIssueComment(commentId: number, body: string) { let itemId = this.commentItems.get(commentId); if (!itemId) {
        for (const item of await this.store.listItems()) {
            const updates = await this.store.getUpdates(mondayNumber(item.id));
            if (updates.some(u => u.id === String(commentId))) {
                itemId = mondayNumber(item.id);
                break;
            }
        }
    } if (!itemId)
        throw new Error('Monday comment is outside project scope.'); return this.writeComment(itemId, body, commentId); }
    async updateIssuePlanComment(id: number, body: string) { return this.updateIssueComment(id, body); }
    async createAuditComment(target: AuditTarget, body: string) { if (target.type !== 'issue')
        throw new Error('Audit target belongs to the other integration.'); return this.writeComment(target.number, body); }
    async createDraftIssue(title: string, body: string) { return (await this.createOrReuseIssue(title, body, [])).url; }
    async updateIssue(id: number, title: string, body: string): Promise<CreatedIssueRecord> { await this.store.assertWritable(id); const viewer = await this.me(); const bodyUpdates = (await this.store.getUpdates(id)).filter(u => this.decode(u)?.startsWith(BODY)); if (bodyUpdates.length > 1)
        throw new Error('Multiple managed body updates.'); if (bodyUpdates[0] && bodyUpdates[0].creator_id !== viewer.id)
        throw new Error('Managed Monday request belongs to another user.'); if (!title.trim())
        throw new Error('Monday issue title cannot be empty.'); const result = await this.store.client.request<{
        change_simple_column_value: {
            id: string;
        };
    }>('mutation Rename($boardId:ID!,$itemId:ID!,$name:String!) { change_simple_column_value(board_id:$boardId,item_id:$itemId,column_id:"name",value:$name) { id } }', { boardId: (await this.store.getItem(id)).board.id, itemId: String(id), name: title }); if (result.change_simple_column_value?.id !== String(id))
        throw new Error('Monday rename could not be verified.'); await this.writeComment(id, body.startsWith(BODY) ? body : `${BODY}\n\n${body}`); const read = await this.fetchIssueDetails(id); if (read.title !== title)
        throw new Error('Monday title read-back failed.'); return { number: id, title: read.title, url: read.url, status: 'existing' }; }
    private async target(parentNumber?: number) { if (!parentNumber)
        return { boardId: this.store.monday.boardId, isSubitem: false }; const parent = await this.store.assertWritable(parentNumber); const board = await this.store.getBoard(parent.board.id); if (board.hierarchy_type === 'multi_level') {
        let depth = 0;
        let p = parent;
        while (p.parent_item?.id) {
            depth++;
            p = await this.store.getItem(mondayNumber(p.parent_item.id));
        }
        if (depth >= 5)
            throw new Error('Monday native subitem depth limit exceeded.');
        return { boardId: board.id, isSubitem: true };
    } if (parent.parent_item)
        throw new Error('Classic Monday boards support one subitem level.'); const col = board.columns.find(c => c.type === 'subtasks'); const ids = col ? mondaySettings(col).boardIds : undefined; if (!Array.isArray(ids) || ids.length !== 1)
        throw new Error('Cannot resolve Monday subitem board before writing.'); return { boardId: String(ids[0]), isSubitem: true }; }
    private async labels(boardId: string, labels: string[]): Promise<ColumnValues> { if (!labels.length)
        return {}; const id = this.store.monday.workflow?.[boardId]?.labelsColumnId; if (!id)
        throw new Error(`Configure labelsColumnId for Monday board ${boardId}.`); return { [id]: { labels } }; }
    private async create(title: string, body: string, labels: string[], parentNumber?: number, copied: ColumnValues = {}, migrationKey?: string): Promise<CreatedIssueRecord> {
        const target = await this.target(parentNumber);
        const defaults = resolveIssueCreateDefaults(this.config, target, { copiedColumnValues: copied });
        if (defaults.type !== 'monday')
            throw new Error('Expected Monday defaults.');
        await validateMondayValues(this.store, target.boardId, defaults.columnValues);
        const values = { ...defaults.columnValues };
        const labelColumn = this.store.monday.workflow?.[target.boardId]?.labelsColumnId;
        if (labels.length && labelColumn) {
            const defaultLabels = values[labelColumn];
            const board = await this.store.getBoard(target.boardId);
            const column = board.columns.find(c => c.id === labelColumn);
            const options = column ? mondaySettings(column).labels as Array<{id:number;name:string}> : [];
            const payload = defaultLabels && typeof defaultLabels === 'object' && !Array.isArray(defaultLabels) ? defaultLabels as Record<string,unknown> : {};
            const names = Array.isArray(payload.labels) ? payload.labels.map(String) : Array.isArray(payload.ids) ? options.filter(o => (payload.ids as unknown[]).map(String).includes(String(o.id))).map(o => o.name) : [];
            values[labelColumn] = {labels: [...new Set([...names, ...labels])]};
        } else Object.assign(values, await this.labels(target.boardId, labels));
        const reserved = this.store.monday.workflow?.[target.boardId]?.migrationSourceColumnId;
        if (reserved && Object.hasOwn(values, reserved))
            throw new Error('Creation defaults cannot supply the reserved migration identity.');
        if (migrationKey) {
            if (!reserved)
                throw new Error('Configure migrationSourceColumnId for resumable conversion.');
            values[reserved] = migrationKey;
        }
        await validateMondayValues(this.store, target.boardId, values);
        if (!parentNumber) {
            const board = await this.store.getBoard(target.boardId);
            if (defaults.groupId && !board.groups?.some(g => g.id === defaults.groupId))
                throw new Error('Creation default groupId is not on the configured board.');
            const candidate: MondayItem = { id: '1', name: title, url: 'https://example.monday.com/boards/1/pulses/1', board: { id: target.boardId }, group: defaults.groupId ? { id: defaults.groupId } : undefined, column_values: Object.entries(values).map(([id, v]) => ({ id, text: typeof v === 'string' ? v : typeof v === 'object' && v && 'label' in v ? String(v.label) : '', value: JSON.stringify(v), ...(typeof v === 'object' && v && 'item_ids' in v ? { linked_item_ids: (v.item_ids as string[]).map(String) } : {}) })) };
            this.store.assertProjectMember(candidate);
        }
        const receipt = this.journal.begin({title, body, boardId: target.boardId, parentNumber, values, groupId: defaults.groupId});
        const result = parentNumber ? await this.store.client.request<{
            create_subitem: {
                id: string;
            };
        }>('mutation CreateSubitem($parentId:ID!,$name:String!,$values:JSON!) { create_subitem(parent_item_id:$parentId,item_name:$name,column_values:$values) { id } }', { parentId: String(parentNumber), name: title, values: JSON.stringify(values) }) : await this.store.client.request<{
            create_item: {
                id: string;
            };
        }>('mutation CreateItem($boardId:ID!,$groupId:String,$name:String!,$values:JSON!) { create_item(board_id:$boardId,group_id:$groupId,item_name:$name,column_values:$values) { id } }', { boardId: target.boardId, groupId: defaults.groupId ?? null, name: title, values: JSON.stringify(values) });
        const key = 'create_subitem' in result ? result.create_subitem?.id : result.create_item?.id;
        if (!key)
            throw new Error('Monday item creation outcome is incomplete.');
        const id = mondayNumber(key);
        receipt.itemId = id; receipt.stage = 'created'; this.journal.save(receipt);
        await this.verifyCreationValues(id, values, defaults.groupId, parentNumber);
        await this.writeComment(id, body.startsWith(BODY) ? body : `${BODY}\n\n${body}`);
        const detail = await this.fetchIssueDetails(id);
        if (detail.title !== title)
            throw new Error('Monday creation read-back failed.');
        receipt.stage = 'complete'; this.journal.save(receipt);
        return { number: id, title: detail.title, url: detail.url, status: 'created' };
    }
    private async verifyCreationValues(id: number, values: ColumnValues, groupId?: string, parentNumber?: number): Promise<void> {
        const item = await this.store.getItem(id);
        const board = await this.store.getBoard(item.board.id);
        if (groupId && !parentNumber && item.group?.id !== groupId) throw new Error('Monday creation group verification failed.');
        if (parentNumber && item.parent_item?.id !== String(parentNumber)) throw new Error('Monday creation parent verification failed.');
        for (const [key, expected] of Object.entries(values)) {
            const column = board.columns.find(c => c.id === key);
            if (!column || !mondayValueMatches(column, item.column_values.find(c => c.id === key), expected)) throw new Error(`Monday creation value verification failed for column ${key}.`);
        }
    }
    async preflightIssueSet(input: {
        issues: {
            id: string;
            parentId?: string;
            issueNumber?: number;
        }[];
        labels: string[];
    }): Promise<void> {
        const board = await this.store.getBoard(this.store.monday.boardId);
        const sub = board.columns.find(c => c.type === 'subtasks');
        const ids = sub ? mondaySettings(sub).boardIds : undefined;
        for (const entry of input.issues) {
            const boardId = entry.parentId ? (board.hierarchy_type === 'multi_level' ? board.id : Array.isArray(ids) && ids.length === 1 ? String(ids[0]) : undefined) : board.id;
            if (!boardId)
                throw new Error('Cannot resolve Monday child board before creating a linked set.');
            const defaults = resolveIssueCreateDefaults(this.config, { boardId, isSubitem: Boolean(entry.parentId) });
            if (defaults.type !== 'monday')
                throw new Error('Expected Monday defaults.');
            await validateMondayValues(this.store, boardId, defaults.columnValues);
            await validateMondayValues(this.store, boardId, await this.labels(boardId, input.labels));
            const reserved = this.store.monday.workflow?.[boardId]?.migrationSourceColumnId;
            if (reserved && Object.hasOwn(defaults.columnValues, reserved))
                throw new Error('Creation defaults cannot supply the reserved migration identity.');
            if (defaults.groupId && !board.groups?.some(g => g.id === defaults.groupId))
                throw new Error('Creation default groupId is not on the configured board.');
            if (entry.issueNumber) {
                const source = await this.store.assertWritable(entry.issueNumber);
                await this.fetchIssueComments(entry.issueNumber);
                if (entry.parentId && !source.parent_item) {
                    if (source.subitems?.length)
                        throw new Error('Source descendants cannot be preserved by this conversion; resolve the native topology before any writes.');
                    const mapping = this.store.monday.workflow?.[source.board.id];
                    if (!mapping?.statusColumnId || !mapping.closedLabel)
                        throw new Error('Configure original closed status before conversion.');
                    await validateMondayValues(this.store, source.board.id, { [mapping.statusColumnId]: { label: mapping.closedLabel } });
                    const marker = this.store.monday.workflow?.[boardId]?.migrationSourceColumnId;
                    if (!marker)
                        throw new Error('Configure migrationSourceColumnId before conversion.');
                    await validateMondayValues(this.store, boardId, { [marker]: 'prs:migration:v1:1:1' });
                }
            }
        }
    }
    async createOrReuseIssue(title: string, body: string, labels: string[], options?: {
        parentNumber?: number;
    }): Promise<CreatedIssueRecord> { if (!title.trim())
        throw new Error('Monday issue title cannot be empty.'); const target = await this.target(options?.parentNumber);
        const pending = this.journal.pending(title, target.boardId, options?.parentNumber);
        if (pending) {
            if (pending.body !== body) throw new Error('Incomplete Monday creation has different approved content; reconcile its receipt before reuse.');
            if (!pending.itemId) throw new Error('Monday creation outcome is uncertain; reconcile the pending receipt identity before retrying.');
            await this.verifyCreationValues(pending.itemId, pending.values as ColumnValues, pending.groupId, pending.parentNumber);
            await this.updateIssue(pending.itemId, title, body);
            pending.stage = 'complete'; this.journal.save(pending);
            const detail = await this.fetchIssueDetails(pending.itemId);
            return {number: pending.itemId, title: detail.title, url: detail.url, status: 'created'};
        }
        const matches = (await this.store.listItems()).filter(i => !this.store.isDone(i) && i.name.trim().toLowerCase() === title.trim().toLowerCase()); if (matches.length > 1)
        throw new Error('Multiple open Monday issues match this title.'); if (matches.length) {
        return { number: mondayNumber(matches[0].id), title: matches[0].name, url: matches[0].url, status: 'existing' };
    } return this.create(title, body, labels, options?.parentNumber); }
    async startIssueWork(id: number): Promise<IssueStartResult> {
        const item = await this.store.assertWritable(id);
        const mapping = this.store.monday.workflow?.[item.board.id];
        const result: IssueStartResult = { assignee: { status: 'unavailable', reason: 'Configure Monday peopleColumnId.' }, issueStatus: { status: 'unavailable', reason: 'Configure Monday statusColumnId/inProgressLabel.' } };
        const values: ColumnValues = {};
        const viewer = await this.me();
        if (mapping?.peopleColumnId) {
            const current = columnJson(item.column_values.find(c => c.id === mapping.peopleColumnId)).personsAndTeams;
            const people = Array.isArray(current) ? current as Array<{
                id: number;
                kind: string;
            }> : [];
            const found = people.some(p => String(p.id) === viewer.id && p.kind === 'person');
            result.assignee = { status: found ? 'already-set' : 'updated', value: viewer.id };
            if (!found)
                values[mapping.peopleColumnId] = { personsAndTeams: [...people, { id: mondayNumber(viewer.id), kind: 'person' }] };
        }
        if (mapping?.statusColumnId && mapping.inProgressLabel) {
            const done = item.column_values.find(c => c.id === mapping.statusColumnId)?.text === mapping.inProgressLabel;
            result.issueStatus = { status: done ? 'already-set' : 'updated', value: mapping.inProgressLabel };
            if (!done)
                values[mapping.statusColumnId] = { label: mapping.inProgressLabel };
        }
        if (Object.keys(values).length) {
            await this.setColumns(id, values);
            const verified = await this.store.getItem(id);
            if (mapping?.peopleColumnId && result.assignee.status === 'updated') {
                const people = columnJson(verified.column_values.find(c => c.id === mapping.peopleColumnId)).personsAndTeams;
                if (!Array.isArray(people) || !people.some(p => String(p.id) === viewer.id && p.kind === 'person'))
                    throw new Error('Monday assignment verification failed.');
            }
            if (mapping?.statusColumnId && result.issueStatus.status === 'updated' && verified.column_values.find(c => c.id === mapping.statusColumnId)?.text !== mapping.inProgressLabel)
                throw new Error('Monday status verification failed.');
        }
        return result;
    }
    private async setColumns(id: number, values: ColumnValues) { const item = await this.store.assertWritable(id); await validateMondayValues(this.store, item.board.id, values); const result = await this.store.client.request<{
        change_multiple_column_values: {
            id: string;
        };
    }>('mutation SetColumns($boardId:ID!,$itemId:ID!,$values:JSON!) { change_multiple_column_values(board_id:$boardId,item_id:$itemId,column_values:$values) { id } }', { boardId: item.board.id, itemId: String(id), values: JSON.stringify(values) }); if (result.change_multiple_column_values?.id !== String(id))
        throw new Error('Monday metadata write returned an invalid identity.'); }
    async addIssueChild(parentNumber: number, childId: number): Promise<IssueIdentity> {
        const original = await this.store.getItem(childId);
        if (this.store.isDone(original)) {
            const migration = (await this.fetchIssueComments(childId)).find(c => c.body.startsWith(MIGRATION));
            if (!migration) throw new Error('Completed Monday items are protected from conversion.');
            const data = JSON.parse(migration.body.slice(MIGRATION.length));
            if (data.source?.number !== childId || data.parentNumber !== parentNumber || !data.replacement?.number) throw new Error('Retired source has conflicting replacement lineage.');
            const replacement = await this.fetchIssueIdentity(data.replacement.number);
            if ((await this.fetchIssueParent(replacement.number))?.number !== parentNumber || !(await this.fetchIssueChildren(parentNumber)).some(c => c.number === replacement.number)) throw new Error('Retired source replacement cannot be verified.');
            return replacement;
        }
        const child = await this.store.assertWritable(childId);
        if (child.subitems?.length) throw new Error('Source descendants cannot be preserved by this conversion; resolve the native topology before any writes.');
        if (childId === parentNumber)
            throw new Error('An issue cannot parent itself.');
        if (child.parent_item?.id) {
            if (child.parent_item.id !== String(parentNumber))
                throw new Error('Issue already has an unrelated parent.');
            return this.identity(child);
        }
        const evidence = await (this.options.links ?? createIssuePullRequestLinks(this.repoRoot, this.config)).findLinkedPullRequests(await this.getIssueReference(childId));
        if (evidence.status === 'unavailable')
            throw new Error('Cannot convert an item without complete PR link evidence.');
        if (evidence.pullRequests.some(pr => pr.state === 'open'))
            throw new Error('A linked open PR blocks conversion.');
        const source = await this.fetchIssueDetails(childId);
        await this.fetchIssueComments(childId);
        const target = await this.target(parentNumber);
        const mapping = this.store.monday.workflow?.[child.board.id];
        if (!mapping?.statusColumnId || !mapping.closedLabel)
            throw new Error('Configure the original item closed status before conversion.');
        await validateMondayValues(this.store, child.board.id, { [mapping.statusColumnId]: { label: mapping.closedLabel } });
        const key = `prs:migration:v1:${childId}:${parentNumber}`;
        const markerCol = this.store.monday.workflow?.[target.boardId]?.migrationSourceColumnId;
        if (!markerCol)
            throw new Error('Configure migrationSourceColumnId before conversion.');
        const children = await this.fetchIssueChildren(parentNumber);
        const recovered = [];
        for (const c of children) {
            const item = await this.store.getItem(c.number);
            if (item.column_values.find(v => v.id === markerCol)?.text === key)
                recovered.push(c);
        }
        if (recovered.length > 1)
            throw new Error('Multiple migration replacements exist.');
        const values: ColumnValues = {};
        const board = await this.store.getBoard(target.boardId);
        const sourceBoard = await this.store.getBoard(child.board.id);
        for (const value of child.column_values) {
            const sourceColumn = sourceBoard.columns.find(c => c.id === value.id);
            const candidates = board.columns.filter(c => c.type === sourceColumn?.type && (c.id === value.id || Boolean(c.title && c.title === sourceColumn?.title)));
            if (candidates.length === 1 && (value.value || value.linked_item_ids) && candidates[0].id !== markerCol && !['name', 'item_id', 'formula', 'mirror', 'subtasks', 'direct_doc'].includes(candidates[0].type)) {
                values[candidates[0].id] = value.linked_item_ids ? {item_ids: value.linked_item_ids} : JSON.parse(value.value!);
            }
        }
        const targetMapping = this.store.monday.workflow?.[target.boardId];
        for (const role of ['peopleColumnId', 'statusColumnId', 'labelsColumnId'] as const) {
            const from = mapping[role];
            const to = targetMapping?.[role];
            const value = child.column_values.find(v => v.id === from);
            if (!value || !value.value)
                continue;
            if (!to)
                throw new Error(`Configure target ${role} before copying source metadata.`);
            delete values[from!];
            if (role === 'statusColumnId') {
                const label = value.text;
                if (label)
                    { const targetColumn = board.columns.find(c => c.id === to); const labels = targetColumn ? Object.values(mondaySettings(targetColumn).labels as Record<string,string>) : []; const desired = label === mapping.inProgressLabel ? targetMapping!.inProgressLabel ?? label : label; const resolved = labels.find(value => value.toLowerCase() === desired.toLowerCase()) ?? desired; values[to] = {label: resolved}; }
            }
            else if (role === 'labelsColumnId') {
                const raw = columnJson(value);
                const sourceColumn = (await this.store.getBoard(child.board.id)).columns.find(c => c.id === from);
                if (!sourceColumn)
                    throw new Error('Source labels column is missing.');
                const options = mondaySettings(sourceColumn).labels as Array<{
                    id: number;
                    name: string;
                }>;
                const names = Array.isArray(raw.labels) ? raw.labels.map(String) : Array.isArray(raw.ids) ? options.filter(o => (raw.ids as unknown[]).map(String).includes(String(o.id))).map(o => o.name) : [];
                values[to] = { labels: names };
            }
            else
                values[to] = JSON.parse(value.value);
        }
        await validateMondayValues(this.store, target.boardId, values);
        let replacement = recovered[0];
        if (!replacement) {
            const created = await this.create(source.title, source.body, [], parentNumber, values, key);
            replacement = await this.fetchIssueIdentity(created.number);
        }
        await this.updateIssue(replacement.number, source.title, source.body);
        await this.verifyCreationValues(replacement.number, values, undefined, parentNumber);
        const updates = await this.store.getUpdates(childId);
        for (const u of updates) {
            const body = this.decode(u);
            if (body && [ISSUE_SPEC_COMMENT_MARKER, ISSUE_PLAN_COMMENT_MARKER, AUDIT_COMMENT_MARKER].some(m => body.startsWith(m)))
                await this.writeComment(replacement.number, body);
        }
        const sourceReference = await this.getIssueReference(childId);
        const lineage = JSON.stringify({ source: { number: childId, url: source.url }, replacement, parentNumber, expectedValues: values, sourceValues: [...child.column_values].sort((a,b) => a.id.localeCompare(b.id)), ...(sourceReference.sourceUrl ? { sourceUrl: sourceReference.sourceUrl } : {}) });
        await this.writeComment(replacement.number, `${MIGRATION}\n${lineage}`);
        await this.writeComment(childId, `${MIGRATION}\n${lineage}`);
        if ((await this.fetchIssueParent(replacement.number))?.number !== parentNumber || !(await this.fetchIssueChildren(parentNumber)).some(c => c.number === replacement.number))
            throw new Error('Replacement hierarchy could not be verified.');
        this.replacements.set(childId, replacement);
        return replacement;
    }
    async finalizeIssueReplacement(original: number, replacement: number): Promise<{
        status: 'verified' | 'incomplete';
        message?: string;
    }> { try {
        const source = await this.store.getItem(original);
        const mapping = this.store.monday.workflow?.[source.board.id];
        if (!mapping?.statusColumnId || !mapping.closedLabel)
            throw new Error('Original closed status mapping unavailable.');
        if (source.subitems?.length) throw new Error('Source descendants must be preserved before retirement.');
        const target = await this.fetchIssueDetails(replacement);
        const originalDetails = await this.fetchIssueDetails(original);
        const request = (body: string) => body.split(/\n## Linked Issues\s*\n/)[0].trimEnd();
        if (target.title !== originalDetails.title || request(target.body) !== request(originalDetails.body))
            throw new Error('Replacement request differs from original.');
        const parent = await this.fetchIssueParent(replacement);
        if (!parent || !(await this.fetchIssueChildren(parent.number)).some(child => child.number === replacement))
            throw new Error('Replacement hierarchy is not verified in both directions.');
        const comments = await this.fetchIssueComments(replacement);
        if (!comments.some(c => c.body.startsWith(ISSUE_SPEC_COMMENT_MARKER)) || !comments.some(c => c.body.startsWith(ISSUE_PLAN_COMMENT_MARKER)))
            throw new Error('Both replacement refinement artifacts are required before retirement.');
        const migration = comments.find(c => c.body.startsWith(MIGRATION));
        if (!migration) throw new Error('Replacement lineage is missing.');
        const lineage = JSON.parse(migration.body.slice(MIGRATION.length));
        if (lineage.source?.number !== original || lineage.replacement?.number !== replacement || lineage.parentNumber !== parent.number)
            throw new Error('Replacement lineage does not match the requested retirement.');
        await this.verifyCreationValues(replacement, lineage.expectedValues ?? {}, undefined, parent.number);
        if (!this.store.isDone(source) && JSON.stringify([...source.column_values].sort((a,b) => a.id.localeCompare(b.id))) !== JSON.stringify(lineage.sourceValues)) throw new Error('Source metadata changed during conversion; reconcile before retirement.');
        if (!this.store.isDone(source))
            await this.setColumns(original, { [mapping.statusColumnId]: { label: mapping.closedLabel } });
        const read = await this.store.getItem(original);
        if (!this.store.isDone(read))
            throw new Error('Original retirement was not verified.');
        return { status: 'verified' };
    }
    catch {
        return { status: 'incomplete', message: 'Original retirement could not be verified; resume the recorded conversion.' };
    } }
    async getIssueReference(id: number): Promise<IssueReference> {
        const item = await this.store.getItem(id);
        const ref: IssueReference = { provider: 'monday', scope: this.store.monday.boardId, key: String(id), url: item.url };
        const updates = await this.store.getUpdates(id);
        for (const update of updates) {
            if (this.store.monday.bodyUpdatePrefix) {
                const mirror = decodeFocalMirror(update.body, this.store.monday.bodyUpdatePrefix);
                if (mirror) {
                    if (ref.sourceUrl && ref.sourceUrl !== mirror.sourceUrl)
                        throw new Error('Conflicting legacy source references.');
                    ref.sourceUrl = mirror.sourceUrl;
                }
            }
            const body = this.decode(update);
            if (body?.startsWith(MIGRATION)) {
                let data: {
                    source?: {
                        number: number;
                        url: string;
                    };
                    replacement?: {
                        number: number;
                    };
                    sourceUrl?: string;
                };
                try {
                    data = JSON.parse(body.slice(MIGRATION.length).trim());
                }
                catch {
                    throw new Error('Invalid migration lineage.');
                }
                if (data.replacement?.number === id && data.source) {
                    if (data.sourceUrl)
                        ref.sourceUrl = data.sourceUrl;
                    ref.previous = [{ provider: 'monday', scope: ref.scope, key: String(data.source.number), url: data.source.url }];
                }
            }
        }
        return ref;
    }
    listIssues(options: {
        actionable: boolean;
    }) { return listMondayIssues(this, options, this.options.links); }
}
export function createMondayIssueTracker(repoRoot: string, config: ResolvedRepositoryConfigType, options: MondayTrackerOptions = {}): MondayIssueTracker { return new MondayIssueTracker(repoRoot, config, options); }
