import { describe, expect, it } from "vitest";
import {
  createRepositoryPathMatcher,
  filterRepositoryPaths,
  normalizeRepositoryPath,
} from "./path-filter";

describe("path filter helpers", () => {
  it("normalizes repository paths to forward-slash relative paths", () => {
    expect(normalizeRepositoryPath("./packages\\cli\\src\\index.ts")).toBe(
      "packages/cli/src/index.ts"
    );
  });

  it("matches basename globs anywhere in the repository", () => {
    const matchesExcludedPath = createRepositoryPathMatcher(["*.map"]);

    expect(matchesExcludedPath("dist/app.js.map")).toBe(true);
    expect(matchesExcludedPath("packages/cli/src/index.ts")).toBe(false);
  });

  it("matches nested directory globs and filters excluded paths", () => {
    expect(
      filterRepositoryPaths(
        [
          "packages/cli/src/index.ts",
          "packages/cli/dist/index.js",
          "web/themes/site/css/app.css",
        ],
        ["**/dist/**", "web/themes/**/css/**"]
      )
    ).toEqual(["packages/cli/src/index.ts"]);
  });
});
