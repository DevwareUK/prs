import { expect, it } from "vitest";
import { resolveRepositoryConfig } from "@prs/core";
import { MondayItemStore } from "./monday-items";
import type { MondayClient } from "./monday-client";
const config = resolveRepositoryConfig({ issueTracker: { type: 'monday', monday: { boardId: '10', scope: { columnRules: [{ columnId: 'epic', operator: 'any_of', compareValue: [3] }] }, doneGroupIds: ['done'] } } });
const item = (id: string, epic = 3, group = 'ready') => ({ id, name: 'Task', url: `https://example.monday.com/boards/10/pulses/${id}`, board: { id: '10' }, group: { id: group }, column_values: [{ id: 'epic', text: 'FOCAL', value: null, linked_item_ids: [String(epic)] }], subitems: [] });
it("reads later pages and scopes subtasks by their ancestor rather than Epic columns", async () => {
    const root = { ...item('1'), subitems: [{ ...item('2', 9), board: { id: '11' }, parent_item: { id: '1' } }] };
    const client = { request: async (query: string) => query.includes('next_items_page') ? { next_items_page: { cursor: null, items: [item('4', 7)] } } : { boards: [{ id: '10', items_page: { cursor: 'next', items: [root] } }] } } as MondayClient;
    const store = new MondayItemStore(client, config);
    expect((await store.listItems()).map(i => i.id)).toEqual(['1', '2']);
});
it("detects cursor cycles instead of returning incomplete scope", async () => {
    const client = { request: async (query: string) => query.includes('next_items_page') ? { next_items_page: { cursor: 'cycle', items: [] } } : { boards: [{ id: '10', items_page: { cursor: 'cycle', items: [] } }] } } as MondayClient;
    await expect(new MondayItemStore(client, config).listItems()).rejects.toThrow('cursor');
});
it("validates direct reads and keeps moved Done-group items scoped", async () => {
    const client = { request: async () => ({ items: [item('1', 3, 'done')] }) } as MondayClient;
    const store = new MondayItemStore(client, config);
    expect(await store.getItem(1)).toMatchObject({ id: '1' });
    expect(store.isDone(await store.getItem(1))).toBe(true);
    const foreign = { request: async () => ({ items: [item('1', 9)] }) } as MondayClient;
    await expect(new MondayItemStore(foreign, config).getItem(1)).rejects.toThrow('scope');
});

it("scopes native scalar text values and matches contains_text case insensitively",async()=>{
 const config=resolveRepositoryConfig({issueTracker:{type:'monday',monday:{boardId:'10',scope:{columnRules:[{columnId:'project',operator:'contains_text',compareValue:['focal']}]}}}});
 const root={...item('1'),column_values:[{id:'project',type:'text',text:'FOCAL project',value:'"FOCAL project"'}]};
 const client={request:async()=>({items:[root]})} as MondayClient;
 expect(await new MondayItemStore(client,config).getItem(1)).toMatchObject({id:'1'});
});
