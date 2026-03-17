import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.spec.ts",
      "actions/**/*.test.ts",
      "actions/**/*.spec.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [...coverageConfigDefaults.exclude, "**/dist/**"],
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 30,
        statements: 30,
      },
    },
  },
});
