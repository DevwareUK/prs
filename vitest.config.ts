import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.spec.ts",
      "actions/**/*.test.ts",
      "actions/**/*.spec.ts",
    ],
  },
});
