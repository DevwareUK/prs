import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTestBacklog } from "./test-backlog";

function writeFile(repoRoot: string, relativePath: string, contents: string): void {
  const filePath = resolve(repoRoot, relativePath);
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, contents);
}

describe("analyzeTestBacklog", () => {
  it("detects Vitest and CI wiring without recommending a new framework", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-test-backlog-"));

    writeFile(
      repoRoot,
      "package.json",
      JSON.stringify(
        {
          name: "fixture-repo",
          private: true,
          scripts: {
            test: "vitest run",
          },
          devDependencies: {
            vitest: "^3.2.4",
          },
        },
        null,
        2
      )
    );
    writeFile(
      repoRoot,
      "packages/core/src/example.ts",
      'export function example(): string { return "ok"; }\n'
    );
    writeFile(
      repoRoot,
      "packages/core/src/example.test.ts",
      'import { describe, expect, it } from "vitest";\n' +
        'import { example } from "./example";\n' +
        'describe("example", () => {\n' +
        '  it("returns ok", () => {\n' +
        '    expect(example()).toBe("ok");\n' +
        "  });\n" +
        "});\n"
    );
    writeFile(
      repoRoot,
      ".github/workflows/test.yml",
      [
        "name: Test",
        "on: [push]",
        "jobs:",
        "  test:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - run: pnpm test",
      ].join("\n")
    );

    const result = await analyzeTestBacklog({
      repoRoot,
      maxFindings: 10,
    });

    expect(result.currentTestingSetup.frameworks).toContain("Vitest");
    expect(result.currentTestingSetup.status).toBe("established");
    expect(result.currentTestingSetup.ciIntegration.status).toBe("established");
    expect(result.currentTestingSetup.frameworkRecommendation).toBeUndefined();
    expect(result.findings.map((finding) => finding.id)).not.toContain(
      "initial-test-harness"
    );
  });

  it("ignores excluded test paths from the repository scan", async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), "prs-test-backlog-exclude-"));

    writeFile(
      repoRoot,
      "package.json",
      JSON.stringify(
        {
          name: "fixture-repo",
          private: true,
        },
        null,
        2
      )
    );
    writeFile(
      repoRoot,
      "packages/core/src/example.ts",
      'export function example(): string { return "ok"; }\n'
    );
    writeFile(
      repoRoot,
      "generated/tests/example.test.ts",
      'import { describe, it } from "vitest";\n' +
        'describe("generated", () => {\n' +
        '  it("is ignored", () => {});\n' +
        "});\n"
    );

    const result = await analyzeTestBacklog({
      excludePaths: ["generated/**"],
      repoRoot,
      maxFindings: 10,
    });

    expect(result.currentTestingSetup.hasTests).toBe(false);
    expect(result.currentTestingSetup.testFileCount).toBe(0);
  });
});
