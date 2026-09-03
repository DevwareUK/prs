import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("fails on an unavailable configured account without running an API request or leaking errors", () => {
    let requests = 0;
    expect(() => createGitHubClient({ repoRoot: repository("missing"), env: { GH_TOKEN: "secret" }, spawnSync: available,
      runCommand: (_command, args) => { if (args[0] !== "auth") requests++; throw new Error("credential secret"); },
    })).toThrow(/missing.*gh auth login/);
    expect(requests).toBe(0);
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

it("names the selected account and login step when a saved credential is rejected", async () => {
  const client = createGitHubClient({ repoRoot: repository("expired"), env: {}, spawnSync: available,
    runCommand: (_command, args) => {
      if (args[0] === "auth") return "expired-secret";
      throw Object.assign(new Error("expired-secret"), { stdout: 'HTTP/2.0 401 Unauthorized\n\n{"message":"Bad credentials"}' });
    },
  });
  await expect(client.request("repos/org/repo")).rejects.toThrow(/expired.*gh auth login/);
});
