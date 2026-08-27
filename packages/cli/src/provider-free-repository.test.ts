import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_PRODUCTION_TEXT = [
  "@prs/providers",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "BEDROCK_MODEL_ID",
  "createProviderFromEnvironment",
] as const;

function trackedProductionFiles(repoRoot: string): string[] {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((path) => existsSync(resolve(repoRoot, path)))
    .filter((path) =>
      path === "package.json" ||
      path === "pnpm-workspace.yaml" ||
      path.endsWith("/package.json") ||
      path.endsWith("/action.yml") ||
      path.startsWith(".github/workflows/") ||
      (/^(packages|actions)\/.*\.(?:ts|js)$/.test(path) &&
        !path.endsWith(".test.ts") &&
        !path.includes("/dist/"))
    );
}

describe("provider-free repository", () => {
  it("contains no provider package, API-key wiring, or provider factory in production files", () => {
    const repoRoot = process.cwd();
    const violations = trackedProductionFiles(repoRoot).flatMap((path) => {
      const content = readFileSync(resolve(repoRoot, path), "utf8");
      return FORBIDDEN_PRODUCTION_TEXT.filter((text) => content.includes(text)).map(
        (text) => `${path}: ${text}`
      );
    });

    expect(violations).toEqual([]);
  });

  it("keeps only the repository test workflow and no distributable action packages", () => {
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .filter((path) => existsSync(resolve(process.cwd(), path)));

    expect(tracked.filter((path) => path.startsWith(".github/workflows/"))).toEqual([
      ".github/workflows/test.yml",
    ]);
    expect(tracked.some((path) => path.startsWith("actions/"))).toBe(false);
    expect(tracked.some((path) => path.startsWith("packages/providers/"))).toBe(false);
  });
});
