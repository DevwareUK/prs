import { describe, expect, it } from "vitest";
import { startIssueWork } from "./issue-start-github";

type FakeOptions = {
  statusField?: boolean;
  inProgressOption?: boolean;
  fieldReadStatus?: number;
  fieldWriteStatus?: number;
  assigneeWriteStatus?: number;
  assigned?: boolean;
  inProgress?: boolean;
};

function fakeGitHub(options: FakeOptions = {}) {
  const requests: Array<{ endpoint: string; method: string; body?: unknown; headers?: Record<string, string> }> = [];
  const assignees = ["teammate", ...(options.assigned ? ["selected-login"] : [])];
  const fieldValues = [
    { issue_field_id: 77, issue_field_name: "Priority", data_type: "single_select", single_select_option: { name: "High" } },
    ...(options.inProgress ? [{ issue_field_id: 123, issue_field_name: "Status", data_type: "single_select", single_select_option: { name: "In Progress" } }] : []),
  ];
  const request = async (endpoint: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) as unknown : undefined;
    requests.push({ endpoint, method, body, headers: init.headers });
    if (endpoint === "user") return Response.json({ login: "selected-login" });
    if (endpoint === "repos/example/repo/issues/371" && method === "GET") {
      return Response.json({ assignees: assignees.map(login => ({ login })) });
    }
    if (endpoint === "repos/example/repo/issues/371/assignees" && method === "POST") {
      if (options.assigneeWriteStatus) return Response.json({}, { status: options.assigneeWriteStatus });
      assignees.push(...(body as { assignees: string[] }).assignees);
      return Response.json({ assignees: assignees.map(login => ({ login })) });
    }
    if (endpoint === "orgs/example/issue-fields") {
      if (options.fieldReadStatus) return Response.json({}, { status: options.fieldReadStatus });
      if (options.statusField === false) return Response.json([]);
      return Response.json([{ id: 123, name: "Status", data_type: "single_select", options: options.inProgressOption === false ? [{ name: "Todo" }] : [{ name: "In Progress" }] }]);
    }
    if (endpoint === "repos/example/repo/issues/371/issue-field-values" && method === "GET") {
      return Response.json(fieldValues);
    }
    if (endpoint === "repos/example/repo/issues/371/issue-field-values" && method === "POST") {
      if (options.fieldWriteStatus) return Response.json({}, { status: options.fieldWriteStatus });
      const values = (body as { issue_field_values: Array<{ field_id: number; value: string }> }).issue_field_values;
      if (values.some(value => value.field_id === 123 && value.value === "In Progress")) {
        fieldValues.push({ issue_field_id: 123, issue_field_name: "Status", data_type: "single_select", single_select_option: { name: "In Progress" } });
      }
      return Response.json(fieldValues);
    }
    throw new Error(`Unexpected request: ${method} ${endpoint}`);
  };
  return { request, requests, assignees, fieldValues };
}

describe("startIssueWork", () => {
  it("adds the selected user and Status without replacing existing issue metadata", async () => {
    const fake = fakeGitHub();
    const result = await startIssueWork({ owner: "example", repo: "repo", issueNumber: 371, request: fake.request });

    expect(result).toEqual({
      assignee: { status: "updated", value: "selected-login" },
      issueStatus: { status: "updated", value: "In Progress" },
    });
    expect(fake.assignees).toEqual(["teammate", "selected-login"]);
    expect(fake.fieldValues.map(value => value.issue_field_name)).toEqual(["Priority", "Status"]);
    expect(fake.requests.filter(call => call.method === "POST")).toEqual([
      { endpoint: "repos/example/repo/issues/371/assignees", method: "POST", body: { assignees: ["selected-login"] }, headers: undefined },
      { endpoint: "repos/example/repo/issues/371/issue-field-values", method: "POST", body: { issue_field_values: [{ field_id: 123, value: "In Progress" }] }, headers: { "X-GitHub-Api-Version": "2026-03-10" } },
    ]);
    expect(fake.requests.filter(call => call.endpoint.includes("issue-fields") || call.endpoint.includes("issue-field-values")).every(call => call.headers?.["X-GitHub-Api-Version"] === "2026-03-10")).toBe(true);
  });

  it("makes no writes when assignment and Status are already set", async () => {
    const fake = fakeGitHub({ assigned: true, inProgress: true });
    expect(await startIssueWork({ owner: "example", repo: "repo", issueNumber: 371, request: fake.request })).toEqual({
      assignee: { status: "already-set", value: "selected-login" },
      issueStatus: { status: "already-set", value: "In Progress" },
    });
    expect(fake.requests.filter(call => call.method === "POST")).toEqual([]);
  });

  it.each([
    [{ statusField: false }, "Status issue field is not configured"],
    [{ inProgressOption: false }, "In Progress option is not configured"],
    [{ fieldReadStatus: 403 }, "GitHub issue fields are unavailable (403)"],
    [{ fieldReadStatus: 404 }, "Status issue field requires an organization and access to its issue fields (404)"],
  ] as const)("keeps assignment when issue Status is unavailable: %j", async (options, reason) => {
    const fake = fakeGitHub(options);
    const result = await startIssueWork({ owner: "example", repo: "repo", issueNumber: 371, request: fake.request });
    expect(result.assignee).toEqual({ status: "updated", value: "selected-login" });
    expect(result.issueStatus).toEqual({ status: "unavailable", reason });
    expect(fake.requests.filter(call => call.method === "POST").map(call => call.endpoint)).toEqual(["repos/example/repo/issues/371/assignees"]);
  });

  it("reports a failed Status write and safely completes it on retry", async () => {
    const options: FakeOptions = { fieldWriteStatus: 403 };
    const fake = fakeGitHub(options);
    const first = await startIssueWork({ owner: "example", repo: "repo", issueNumber: 371, request: fake.request });
    expect(first.assignee).toEqual({ status: "updated", value: "selected-login" });
    expect(first.issueStatus).toEqual({ status: "unavailable", reason: "Failed to set GitHub issue Status (403)" });
    options.fieldWriteStatus = undefined;
    fake.requests.length = 0;
    const second = await startIssueWork({ owner: "example", repo: "repo", issueNumber: 371, request: fake.request });
    expect(second.assignee).toEqual({ status: "already-set", value: "selected-login" });
    expect(second.issueStatus).toEqual({ status: "updated", value: "In Progress" });
    expect(fake.requests.filter(call => call.endpoint.endsWith("/assignees") && call.method === "POST")).toEqual([]);
  });

  it("reports assignment failure independently of a successful Status update", async () => {
    const fake = fakeGitHub({ assigneeWriteStatus: 403 });
    expect(await startIssueWork({ owner: "example", repo: "repo", issueNumber: 371, request: fake.request })).toEqual({
      assignee: { status: "unavailable", reason: "Failed to assign the selected GitHub user (403)" },
      issueStatus: { status: "updated", value: "In Progress" },
    });
  });
});
