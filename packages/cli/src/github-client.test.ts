import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitHubAuthFailure } from "./github-auth-failure";
import { createGitHubClient, listGitHubAccounts, type GitHubCommandOptions } from "./github-client";

const available = () => ({ status: 0 });
function repository(account: string) {
  const root = mkdtempSync(join(tmpdir(), "prs-account-"));
  mkdirSync(join(root, ".prs"));
  writeFileSync(join(root, ".prs/config.local.json"), JSON.stringify({ forge: { githubAccount: account } }));
  return root;
}

describe("GitHub CLI account isolation", () => {
  it("keeps different project identities isolated from inherited tokens and each other", async () => {
    const env = { GH_TOKEN: "inherited", GITHUB_TOKEN: "other", GH_DEBUG: "api" };
    const runCommand = (_command: string, args: string[], options: GitHubCommandOptions) => {
      if (args[0] === "auth") {
        expect(options.env.GH_TOKEN).toBeUndefined();
        expect(options.env.GITHUB_TOKEN).toBeUndefined();
        expect(args.slice(0, 5)).toEqual(["auth", "token", "--hostname", "github.com", "--user"]);
        return `${args[5]}-secret`;
      }
      expect(options.env.GH_DEBUG).toBeUndefined();
      expect(options.env.GITHUB_TOKEN).toBeUndefined();
      return `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ login: options.env.GH_TOKEN?.split("-")[0] })}`;
    };
    const clients = ["work", "personal"].map(account => createGitHubClient({ repoRoot: repository(account), env, spawnSync: available, runCommand }));
    const identities = await Promise.all(clients.map(async client => (await client.request("user")).json()));
    expect(identities).toEqual([{ login: "work" }, { login: "personal" }]);
    expect(env).toEqual({ GH_TOKEN: "inherited", GITHUB_TOKEN: "other", GH_DEBUG: "api" });
  });

  it("classifies inaccessible configured keyring credentials without leaking diagnostics", () => {
    const sentinel = "keyring-sentinel-secret";
    let error: unknown;
    try {
      createGitHubClient({ repoRoot: repository("work"), env: { GH_TOKEN: "inherited" }, spawnSync: available,
        runCommand: (_command, args, options) => {
          if (args[0] === "auth" && args[1] === "token") throw Object.assign(new Error(sentinel), { stderr: `credential store denied: ${sentinel}` });
          if (args[0] === "auth" && args[1] === "status") {
            expect(args).toEqual(["auth", "status", "--hostname", "github.com", "--json", "hosts"]);
            expect(options.env.GH_TOKEN).toBeUndefined();
            return JSON.stringify({ hosts: { "github.com": [{ login: "work", state: "success", tokenSource: "keyring" }] } });
          }
          throw new Error("API request must not run");
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GitHubAuthFailure);
    expect(error).toMatchObject({
      reason: "github-credential-store-inaccessible",
      nextAction: "retry-with-credential-store-access",
    });
    const rendered = String(error);
    expect(rendered).not.toContain(sentinel);
    expect(rendered).not.toContain("credential store denied");
  });

  it("treats a selected saved account with indeterminate status as credential-store inaccessible", () => {
    const sentinel = "status-network-sentinel";
    let error: unknown;
    try {
      createGitHubClient({ repoRoot: repository("work"), env: { GH_TOKEN: "inherited" }, spawnSync: available,
        runCommand: (_command, args) => {
          if (args[0] === "auth" && args[1] === "token") throw new Error("credential store denied");
          if (args[0] === "auth" && args[1] === "status") {
            return JSON.stringify({
              hosts: {
                "github.com": [
                  {
                    active: true,
                    error: `Get https://api.github.com: ${sentinel}`,
                    host: "github.com",
                    login: "work",
                    scopes: "",
                    state: "error",
                    tokenSource: "default",
                  },
                  {
                    active: false,
                    error: "another account is unavailable",
                    host: "github.com",
                    login: "personal",
                    scopes: "",
                    state: "error",
                    tokenSource: "default",
                  },
                ],
              },
            });
          }
          throw new Error("API request must not run");
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GitHubAuthFailure);
    expect(error).toMatchObject({
      reason: "github-credential-store-inaccessible",
      nextAction: "retry-with-credential-store-access",
    });
    expect(String(error)).not.toContain(sentinel);
  });

  it("requires authentication for a missing configured account without running an API request or leaking errors", () => {
    let requests = 0;
    let error: unknown;
    try {
      createGitHubClient({ repoRoot: repository("missing"), env: { GH_TOKEN: "secret" }, spawnSync: available,
        runCommand: (_command, args) => {
          if (args[0] === "auth" && args[1] === "status") {
            return JSON.stringify({ hosts: { "github.com": [{ login: "work", state: "success", tokenSource: "keyring" }] } });
          }
          if (args[0] !== "auth") requests++;
          throw new Error("credential secret");
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GitHubAuthFailure);
    expect(error).toMatchObject({ reason: "github-auth-required", nextAction: "configure-github-auth" });
    expect(String(error)).toMatch(/missing.*gh auth login/);
    expect(requests).toBe(0);
  });

  it.each([
    ["returns malformed JSON", (sentinel: string) => `not-json-${sentinel}`],
    ["returns a structurally malformed matching account", (sentinel: string) => JSON.stringify({
      hosts: { "github.com": [{ login: "work", error: sentinel }] },
    })],
    ["fails", (sentinel: string) => { throw Object.assign(new Error(`status probe denied: ${sentinel}`), { stderr: `status probe stderr: ${sentinel}` }); }],
  ])("requires authentication without leaking diagnostics when the account-status probe %s", (_case, statusResult) => {
    const tokenSentinel = "token-extraction-sentinel";
    const statusSentinel = "status-probe-sentinel";
    let error: unknown;
    try {
      createGitHubClient({ repoRoot: repository("work"), env: { GH_TOKEN: "inherited" }, spawnSync: available,
        runCommand: (_command, args) => {
          if (args[0] === "auth" && args[1] === "token") {
            throw Object.assign(new Error(`token extraction denied: ${tokenSentinel}`), { stderr: `token stderr: ${tokenSentinel}` });
          }
          if (args[0] === "auth" && args[1] === "status") return statusResult(statusSentinel);
          throw new Error("API request must not run");
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(GitHubAuthFailure);
    expect(error).toMatchObject({ reason: "github-auth-required", nextAction: "configure-github-auth" });
    const rendered = String(error);
    expect(rendered).toMatch(/work.*gh auth login/);
    expect(rendered).not.toContain(tokenSentinel);
    expect(rendered).not.toContain(statusSentinel);
    expect(rendered).not.toContain("status probe denied");
    expect(rendered).not.toContain("status probe stderr");
  });

  it("requires gh even when an environment token exists", () => {
    expect(() => createGitHubClient({ env: { GH_TOKEN: "secret" }, spawnSync: () => ({ status: 1 }) })).toThrow(/Install GitHub CLI/);
  });

  it("delegates default authentication to gh without extracting a token", async () => {
    const client = createGitHubClient({ env: { GH_TOKEN: "ci-secret" }, spawnSync: available,
      runCommand: (_command, args, options) => {
        expect(args[0]).toBe("api");
        expect(options.env.GH_TOKEN).toBe("ci-secret");
        return 'HTTP/2.0 200 OK\n\n{"login":"ci-bot"}';
      },
    });
    expect(await (await client.request("user")).json()).toEqual({ login: "ci-bot" });
  });

  it("sends REST and GraphQL payloads through stdin and preserves HTTP errors", async () => {
    const payload = JSON.stringify({ query: "mutation($body: String!) { example(body: $body) }", variables: { body: "line 1\nline 2" } });
    const client = createGitHubClient({ env: {}, spawnSync: available,
      runCommand: (_command, args, options) => {
        expect(args).toEqual(["api", "graphql", "--hostname", "github.com", "--include", "--method", "POST", "--input", "-"]);
        expect(options.input).toBe(payload);
        throw Object.assign(new Error("do not expose stderr"), { stdout: 'HTTP/2.0 403 Forbidden\r\n\r\n{"message":"denied"}' });
      },
    });
    const response = await client.request("graphql", { method: "POST", body: payload });
    expect(response.status).toBe(403);
    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ message: "denied" });
  });

  it("redacts credential values in response errors and command diagnostics", async () => {
    const client = createGitHubClient({ env: { GH_TOKEN: "super-secret-token" }, spawnSync: available,
      runCommand: () => { throw Object.assign(new Error("super-secret-token"), { stdout: 'HTTP/2.0 200 OK\n\n{"errors":[{"message":"super-secret-token"}]}' }); },
    });
    expect(JSON.stringify(await (await client.request("graphql")).json())).not.toContain("super-secret-token");
  });

  it("discovers saved accounts without inherited tokens or printing credentials", () => {
    const result = listGitHubAccounts({ env: { GH_TOKEN: "inherited" }, spawnSync: available,
      runCommand: (_command, args, options) => {
        expect(args).toEqual(["auth", "status", "--hostname", "github.com", "--json", "hosts"]);
        expect(options.env.GH_TOKEN).toBeUndefined();
        return JSON.stringify({ hosts: { "github.com": [{ login: "work", state: "success", tokenSource: "keyring" }, { login: "bad", state: "error" }] } });
      },
    });
    expect(result.accounts).toEqual(["work"]);
  });
});

it.each(["GET", "PATCH"])("preserves REST %s method and query parameters", async method => {
  const client = createGitHubClient({ env: {}, spawnSync: available,
    runCommand: (_command, args, options) => {
      expect(args.slice(0, 7)).toEqual(["api", "repos/org/repo/issues/1?per_page=100&page=2", "--hostname", "github.com", "--include", "--method", method]);
      if (method === "PATCH") {
        expect(args.slice(7)).toEqual(["--input", "-"]);
        expect(JSON.parse(options.input ?? "")).toEqual({ body: "updated\ncomment" });
      } else expect(options.input).toBeUndefined();
      return 'HTTP/2.0 200 OK\n\n{"number":1}';
    },
  });
  expect(await (await client.request("repos/org/repo/issues/1?per_page=100&page=2", { method, ...(method === "PATCH" ? { body: JSON.stringify({ body: "updated\ncomment" }) } : {}) })).json()).toEqual({ number: 1 });
});

it("does not include subprocess stderr or credentials in failed command messages", () => {
  const client = createGitHubClient({ env: { GH_TOKEN: "do-not-expose" }, spawnSync: available,
    runCommand: () => { throw Object.assign(new Error("do-not-expose"), { stderr: "Authorization: Bearer do-not-expose" }); },
  });
  expect(() => client.run(["pr", "create"], "Unable to create PR")).toThrow(/Unable to create PR.*gh auth login/);
  try { client.run(["pr", "create"], "Unable to create PR"); } catch (error) { expect(String(error)).not.toContain("do-not-expose"); }
});

it("classifies a rejected saved credential for the selected account", async () => {
  const client = createGitHubClient({ repoRoot: repository("expired"), env: {}, spawnSync: available,
    runCommand: (_command, args) => {
      if (args[0] === "auth") return "expired-secret";
      throw Object.assign(new Error("expired-secret"), { stdout: 'HTTP/2.0 401 Unauthorized\n\n{"message":"Bad credentials"}' });
    },
  });
  let error: unknown;
  try {
    await client.request("repos/org/repo");
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GitHubAuthFailure);
  expect(error).toMatchObject({ reason: "github-auth-required", nextAction: "configure-github-auth" });
  expect(String(error)).toMatch(/expired.*gh auth login/);
});
