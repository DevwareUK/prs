import { expect, it } from "vitest";
import { createMondayClient } from "./monday-client";
it("sends versioned GraphQL variables without leaking auth errors", async () => {
    const requests: Array<{
        headers?: HeadersInit;
        body?: BodyInit | null;
    }> = [];
    const client = createMondayClient({ token: "private-token", apiVersion: "2026-07", fetch: async (_url, init) => { requests.push(init ?? {}); return new Response(JSON.stringify({ data: { me: { id: "7" } } })); } });
    expect(await client.request('query Who { me { id } }', {})).toEqual({ me: { id: "7" } });
    expect(requests[0].headers).toMatchObject({ Authorization: "private-token", "API-Version": "2026-07" });
    expect(JSON.parse(String(requests[0].body))).toEqual({ query: 'query Who { me { id } }', variables: {} });
});
it("rejects partial GraphQL success and redacts server text", async () => {
    const client = createMondayClient({ token: "private-token", fetch: async () => new Response(JSON.stringify({ data: { id: 1 }, errors: [{ message: "private-token body" }] })) });
    await expect(client.request('query { me { id } }', {})).rejects.toThrow('GraphQL');
    try {
        await client.request('query { me { id } }', {});
    }
    catch (e) {
        expect(String(e)).not.toContain('private-token');
    }
});
it("retries bounded throttled reads but never an uncertain mutation", async () => {
    let calls = 0;
    const waits: number[] = [];
    const client = createMondayClient({ token: "x", sleep: async (ms) => { waits.push(ms); }, fetch: async () => { calls++; return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }); } });
    await expect(client.request('query { me { id } }', {})).rejects.toThrow('429');
    expect(calls).toBe(4);
    expect(waits).toEqual([1000, 1000, 1000]);
    calls = 0;
    await expect(client.request('mutation { create_item { id } }', {})).rejects.toThrow();
    expect(calls).toBe(1);
});
it("requires token and rejects malformed responses", async () => {
    expect(() => createMondayClient({ token: '' })).toThrow('token');
    const client = createMondayClient({ token: 'x', fetch: async () => new Response('not-json') });
    await expect(client.request('query { me { id } }', {})).rejects.toThrow('invalid');
});
