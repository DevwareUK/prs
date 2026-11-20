import type { ColumnValues } from "./issue-create-defaults";
import { MondayItemStore, mondayNumber, type MondayColumn } from "./monday-items";
export function mondaySettings(column: MondayColumn): Record<string, unknown> {
    try {
        const value = JSON.parse(column.settings_str ?? '{}');
        if (value && typeof value === 'object' && !Array.isArray(value))
            return value;
    }
    catch { /* fail below */ }
    throw new Error(`Monday column ${column.id} has invalid settings.`);
}
export async function validateMondayValues(store: MondayItemStore, boardId: string, values: ColumnValues): Promise<void> {
    const board = await store.getBoard(boardId);
    for (const [id, value] of Object.entries(values)) {
        const col = board.columns.find(c => c.id === id);
        if (!col)
            throw new Error(`Creation defaults columnValues.${id}: unknown column on board ${boardId}.`);
        if (!['text', 'long_text', 'numbers', 'date', 'status', 'dropdown', 'people', 'board_relation', 'checkbox', 'link', 'email', 'phone', 'country', 'hour', 'timeline', 'rating', 'color_picker'].includes(col.type))
            throw new Error(`Creation defaults columnValues.${id}: column ${col.type} is not writable through task defaults.`);
        if (col.capabilities?.calculated?.function && col.capabilities.calculated.function !== 'NONE') throw new Error(`Creation defaults columnValues.${id}: calculated columns cannot preserve task values; configure a non-calculated column.`);
        if (value === null)
            continue;
        const obj = typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
        const settings = mondaySettings(col);
        const bad = () => { throw new Error(`Creation defaults columnValues.${id}: invalid ${col.type} value.`); };
        if (col.type === 'board_relation') {
            if (!obj || !Array.isArray(obj.item_ids))
                bad();
            const ids = obj!.item_ids as unknown[];
            if (settings.allowMultipleItems === false && ids.length > 1)
                bad();
            for (const id of ids) {
                const key = String(id);
                mondayNumber(key);
                const ref = await store.rawItem(key);
                if (!Array.isArray(settings.boardIds) || !settings.boardIds.map(String).includes(ref.board.id))
                    throw new Error(`Creation defaults columnValues.${col.id}: linked item is outside connected boards.`);
            }
        }
        else if (col.type === 'status') {
            const labels = (settings.labels ?? {}) as Record<string, string>;
            const label = typeof value === 'string' ? value : obj?.label;
            if (label !== undefined && !Object.values(labels).includes(String(label)))
                bad();
            if (obj?.index !== undefined && !Object.hasOwn(labels, String(obj.index)))
                bad();
            if (label === undefined && obj?.index === undefined && (!obj || Object.keys(obj).length))
                bad();
        }
        else if (col.type === 'dropdown') {
            if (!obj)
                bad();
            const options = (settings.labels ?? []) as {
                id: number;
                name: string;
            }[];
            if (obj!.labels !== undefined && (!Array.isArray(obj!.labels) || !obj!.labels.every(label => options.some(o => o.name === label))))
                bad();
            if (obj!.ids !== undefined && (!Array.isArray(obj!.ids) || !obj!.ids.every(id => options.some(o => String(o.id) === String(id)))))
                bad();
            if (Object.keys(obj!).some(k => !['ids', 'labels'].includes(k)))
                bad();
        }
        else if (col.type === 'people') {
            if (!obj || !Array.isArray(obj.personsAndTeams) || !obj.personsAndTeams.every(p => p && typeof p === 'object' && ['person', 'team'].includes(String((p as Record<string, unknown>).kind)) && Number.isSafeInteger(Number((p as Record<string, unknown>).id)) && Number((p as Record<string, unknown>).id) > 0))
                bad();
        }
        else if (col.type === 'numbers') {
            if (!(typeof value === 'number' && Number.isFinite(value)) && !(typeof value === 'string' && (value === '' || Number.isFinite(Number(value)))))
                bad();
        }
        else if (col.type === 'date') {
            if (!obj || typeof obj.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.date) || !Number.isFinite(Date.parse(obj.date)))
                bad();
        }
        else if (col.type === 'text') {
            if (typeof value !== 'string')
                bad();
        }
        else if (!obj && typeof value !== 'string')
            bad();
    }
}

export function mondayValueMatches(column: MondayColumn, actual: import("./monday-items").MondayValue | undefined, expected: unknown): boolean {
    if (!actual) return expected === null;
    let raw: unknown;
    try { raw = actual.value ? JSON.parse(actual.value) : null; } catch { return false; }
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string,unknown> : {};
    const wanted = expected && typeof expected === 'object' && !Array.isArray(expected) ? expected as Record<string,unknown> : {};
    const sorted = (values: unknown[]) => values.map(String).sort();
    const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (expected === null) return !actual.text && (!raw || typeof raw === 'object' && !Object.keys(raw).length) && !(actual.linked_item_ids?.length);
    if (column.type === 'board_relation') return Array.isArray(wanted.item_ids) && equal(sorted(actual.linked_item_ids ?? []), sorted(wanted.item_ids));
    if (column.type === 'people') {
        const keys = (values: unknown) => Array.isArray(values) ? values.map(p => `${String(p.kind)}:${String(p.id)}`).sort() : [];
        return equal(keys(data.personsAndTeams), keys(wanted.personsAndTeams));
    }
    if (column.type === 'status') {
        const labels = mondaySettings(column).labels as Record<string,string>;
        const label = typeof expected === 'string' ? expected : wanted.label ?? (wanted.index === undefined ? undefined : labels[String(wanted.index)]);
        return label === undefined ? !actual.text : actual.text === label;
    }
    if (column.type === 'dropdown') {
        const options = mondaySettings(column).labels as Array<{id:number;name:string}>;
        const names = (value: Record<string,unknown>) => Array.isArray(value.labels) ? value.labels.map(String) : Array.isArray(value.ids) ? options.filter(o => (value.ids as unknown[]).map(String).includes(String(o.id))).map(o => o.name) : [];
        return equal(sorted(names(data)), sorted(names(wanted)));
    }
    if (column.type === 'numbers') return Number(raw ?? actual.text) === Number(expected);
    if (column.type === 'text') return (typeof raw === 'string' ? raw : actual.text) === expected;
    return Object.entries(wanted).every(([key,value]) => equal(data[key], value));
}
