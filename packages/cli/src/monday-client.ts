export interface MondayClient {
    request<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}
export function createMondayClient(options: {
    token: string;
    apiVersion?: string;
    fetch?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
}): MondayClient {
    if (!options.token.trim())
        throw new Error("Monday API token is required; configure the selected token environment variable.");
    const request = options.fetch ?? fetch;
    return { async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
            const read = /^\s*query\b/.test(query);
            for (let attempt = 0; attempt < 4; attempt++) {
                let response: Response;
                try {
                    response = await request("https://api.monday.com/v2", { method: "POST", headers: { Authorization: options.token, "Content-Type": "application/json", "API-Version": options.apiVersion ?? "2026-07" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000) });
                }
                catch {
                    throw new Error(read ? "Monday read request failed." : "Monday mutation outcome is uncertain; reconcile the known identity before retrying.");
                }
                if (response.status === 429 && read && attempt < 3) {
                    const seconds = Number(response.headers.get("Retry-After") ?? 1);
                    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30)
                        throw new Error("Monday rate limit requires a later retry (HTTP 429).");
                    await (options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(seconds * 1000);
                    continue;
                }
                if (!response.ok)
                    throw new Error(`Monday request failed (HTTP ${response.status}).`);
                let payload: {
                    data?: T;
                    errors?: unknown[];
                };
                try {
                    payload = await response.json() as typeof payload;
                }
                catch {
                    throw new Error("Monday returned invalid JSON.");
                }
                if (!payload || typeof payload !== "object" || payload.errors?.length)
                    throw new Error("Monday GraphQL request failed; check permissions, schema and rate limits.");
                if (!payload.data || typeof payload.data !== "object")
                    throw new Error("Monday returned invalid data.");
                return payload.data;
            }
            throw new Error("Monday read retry limit exceeded.");
        } };
}
