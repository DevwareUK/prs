import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  entry: ["src/index.ts"],
  format: ["cjs"],
  noExternal: [/^@git-ai\//, /^zod$/, /^@aws-sdk\//],
  outDir: "dist",
});
