import { execFileSync } from "node:child_process";
import { loadLocalRepositoryConfig } from "./config";
import { resolveGitHubCli } from "./github-auth";

export type GitHubCommandOptions = {
  env: Record<string, string | undefined>;
  cwd?: string;
  input?: string;
};
export type GitHubCommandRunner = (command: string, args: string[], options: GitHubCommandOptions) => string;
export type GitHubClientOptions = Parameters<typeof resolveGitHubCli>[0] & {
  runCommand?: GitHubCommandRunner;
};
export type GitHubRequestOptions = { method?: string; body?: string };
export type GitHubClient = ReturnType<typeof createGitHubClient>;

const tokenVariables = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];
function childEnvironment(env: Record<string, string | undefined>) {
  const result: Record<string, string | undefined> = { ...env, GH_PROMPT_DISABLED: "1", GH_HOST: "github.com", NO_COLOR: "1" };
  // Debug output can contain authentication headers, including on failed commands.
  delete result.GH_DEBUG;
  delete result.DEBUG;
  return result;
}
function withoutTokens(env: Record<string, string | undefined>) {
  const result = childEnvironment(env);
  for (const key of tokenVariables) delete result[key];
  return result;
}
function execute(command: string, args: string[], options: GitHubCommandOptions): string {
  return execFileSync(command, args, {
    ...options, encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000, stdio: ["pipe", "pipe", "pipe"],
  });
}
function requireCli(options: GitHubClientOptions) {
  const cli = resolveGitHubCli(options);
  if (!cli.path) throw new Error("Install GitHub CLI (gh), or configure PRS_GH_PATH / forge.githubCliPath, before using GitHub operations.");
  return cli.path;
}

export function createGitHubClient(options: GitHubClientOptions = {}) {
  const path = requireCli(options);
  const run = options.runCommand ?? execute;
  const account = options.repoRoot ? loadLocalRepositoryConfig(options.repoRoot).forge?.githubAccount : undefined;
  const env = childEnvironment(options.env ?? process.env);
  if (account) {
    let token: string;
    try {
      token = run(path, ["auth", "token", "--hostname", "github.com", "--user", account], {
        cwd: options.repoRoot, env: withoutTokens(env),
      }).trim();
      if (!token) throw new Error("No saved credential");
    } catch {
      throw new Error(`GitHub account "${account}" is unavailable. Run gh auth login --hostname github.com for that account.`);
    }
    for (const key of tokenVariables) delete env[key];
    env.GH_TOKEN = token;
  }
  const redact = (text: string) => tokenVariables.reduce((result, key) => {
    const token = env[key];
    return token ? result.split(token).join("[REDACTED]") : result;
  }, text);
  const invoke = (args: string[], input?: string) => run(path, args, { env: { ...env }, cwd: options.repoRoot, input });
  const loginHint = account ? ` for account "${account}"` : "";

  return {
    run(args: string[], errorMessage: string, input?: string): string {
      try { return redact(invoke(args, input)).trim(); } catch {
        throw new Error(`${errorMessage} Check GitHub access${loginHint}; run gh auth login --hostname github.com if needed.`);
      }
    },
    async request(endpoint: string, init: GitHubRequestOptions = {}): Promise<Response> {
      // Endpoints are repository-controlled paths, never arbitrary credential destinations.
      if (endpoint.startsWith("/") || endpoint.includes("://")) throw new Error("Expected a GitHub API endpoint path.");
      const args = ["api", endpoint, "--hostname", "github.com", "--include", "--method", init.method ?? "GET"];
      if (init.body !== undefined) args.push("--input", "-");
      let output: string;
      try { output = invoke(args, init.body); } catch (error) {
        // gh exits nonzero for HTTP and GraphQL errors, but --include preserves the response.
        output = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout ?? "") : "";
      }
      output = redact(output);
      const match = output.match(/^HTTP\/[\d.]+ (\d{3})(?: ([^\r\n]*))?\r?\n(?:[^\r\n]+\r?\n)*\r?\n/);
      if (!match) throw new Error(`GitHub CLI request failed${loginHint}. Check network access and gh auth login --hostname github.com.`);
      const status = Number(match[1]);
      if (status === 401 && account) {
        throw new Error(`GitHub credentials for account "${account}" were rejected. Run gh auth login --hostname github.com for that account.`);
      }
      return new Response([204, 205, 304].includes(status) ? null : output.slice(match[0].length), {
        status, statusText: match[2] ?? "",
      });
    },
  };
}

export async function requestGitHub(repoRoot: string | undefined, endpoint: string, init?: GitHubRequestOptions) {
  return createGitHubClient({ repoRoot }).request(endpoint, init);
}

export function listGitHubAccounts(options: GitHubClientOptions = {}): { accounts: string[]; guidance?: string } {
  try {
    const path = requireCli(options);
    const output = (options.runCommand ?? execute)(path, ["auth", "status", "--hostname", "github.com", "--json", "hosts"], {
      cwd: options.repoRoot, env: withoutTokens(options.env ?? process.env),
    });
    const payload = JSON.parse(output) as { hosts?: Record<string, Array<{ login?: string; state?: string }>> };
    const accounts = [...new Set((payload.hosts?.["github.com"] ?? [])
      .filter(entry => entry.state === "success" && entry.login)
      .map(entry => entry.login as string))];
    return { accounts, guidance: accounts.length ? undefined : "No saved GitHub accounts. Run gh auth login --hostname github.com, then rerun prs setup." };
  } catch {
    return { accounts: [], guidance: "Install GitHub CLI (gh) and run gh auth login --hostname github.com, then rerun prs setup." };
  }
}
