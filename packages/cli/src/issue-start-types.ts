export type IssueUpdateStep = {
    status: "updated" | "already-set";
    value: string;
} | {
    status: "unavailable";
    reason: string;
};
export type IssueStartResult = {
    assignee: IssueUpdateStep;
    issueStatus: IssueUpdateStep;
};
