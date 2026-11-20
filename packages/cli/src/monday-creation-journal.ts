import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
export type MondayCreationReceipt = { key: string; title: string; boardId: string; parentNumber?: number; body: string; values: Record<string, unknown>; groupId?: string; itemId?: number; stage: "planned" | "created" | "complete"; file?: string };
export class MondayCreationJournal {
    private receipts: MondayCreationReceipt[] = [];
    private root?: string;
    constructor(repoRoot: string, runDir?: string) {
        this.root = runDir ?? (existsSync(repoRoot) ? resolve(repoRoot, ".prs", "runs") : undefined);
        if (!this.root || !existsSync(this.root)) return;
        for (const entry of readdirSync(this.root, { withFileTypes: true })) {
            if (!entry.isDirectory() || !entry.name.endsWith("-monday-create")) continue;
            const file = resolve(this.root, entry.name, "creation-receipt.json");
            if (!existsSync(file)) continue;
            let receipt: MondayCreationReceipt;
            try { receipt = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error("A Monday creation receipt is unreadable; reconcile it before creating more tasks."); }
            if (typeof receipt.key !== "string" || !["planned", "created", "complete"].includes(receipt.stage) || typeof receipt.title !== "string") throw new Error("A Monday creation receipt is invalid.");
            this.receipts.push({ ...receipt, file });
        }
    }
    pending(title: string, boardId: string, parentNumber?: number): MondayCreationReceipt | undefined {
        const matches = this.receipts.filter(r => r.stage !== "complete" && r.title === title && r.boardId === boardId && r.parentNumber === parentNumber);
        if (matches.length > 1) throw new Error("Multiple pending Monday creations require reconciliation.");
        return matches[0];
    }
    begin(input: Omit<MondayCreationReceipt, "key" | "stage" | "file">): MondayCreationReceipt {
        const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const receipt: MondayCreationReceipt = { ...input, key, stage: "planned" };
        if (this.root) {
            const directory = resolve(this.root, `${new Date().toISOString().replace(/[^0-9]/g, "")}-${randomUUID()}-monday-create`);
            mkdirSync(directory, { recursive: true }); receipt.file = resolve(directory, "creation-receipt.json");
        }
        this.receipts.push(receipt); this.save(receipt); return receipt;
    }
    save(receipt: MondayCreationReceipt): void {
        if (!receipt.file) return;
        const { file, ...data } = receipt;
        const temporary = file + ".tmp";
        writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
        renameSync(temporary, file);
    }
}
