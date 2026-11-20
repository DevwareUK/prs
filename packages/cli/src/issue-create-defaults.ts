import { GitHubCreationDefaults, MondayCreationDefaults, type ResolvedRepositoryConfigType } from "@prs/contracts";
type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type ColumnValues = Record<string, JsonValue>;
export type EffectiveIssueCreateDefaults = {
    type: "monday";
    groupId?: string;
    columnValues: ColumnValues;
} | {
    type: "github";
    labels: string[];
    assignees?: string[];
    milestone?: number;
};
export function resolveIssueCreateDefaults(config: ResolvedRepositoryConfigType, target: {
    boardId?: string;
    isSubitem: boolean;
}, input: {
    copiedColumnValues?: ColumnValues;
    columnValues?: ColumnValues;
    labels?: string[];
    assignees?: string[];
    milestone?: number;
} = {}): EffectiveIssueCreateDefaults {
    if (config.issueTracker.type === "monday") {
        const base = MondayCreationDefaults.parse(config.issueTracker.defaults ?? {});
        const board = config.issueTracker.monday?.defaultsByBoard?.[target.boardId ?? ""] ?? {};
        const values = { ...base, ...board };
        return { type: "monday" as const, ...(!target.isSubitem && values.groupId ? { groupId: values.groupId } : {}), columnValues: { ...values.columnValues, ...input.copiedColumnValues, ...input.columnValues } };
    }
    const base = GitHubCreationDefaults.parse(config.issueTracker.defaults ?? {});
    return { type: "github" as const, labels: [...new Set([...(base.labels ?? []), ...(input.labels ?? [])])], ...(input.assignees ?? base.assignees ? { assignees: input.assignees ?? base.assignees } : {}), ...(input.milestone ?? base.milestone ? { milestone: input.milestone ?? base.milestone } : {}) };
}
