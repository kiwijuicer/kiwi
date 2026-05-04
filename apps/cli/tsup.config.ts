import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  clean: true,
  sourcemap: true,
  // Bundle the workspace package so the CLI is a single self-contained file
  noExternal: ["@kiwi/core", "@kiwi/contracts", "@kiwi/adapters", "@kiwi/sandbox"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
