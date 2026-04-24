import { defineConfig } from "tsup";

export default defineConfig({
  dts: true,
  entry: ["src/index.ts"],
  format: ["cjs"],
  noExternal: [/^@prs\//, /^zod$/, /^@aws-sdk\//],
  outDir: "dist",
});
