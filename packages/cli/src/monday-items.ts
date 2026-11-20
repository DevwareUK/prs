import type { ResolvedRepositoryConfigType } from "@prs/contracts";
import type { MondayClient } from "./monday-client";
export type MondayColumn = {
    id: string;
    title?: string;
    type: string;
    settings_str?: string; capabilities?: {calculated?: {function?: string} | null};
};
export type MondayValue = {
    id: string;
    type?: string;
    text?: string | null;
    value?: string | null;
    linked_item_ids?: string[];
};
export type MondayItem = {
    id: string;
    name: string;
    url: string;
    board: {
        id: string;
    };
    group?: {
        id: string;
    };
    parent_item?: {
        id: string;
    } | null;
    column_values: MondayValue[];
    subitems?: MondayItem[];
    creator_id?: string;
    creator?: {
        id: string;
        name?: string;
    };
    created_at?: string;
    updated_at?: string;
};
export type MondayBoard = {
    id: string;
    hierarchy_type?: string;
    groups?: {
        id: string;
        title: string;
    }[];
    columns: MondayColumn[];
};
export type MondayUpdate = {
    id: string;
    body: string;
    text_body?: string | null;
    creator_id: string;
    creator?: {
        id: string;
        name?: string;
    };
    created_at: string;
    updated_at?: string;
    edited_at?: string;
    item_id?: string;
};
export function mondayNumber(id: string): number {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
        throw new Error("Monday returned an unsupported numeric ID.");
    return Number(id);
}
export function columnData(value?: MondayValue): unknown {
    if (!value?.value) return null;
    try { return JSON.parse(value.value); } catch { throw new Error(`Monday column ${value.id} has invalid data.`); }
}
export function columnJson(value?: MondayValue): Record<string, unknown> {
    if (!value?.value)
        return {};
    try {
        const parsed = JSON.parse(value.value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            return parsed;
    }
    catch { /* fail below */ }
    throw new Error(`Monday column ${value.id} has invalid data.`);
}
const fields = `id name url created_at updated_at creator_id creator { id name } board { id } group { id } parent_item { id } column_values { id type text value ... on BoardRelationValue { linked_item_ids } }`;
const selection = `${fields} subitems { ${fields} }`;
function checkItem(item: MondayItem, id?: string): MondayItem {
    if (!item || typeof item.id !== "string" || (id && item.id !== id) || typeof item.name !== "string" || typeof item.url !== "string" || !/^https:\/\/[a-z0-9.-]+\.monday\.com\/boards\/[1-9]\d*\/pulses\/[1-9]\d*/i.test(item.url) || !item.board?.id || !Array.isArray(item.column_values))
        throw new Error("Monday returned an invalid item.");
    mondayNumber(item.id);
    mondayNumber(item.board.id);
    const url = new URL(item.url);
    if (!new RegExp(`^/boards/[1-9]\\d*/pulses/${item.id}$`).test(url.pathname) || url.username || url.password)
        throw new Error("Monday item URL does not match its identity.");
    return item;
}
export class MondayItemStore {
    readonly monday: NonNullable<ResolvedRepositoryConfigType["issueTracker"]["monday"]>;
    private boards = new Map<string, MondayBoard>();
    constructor(readonly client: MondayClient, config: ResolvedRepositoryConfigType) {
        if (!config.issueTracker.monday)
            throw new Error("Monday configuration is required.");
        this.monday = config.issueTracker.monday;
    }
    async getBoard(id: string): Promise<MondayBoard> {
        if (this.boards.has(id))
            return this.boards.get(id)!;
        const result = await this.client.request<{
            boards: MondayBoard[];
        }>(`query Board($ids: [ID!]!) { boards(ids: $ids) { id hierarchy_type groups { id title } columns { id title type settings_str capabilities { calculated { function } } } } }`, { ids: [id] });
        const board = result.boards?.find(b => b.id === id);
        if (!board || !Array.isArray(board.columns))
            throw new Error(`Monday board ${id} is inaccessible or invalid.`);
        this.boards.set(id, board);
        return board;
    }
    async rawItem(id: string): Promise<MondayItem> {
        mondayNumber(id);
        const result = await this.client.request<{
            items: MondayItem[];
        }>(`query Item($ids: [ID!]!) { items(ids: $ids) { ${selection} } }`, { ids: [id] });
        if (!Array.isArray(result.items) || result.items.length !== 1)
            throw new Error(`Monday item ${id} is inaccessible.`);
        return checkItem(result.items[0], id);
    }
    private matches(item: MondayItem): boolean {
        if (![this.monday.boardId, ...(this.monday.doneBoardIds ?? [])].includes(item.board.id))
            return false;
        const scope = this.monday.scope;
        if (scope?.groupIds && !scope.groupIds.includes(item.group?.id ?? ""))
            return false;
        return (scope?.columnRules ?? []).every(rule => {
            const column = item.column_values.find(c => c.id === rule.columnId);
            if (!column)
                throw new Error(`Project scope column ${rule.columnId} is unavailable on board ${item.board.id}.`);
            const parsed = columnData(column);
            const data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string,unknown> : {};
            const values = (column.linked_item_ids ?? (Array.isArray(data.ids) ? data.ids : Array.isArray(data.tag_ids) ? data.tag_ids : data.index !== undefined ? [data.index] : typeof parsed === "string" || typeof parsed === "number" ? [parsed] : column.text ? [column.text] : [])).map(String);
            const compare = (Array.isArray(rule.compareValue) ? rule.compareValue : [rule.compareValue]).map(String);
            switch (rule.operator) {
                case "any_of": return compare.some(v => values.includes(v));
                case "not_any_of": return !compare.some(v => values.includes(v));
                case "contains_text": return compare.some(v => (column.text ?? "").toLowerCase().includes(v.toLowerCase()));
                case "is_empty": return values.length === 0;
                case "is_not_empty": return values.length > 0;
                default: throw new Error(`Unsupported project scope operator ${rule.operator}; configure a supported column rule.`);
            }
        });
    }
    assertProjectMember(item: MondayItem): void { if (!this.matches(item))
        throw new Error("Creation defaults place the task outside project scope."); }
    async getItem(id: number): Promise<MondayItem> {
        if (!Number.isSafeInteger(id) || id < 1)
            throw new Error("Expected a positive safe Monday item ID.");
        const item = await this.rawItem(String(id));
        let ancestor = item;
        const seen = new Set<string>();
        while (ancestor.parent_item?.id) {
            if (seen.has(ancestor.id))
                throw new Error("Monday hierarchy contains a cycle.");
            seen.add(ancestor.id);
            ancestor = await this.rawItem(ancestor.parent_item.id);
        }
        if (!this.matches(ancestor))
            throw new Error("Monday item is outside the configured project scope.");
        return item;
    }
    async listItems(): Promise<MondayItem[]> {
        const items = new Map<string, MondayItem>();
        for (const id of [this.monday.boardId, ...(this.monday.doneBoardIds ?? [])]) {
            const rules = this.monday.scope?.columnRules?.map(r => ({ column_id: r.columnId, operator: r.operator, compare_value: r.compareValue }));
            const initial = await this.client.request<{
                boards: Array<MondayBoard & {
                    items_page: {
                        cursor: string | null;
                        items: MondayItem[];
                    };
                }>;
            }>(`query Items($ids: [ID!]!, $params: ItemsQuery) { boards(ids: $ids) { id items_page(limit: 100, query_params: $params) { cursor items { ${selection} } } } }`, { ids: [id], params: rules ? { rules, operator: "and" } : null });
            const board = initial.boards?.find(b => b.id === id);
            if (!board)
                throw new Error(`Monday board ${id} is inaccessible.`);
            let page = board.items_page;
            const cursors = new Set<string>();
            for (;;) {
                if (!page || !Array.isArray(page.items))
                    throw new Error("Monday returned an invalid item page.");
                for (const root of page.items) {
                    checkItem(root);
                    if (!this.matches(root))
                        continue;
                    for (const item of [root, ...(root.subitems ?? [])]) {
                        checkItem(item);
                        const old = items.get(item.id);
                        if (old && old.parent_item?.id !== item.parent_item?.id)
                            throw new Error("Monday returned conflicting parents.");
                        items.set(item.id, item);
                    }
                }
                if (!page.cursor)
                    break;
                if (cursors.has(page.cursor))
                    throw new Error("Monday repeated an item pagination cursor.");
                cursors.add(page.cursor);
                const next = await this.client.request<{
                    next_items_page: typeof page;
                }>(`query Next($cursor: String!) { next_items_page(cursor: $cursor, limit: 100) { cursor items { ${selection} } } }`, { cursor: page.cursor });
                page = next.next_items_page;
            }
        }
        return [...items.values()];
    }
    async getUpdates(itemId: number): Promise<MondayUpdate[]> {
        await this.getItem(itemId);
        const updates: MondayUpdate[] = [];
        const seen = new Set<string>();
        for (let page = 1;; page++) {
            const result = await this.client.request<{
                items: Array<{
                    id: string;
                    updates: MondayUpdate[];
                }>;
            }>(`query Updates($ids:[ID!]!,$page:Int!) { items(ids:$ids) { id updates(limit:100,page:$page) { id body text_body creator_id creator { id name } item_id created_at updated_at edited_at } } }`, { ids: [String(itemId)], page });
            const item = result.items?.find(i => i.id === String(itemId));
            if (!item || !Array.isArray(item.updates))
                throw new Error("Monday returned an invalid update page.");
            for (const update of item.updates) {
                if (!update || typeof update.id !== "string" || typeof update.body !== "string" || !update.creator_id || !update.created_at)
                    throw new Error("Monday returned an invalid update.");
                mondayNumber(update.id);
                if (seen.has(update.id))
                    throw new Error("Monday repeated an update ID.");
                seen.add(update.id);
                updates.push(update);
            }
            if (item.updates.length < 100)
                return updates;
        }
    }
    isDone(item: MondayItem): boolean {
        if ((this.monday.doneBoardIds ?? []).includes(item.board.id) || (this.monday.doneGroupIds ?? []).includes(item.group?.id ?? ""))
            return true;
        const mapping = this.monday.workflow?.[item.board.id];
        const column = item.column_values.find(c => c.id === mapping?.statusColumnId);
        return Boolean(column?.text && mapping?.doneLabels?.includes(column.text));
    }
    async assertWritable(id: number): Promise<MondayItem> {
        const item = await this.getItem(id);
        let root = item;
        while (root.parent_item?.id)
            root = await this.rawItem(root.parent_item.id);
        if (this.isDone(item) || this.isDone(root))
            throw new Error("Completed Monday items are protected from writes.");
        return item;
    }
}
