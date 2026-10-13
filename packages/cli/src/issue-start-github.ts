import type { GitHubClient } from "./github-client";

export type GitHubUpdateStep =
  | { status: "updated" | "already-set"; value: string }
  | { status: "unavailable"; reason: string };

export type IssueStartGitHubResult = {
  assignee: GitHubUpdateStep;
  issueStatus: GitHubUpdateStep;
};

type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number };
type IssuePayload = { assignees?: Array<{ login?: string }> };
type IssueField = { id?: number; name?: string; data_type?: string; options?: Array<{ id?: number; name?: string }> };
type IssueFieldValue = { issue_field_id?: number; single_select_option?: { id?: number; name?: string }; value?: number | string };

const issueFieldsVersion = { "X-GitHub-Api-Version": "2026-03-10" };

async function readApi<T>(
  request: GitHubClient["request"],
  endpoint: string,
  init: Parameters<GitHubClient["request"]>[1] = {}
): Promise<ApiResult<T>> {
  try {
    const response = await request(endpoint, init);
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, value: await response.json() as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

function failureReason(message: string, status: number): string {
  return status ? `${message} (${status})` : `${message} (request failed)`;
}

function isAssigned(issue: IssuePayload, login: string): boolean {
  return Array.isArray(issue.assignees) && issue.assignees.some(user => user.login === login);
}

function isInProgress(values: IssueFieldValue[], field: IssueField): boolean {
  const option = field.options?.find(value => value.name === "In Progress");
  return values.some(value => value.issue_field_id === field.id &&
    (value.single_select_option?.name === "In Progress" ||
      (option?.id !== undefined && (value.single_select_option?.id === option.id || value.value === option.id))));
}

export async function startIssueWork(input: {
  owner: string;
  repo: string;
  issueNumber: number;
  request: GitHubClient["request"];
}): Promise<IssueStartGitHubResult> {
  const { owner, repo, issueNumber, request } = input;
  const issueEndpoint = `repos/${owner}/${repo}/issues/${issueNumber}`;
  const fieldValuesEndpoint = `${issueEndpoint}/issue-field-values`;
  let assignee: GitHubUpdateStep;
  let issueStatus: GitHubUpdateStep;

  const viewer = await readApi<{ login?: string }>(request, "user");
  if (!viewer.ok || !viewer.value.login) {
    assignee = { status: "unavailable", reason: "Could not resolve the selected GitHub user" };
  } else {
    const login = viewer.value.login;
    const currentIssue = await readApi<IssuePayload>(request, issueEndpoint);
    if (!currentIssue.ok || !Array.isArray(currentIssue.value.assignees)) {
      assignee = { status: "unavailable", reason: currentIssue.ok
        ? "GitHub issue assignees response is incomplete"
        : failureReason("Could not read GitHub issue assignees", currentIssue.status) };
    } else if (isAssigned(currentIssue.value, login)) {
      assignee = { status: "already-set", value: login };
    } else {
      const added = await readApi<IssuePayload>(request, `${issueEndpoint}/assignees`, {
        method: "POST", body: JSON.stringify({ assignees: [login] }),
      });
      if (!added.ok) {
        assignee = { status: "unavailable", reason: failureReason("Failed to assign the selected GitHub user", added.status) };
      } else {
        const verified = await readApi<IssuePayload>(request, issueEndpoint);
        assignee = verified.ok && isAssigned(verified.value, login)
          ? { status: "updated", value: login }
          : { status: "unavailable", reason: "Could not verify the selected GitHub user assignment" };
      }
    }
  }

  const fields = await readApi<IssueField[]>(request, `orgs/${owner}/issue-fields`, { headers: issueFieldsVersion });
  if (!fields.ok) {
    issueStatus = { status: "unavailable", reason: fields.status === 404
      ? "Status issue field requires an organization and access to its issue fields (404)"
      : failureReason("GitHub issue fields are unavailable", fields.status) };
  } else if (!Array.isArray(fields.value)) {
    issueStatus = { status: "unavailable", reason: "GitHub issue fields response is incomplete" };
  } else {
    const field = fields.value.find(value => value.name === "Status" && value.data_type === "single_select" && Number.isSafeInteger(value.id));
    if (!field) {
      issueStatus = { status: "unavailable", reason: "Status issue field is not configured" };
    } else if (!field.options?.some(value => value.name === "In Progress")) {
      issueStatus = { status: "unavailable", reason: "In Progress option is not configured" };
    } else {
      const currentValues = await readApi<IssueFieldValue[]>(request, fieldValuesEndpoint, { headers: issueFieldsVersion });
      if (!currentValues.ok || !Array.isArray(currentValues.value)) {
        issueStatus = { status: "unavailable", reason: currentValues.ok
          ? "GitHub issue field values response is incomplete"
          : failureReason("Could not read GitHub issue field values", currentValues.status) };
      } else if (isInProgress(currentValues.value, field)) {
        issueStatus = { status: "already-set", value: "In Progress" };
      } else {
        const set = await readApi<IssueFieldValue[]>(request, fieldValuesEndpoint, {
          method: "POST", headers: issueFieldsVersion,
          body: JSON.stringify({ issue_field_values: [{ field_id: field.id, value: "In Progress" }] }),
        });
        if (!set.ok) {
          issueStatus = { status: "unavailable", reason: failureReason("Failed to set GitHub issue Status", set.status) };
        } else {
          const verified = await readApi<IssueFieldValue[]>(request, fieldValuesEndpoint, { headers: issueFieldsVersion });
          issueStatus = verified.ok && Array.isArray(verified.value) && isInProgress(verified.value, field)
            ? { status: "updated", value: "In Progress" }
            : { status: "unavailable", reason: "Could not verify GitHub issue Status" };
        }
      }
    }
  }

  return { assignee, issueStatus };
}
