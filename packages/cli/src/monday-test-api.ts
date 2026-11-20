// In-memory API fixture for adapter tests; production never imports this file.
import type { MondayClient } from "./monday-client";
import type { MondayItem, MondayBoard, MondayUpdate } from "./monday-items";
export function mondayTestApi() {
    const boards: MondayBoard[] = [{ id: '10', hierarchy_type: 'classic', groups: [{ id: 'ready', title: 'Ready' }], columns: [{ id: 'epic', type: 'board_relation', settings_str: JSON.stringify({ boardIds: [30], allowMultipleItems: false }) }, { id: 'owner', type: 'people' }, { id: 'status', type: 'status', settings_str: JSON.stringify({ labels: { 0: 'Open', 1: 'In Progress', 2: 'Done', 3: 'No Longer Needed' } }) }, { id: 'labels', type: 'dropdown', settings_str: JSON.stringify({ labels: [{ id: 1, name: 'ready' }, { id: 2, name: 'with spaces' }] }) }, { id: 'subitems', type: 'subtasks', settings_str: JSON.stringify({ boardIds: [11] }) }] }, { id: '11', hierarchy_type: 'classic', columns: [{ id: 'owner', type: 'people' }, { id: 'status', type: 'status', settings_str: JSON.stringify({ labels: { 0: 'Open', 1: 'In Progress', 2: 'Done', 3: 'No Longer Needed' } }) }, { id: 'labels', type: 'dropdown', settings_str: JSON.stringify({ labels: [{ id: 1, name: 'ready' }, { id: 2, name: 'with spaces' }] }) }, { id: 'migration', type: 'text' }] }, { id: '30', columns: [] }];
    const items = new Map<string, MondayItem>();
    const updates = new Map<string, MondayUpdate[]>();
    const mutations: string[] = [];
    let seq = 100;
    let failure = '';
    function item(id: string, name = 'Task', board = '10', parent?: string): MondayItem { return { id, name, url: `https://example.monday.com/boards/${board === '11' ? '10' : board}/pulses/${id}`, board: { id: board }, group: { id: 'ready' }, parent_item: parent ? { id: parent } : null, creator_id: '7', created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', column_values: board === '10' ? [{ id: 'epic', value: null, linked_item_ids: ['3'], text: 'FOCAL' }] : [], subitems: [] }; }
    items.set('3', item('3', 'FOCAL', '30'));
    function values(target: MondayItem, columns: Record<string, unknown>) { for (const [id, value] of Object.entries(columns)) {
        const obj = value as {
            label?: string;
            index?: number;
            labels?: string[];
            item_ids?: string[];
        };
        const col = boards.find(b => b.id === target.board.id)?.columns.find(c => c.id === id);
        let text = typeof value === 'string' ? value : obj?.label ?? obj?.labels?.join(', ') ?? '';
        if (obj?.index !== undefined)
            text = JSON.parse(col?.settings_str ?? '{}').labels?.[obj.index] ?? '';
        target.column_values = target.column_values.filter(c => c.id !== id);
        target.column_values.push({ id, type: col?.type, text, value: col?.type === 'board_relation' ? null : JSON.stringify(value), ...(obj?.item_ids ? { linked_item_ids: obj.item_ids.map(String) } : {}) });
    } }
    const client: MondayClient = { async request<T>(query: string, v: Record<string, unknown>): Promise<T> {
            let result: unknown;
            if (query.trim().startsWith('mutation')) {
                mutations.push(query);
                if (failure && query.includes(failure))
                    throw new Error('Injected API failure');
            }
            if (query.includes('query Me'))
                result = { me: { id: '7', name: 'Viewer' } };
            else if (query.includes('query Board'))
                result = { boards: boards.filter(b => (v.ids as string[]).includes(b.id)) };
            else if (query.includes('query Items'))
                result = { boards: boards.filter(b => (v.ids as string[]).includes(b.id)).map(b => ({ ...b, items_page: { cursor: null, items: [...items.values()].filter(i => i.board.id === b.id && !i.parent_item).map(i => ({ ...i, subitems: [...items.values()].filter(c => c.parent_item?.id === i.id) })) } })) };
            else if (query.includes('query Updates'))
                result = { items: (v.ids as string[]).filter(id => items.has(id)).map(id => ({ id, updates: (updates.get(id) ?? []).slice((Number(v.page) - 1) * 100, Number(v.page) * 100) })) };
            else if (query.includes('query Item'))
                result = { items: (v.ids as string[]).filter(id => items.has(id)).map(id => ({ ...items.get(id)!, subitems: [...items.values()].filter(c => c.parent_item?.id === id) })) };
            else if (query.includes('mutation CreateItem') || query.includes('mutation CreateSubitem')) {
                const child = query.includes('CreateSubitem');
                const id = String(++seq);
                const target = item(id, String(v.name), child ? '11' : String(v.boardId), child ? String(v.parentId) : undefined);
                if (v.groupId)
                    target.group = { id: String(v.groupId) };
                values(target, JSON.parse(String(v.values ?? '{}')));
                items.set(id, target);
                result = { [child ? 'create_subitem' : 'create_item']: target };
            }
            else if (query.includes('mutation SetColumns')) {
                const target = items.get(String(v.itemId))!;
                values(target, JSON.parse(String(v.values)));
                result = { change_multiple_column_values: { id: target.id } };
            }
            else if (query.includes('mutation Rename')) {
                items.get(String(v.itemId))!.name = String(v.name);
                result = { change_simple_column_value: { id: String(v.itemId) } };
            }
            else if (query.includes('mutation CreateUpdate')) {
                const id = String(++seq);
                const update = { id, body: String(v.body), creator_id: '7', created_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z', item_id: String(v.itemId) };
                updates.set(String(v.itemId), [...(updates.get(String(v.itemId)) ?? []), update]);
                result = { create_update: update };
            }
            else if (query.includes('mutation EditUpdate')) {
                const u = [...updates.values()].flat().find(u => u.id === String(v.updateId))!;
                u.body = String(v.body);
                result = { edit_update: u };
            }
            else
                throw new Error(`Unexpected fixture operation ${query.slice(0, 50)}`);
            return structuredClone(result) as T;
        } };
    return { client, items, updates, mutations, boards, item, fail: (operation: string) => { failure = operation; } };
}
